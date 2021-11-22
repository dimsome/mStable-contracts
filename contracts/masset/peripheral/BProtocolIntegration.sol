// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Imports
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IBProtocolStabilityPool } from "../../peripheral/BProtocol/IBProtocolStabilityPool.sol";
import { IStabilityPool } from "../../peripheral/BProtocol/IStabilityPool.sol";
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title   BProtocolIntegration
 * @author  mStable
 * @notice  A connection contract for BProtocol to deposit LUSD from Feeder Pool into the stability pool.
 *          This Contract assumes _hasTxFee is always true, because withdrawals are always resulting in slighlty less
 *          LUSD that is and the missing amount (dust) is in ETH
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-01
 */

// TODO: Add Dependencies

contract BProtocolIntegration is Initializable, ImmutableModule, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using StableMath for uint256;
    using SafeMath for uint256;

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);
    event PlatformWithdrawal(
        address indexed bAsset,
        address pToken,
        uint256 totalAmount,
        uint256 userAmount
    );
    event ReceivedEther(address sender, uint256 amount);

    /// @notice mAsset or Feeder Pool using the integration. eg fPmUSD/LUSD
    /// @dev LP has write access
    address public immutable lpAddress;
    /// @notice LQTY Tokens are being accrued
    address public immutable rewardToken;
    /// @notice BProtocol BAMM contract
    IBProtocolStabilityPool public immutable bamm;
    /// @notice LUSD StabilityPool contract
    IStabilityPool public immutable stabilityPool;
    /// @notice base asset that is integrated to BProtocol stabilityPool. eg LUSD
    address public immutable bAsset;

    /// @notice BProtocol BAMM balances and data storage struct
    struct BammData {
        uint256 lusdTotal;
        uint256 ethTotal;
        uint256 sharesTotal;
        uint256 sharesBalance;
        uint256 lusdBalance;
        uint256 ethBalance;
        uint256 lusdPrice;
    }

    /**
     * @dev Modifier to allow function calls only from the Governor.
     */
    modifier onlyLP() {
        require(msg.sender == lpAddress, "Only the LP can execute");
        _;
    }

    /**
     * @param _nexus            Address of the Nexus
     * @param _lp               Address of liquidity provider. eg mAsset or feeder pool
     * @param _rewardToken      Reward token, LQTY
     * @param _stabilityPool    BProtocol stability pool contract
     * @param _bAsset           base asset to be deposited to BProtocol stabilityPool. eg LUSD
     */
    constructor(
        address _nexus,
        address _lp,
        address _rewardToken,
        address payable _bamm,
        address payable _stabilityPool,
        address _bAsset
    ) ImmutableModule(_nexus) {
        require(_lp != address(0), "Invalid LP address");
        require(_rewardToken != address(0), "Invalid reward token");
        require(_bamm != address(0), "Invalid bamm");
        require(_stabilityPool != address(0), "Invalid stabilityPool");
        require(_bAsset != address(0), "Invalid bAsset address");

        lpAddress = _lp;
        rewardToken = _rewardToken;
        bamm = IBProtocolStabilityPool(_bamm);
        stabilityPool = IStabilityPool(_stabilityPool);
        bAsset = _bAsset;
    }

    /**
     * @dev Approve the spending of the bAsset by BProtocol's stabilityPool contract,
     *      and the spending of the reward token by mStable's Liquidator contract
     */
    function initialize() public initializer {
        _approveContracts();
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Re-approve the spending of the bAsset by BProtocol's stabilityPool contract,
     *      and the spending of the reward token by mStable's Liquidator contract
     *      if for some reason is it necessary. Only callable through Governance.
     */
    function reapproveContracts() external onlyGovernor {
        _approveContracts();
    }

    /**
     * @dev Approve the spending of the assets to PCVModule
     * @param _pcvModule Address of the PCVModule
     */
    function attachPCVModule(address _pcvModule) external onlyGovernor {
        _approveContracts(_pcvModule);
    }

    function _approveContracts() internal {
        // Approve bProtocol LUSD Stability Pool contract to transfer bAssets for deposits.
        MassetHelpers.safeInfiniteApprove(bAsset, address(bamm));
    }

    function _approveContracts(address _pcvModule) internal {
        require(_pcvModule != address(0), "Invalid PCVModule address");
        // Approve PCVModule contract to transfer bAssets
        MassetHelpers.safeInfiniteApprove(rewardToken, _pcvModule);
    }

    /***************************************
                    CORE
    ****************************************/

    /**
     * @notice Deposit a quantity of bAsset into the BProtocol's stabilityPool. Credited cTokens
     *      remain here in the vault. Can only be called by whitelisted addresses
     *      (mAsset and corresponding BasketManager)
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool isTokenFeeCharged
    ) external onlyLP nonReentrant returns (uint256 quantityDeposited) {
        require(_amount > 0, "Must deposit something");
        require(_bAsset == bAsset, "Invalid bAsset");

        quantityDeposited = _amount;

        if (isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = this.checkBalance(_bAsset);
            bamm.deposit(_amount);
            uint256 newBal = this.checkBalance(_bAsset);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            bamm.deposit(_amount);
        }

        emit Deposit(_bAsset, address(stabilityPool), quantityDeposited);
    }

    /**
     * @notice Withdraw a quantity of bAsset from BProtocol Stability Pool
     * @param _receiver     Address to which the withdrawn bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     * @param _hasTxFee     Is the bAsset known to have a tx fee? This integration contract assumes it does
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    ) external onlyLP nonReentrant {
        _withdraw(_receiver, _bAsset, _amount, _amount, _hasTxFee);
    }

    /**
     * @notice Withdraw a quantity of bAsset from BProtocol Stability Pool
     * @param _receiver     Address to which the withdrawn bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     * @param _totalAmount  Total units to pull from lending platform
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    ) external onlyLP nonReentrant {
        _withdraw(_receiver, _bAsset, _amount, _totalAmount, _hasTxFee);
    }

    function _withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    ) internal {
        require(_receiver != address(0), "Must specify recipient");
        require(_bAsset == bAsset, "Invalid bAsset");
        require(_totalAmount > 0, "Must withdraw something");

        uint256 userWithdrawal = _amount;

        // Change here to calculate shares
        IERC20 b = IERC20(_bAsset);
        uint256 prevBal = b.balanceOf(address(this));
        // Change here to calculate shares
        uint256 sharesToWithdraw = _getShares(userWithdrawal);
        bamm.withdraw(sharesToWithdraw);
        uint256 newBal = b.balanceOf(address(this));
        userWithdrawal = _min(userWithdrawal, newBal.sub(prevBal));

        IERC20(_bAsset).safeTransfer(_receiver, userWithdrawal);

        emit PlatformWithdrawal(_bAsset, address(stabilityPool), _totalAmount, userWithdrawal);
    }

    /**
     * @notice Withdraw a quantity of bAsset from the cache.
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdrawRaw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    ) external onlyLP nonReentrant {
        require(_receiver != address(0), "Must specify recipient");
        require(_bAsset == bAsset, "Invalid bAsset");
        require(_amount > 0, "Must withdraw something");

        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(0), _amount);
    }

    /**
     * @notice Get the total bAsset value held in the platform
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset) external view returns (uint256) {
        require(_bAsset == bAsset, "Invalid bAsset");
        BammData memory bammData = getBammData();
        return bammData.lusdBalance;
    }

    /**
     * @notice Simply emits an Event, Triggered when it receives ETH upon withdrawal from BAMM
     */
    receive() external payable {
        emit ReceivedEther(msg.sender, msg.value);
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Simple helper func to get the min of two values
     */
    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? y : x;
    }

    /**
     * @dev function to calculate shares per given amount
     */
    function _getShares(uint256 _quantity) internal view returns (uint256 shares) {
        // call getBammData to get the data
        BammData memory bammData = getBammData();
        shares = (bammData.sharesBalance.divPrecisely(bammData.lusdBalance)).mulTruncateCeil(
            _quantity
        );
    }

    function getBammData() public view returns (BammData memory bammData) {
        bammData.lusdTotal = stabilityPool.getCompoundedLUSDDeposit(address(bamm));
        bammData.ethTotal =
            stabilityPool.getDepositorETHGain(address(bamm)) +
            address(bamm).balance;
        bammData.sharesTotal = bamm.totalSupply();
        bammData.sharesBalance = bamm.balanceOf(address(this));
        bammData.lusdBalance = (bammData.lusdTotal.mul(bammData.sharesBalance))
        .divPrecisely(bammData.sharesTotal)
        .div(StableMath.getFullScale());

        bammData.ethBalance = (bammData.ethTotal.mul(bammData.sharesBalance))
        .divPrecisely(bammData.sharesTotal)
        .div(StableMath.getFullScale());
        bammData.lusdPrice = bamm.fetchPrice();
    }
}
