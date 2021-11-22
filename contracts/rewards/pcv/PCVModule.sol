// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPCVLiquidator } from "./IPCVLiquidator.sol";
// import { IBProtocolStabilityPool } from "../../peripheral/BProtocol/IBProtocolStabilityPool.sol";
// import { IStabilityPool } from "../../peripheral/BProtocol/IStabilityPool.sol";
import { ILQTYStaking } from "../../peripheral/BProtocol/ILQTYStaking.sol";
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { SafeMath } from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title   PCVModule
 * @author  mStable
 * @notice  PCV(Protocol Controlled Value) Module. This module is used to control farmed rewards. Rather than liquidate the rewards, this
 *          module will be used to control the rewards. It will stake a portion of the rewards to earn more rewards. The other portion will be send to the liquidator.
 *          The farmed rewards will be also used partially to buy more staked tokens. The rest will flow back into the pool to distribute to LPs.
 *          This module replaces the liquidator's position, but still uses it to liquidate the assigned portion.
 * @dev     VERSION: 1.0
 *          DATE:    2021-11-09
 */

contract PCVModule is Initializable, ImmutableModule, ReentrancyGuard {
    using SafeMath for uint256;
    using StableMath for uint256;

    /**
     * Events
     */
    event ProcessedStakingToken(
        address stakedToken,
        uint256 stakedAmount,
        address liquidatedToken,
        uint256 liquidatedAmount
    );
    event ProcessedRewardToken(
        address stakedToken,
        uint256 stakedAmount,
        address liquidatedToken,
        uint256 liquidatedAmount
    );
    event ExitToTreasury(
        address stakingToken,
        uint256 stakedAmount,
        address rewardToken,
        uint256 rewardBalance
    );
    event UpdateLiquidationRatios(uint256 liquidationRatioLQTY, uint256 liquidationRatioLUSD);
    event ReceivedEther(address sender, uint256 amount);

    /// @notice PCVLiquidator contract
    IPCVLiquidator public immutable pcvLiquidator;
    /// @notice Integration contract
    address public immutable integrationAddress;
    /// @notice Tokens contract that is used for staking (e.g. LQTY)
    address public immutable stakingToken;
    /// @notice Staking contract used to stake stakingTokens
    ILQTYStaking public immutable stakingContract;
    /// @notice The token that is earned in staking and from the liquidator (e.g. LUSD)
    address public immutable rewardToken;
    /// @notice liquidation ratio for LQTY in 1e18 (e.g. 1e18 = 100%)
    uint256 public liquidationRatioLQTY;
    /// @notice liquidation ratio for LUSD in 1e18 (e.g. 1e18 = 100%)
    uint256 public liquidationRatioLUSD;

    // /// @notice liquidator address
    // address public immutable liquidatorAddress;

    /**
     * Structs
     */

    /**
     * Modifiers
     */

    /**
     * @param _nexus                    Address of the Nexus
     * @param _pcvLiquidatorAddress     Address of the PCVLiquidator
     * @param _integrationAddress       Address of the Integration contract
     * @param _stakingToken             Token that can be staked, LQTY
     * @param _stakingContract          Contract address for staking the stakingToken, LQTYStaking
     * @param _rewardToken              Reward token, LUSD (Is earned from staking and liquidating LQTY)
     * @param _liquidationRatioLQTY     Liquidation ratio for LQTY in 1e18 (e.g. 1e18 = 100%)
     * @param _liquidationRatioLUSD     Liquidation ratio for LUSD in 1e18 (e.g. 1e18 = 100%)
     */
    constructor(
        address _nexus,
        address _pcvLiquidatorAddress,
        address _integrationAddress,
        address _stakingToken,
        address payable _stakingContract,
        address _rewardToken,
        uint256 _liquidationRatioLQTY,
        uint256 _liquidationRatioLUSD
    ) ImmutableModule(_nexus) {
        require(_pcvLiquidatorAddress != address(0), "Invalid PCVLiquidator address");
        require(_integrationAddress != address(0), "Invalid Integration address");
        require(_stakingToken != address(0), "Invalid staking token address");
        require(_stakingContract != address(0), "Invalid staking contract address");
        require(_rewardToken != address(0), "Invalid reward token address");
        require(
            0 <= _liquidationRatioLQTY && _liquidationRatioLQTY <= 1e18,
            "Invalid liquidation ratio"
        );
        require(
            0 <= _liquidationRatioLUSD && _liquidationRatioLUSD <= 1e18,
            "Invalid liquidation ratio"
        );

        pcvLiquidator = IPCVLiquidator(_pcvLiquidatorAddress);
        integrationAddress = _integrationAddress;
        stakingToken = _stakingToken;
        stakingContract = ILQTYStaking(_stakingContract);
        rewardToken = _rewardToken;
        liquidationRatioLQTY = _liquidationRatioLQTY;
        liquidationRatioLUSD = _liquidationRatioLUSD;
    }

    /**
     * @dev Approve the spending of the assets.
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

    function _approveContracts() internal {
        // Approve pcvLiquidator to transfer reward token when claiming rewards.
        // Approve stakingContract to spend LQTY
        MassetHelpers.safeInfiniteApprove(stakingToken, address(stakingContract));
        // Approve liquidator to spend LQTY
        MassetHelpers.safeInfiniteApprove(stakingToken, address(pcvLiquidator));
        // Approve liquidator to spend LUSD
        MassetHelpers.safeInfiniteApprove(rewardToken, address(pcvLiquidator));
    }

    /**
     * @dev Update the liquidation ratio.
     */
    function updateLiquidationRatios(uint256 _liquidationRatioLQTY, uint256 _liquidationRatioLUSD)
        external
        onlyGovernor
    {
        require(
            0 <= _liquidationRatioLQTY && _liquidationRatioLQTY <= 1e18,
            "Invalid liquidation ratio"
        );
        require(
            0 <= _liquidationRatioLUSD && _liquidationRatioLUSD <= 1e18,
            "Invalid liquidation ratio"
        );

        _updateLiquidationRatios(_liquidationRatioLQTY, _liquidationRatioLUSD);
    }

    function _updateLiquidationRatios(uint256 _liquidationRatioLQTY, uint256 _liquidationRatioLUSD)
        internal
    {
        liquidationRatioLQTY = _liquidationRatioLQTY;
        liquidationRatioLUSD = _liquidationRatioLUSD;

        emit UpdateLiquidationRatios(liquidationRatioLQTY, liquidationRatioLUSD);
    }

    /**
     * @dev Claims all staked tokens and sends them to the Treasury
     */
    function exitToTreasury() external onlyGovernor {
        _exitToTreasury();
    }

    function _exitToTreasury() internal {
        // Check if staked tokens are available
        uint256 stakedAmount = stakingContract.stakes(address(this));
        // Check if module has rewards
        uint256 rewardBalance = IERC20(rewardToken).balanceOf(address(this));
        require(stakedAmount > 0 || rewardBalance > 0, "Nothing to exit");

        // Get Treasury address
        address treasury = nexus.getModule(keccak256("Treasury"));
        require(treasury != address(0), "Treasury module not found");

        if (stakedAmount > 0) {
            // unstake all
            stakingContract.unstake(stakedAmount);
            // send LQTY to treasury
            SafeERC20.safeTransfer(IERC20(stakingToken), treasury, stakedAmount);
            // send LUSD to integration
        }

        if (rewardBalance > 0) {
            SafeERC20.safeTransfer(IERC20(rewardToken), treasury, rewardBalance);
        }

        // TODO: send ETH somewhere?
        emit ExitToTreasury(stakingToken, stakedAmount, rewardToken, rewardBalance);
    }

    /***************************************
                    CORE
    ****************************************/

    /**
     * @notice Claims tokens from the integration contract.
     *         LQTY -> 50% to LQTY Staking
     *         LQTY -> 50% to Liquidator -> LUSD -> Feeder Pool
     * @dev    Any staking or unstaking will claim LUSD and ETH
     */
    function handleStakingToken() external nonReentrant {
        // 1. Transfer Tokens from Integration
        uint256 transferAmount = IERC20(stakingToken).balanceOf(integrationAddress);
        require(transferAmount > 0, "No tokens to handle");

        SafeERC20.safeTransferFrom(
            IERC20(stakingToken),
            integrationAddress,
            address(this),
            transferAmount
        );

        // 2. Transfer Tokens to Staking Contract
        uint256 stakeAmount = IERC20(stakingToken)
        .balanceOf(address(this))
        .mul(1e18 - liquidationRatioLQTY)
        .div(1e18);
        stakingContract.stake(stakeAmount);

        // 3. Liquidate LQTY to LUSD and transfer back to integration
        uint256 remainderLQTY = IERC20(stakingToken).balanceOf(address(this));
        uint256 liquidatedAmount = 0;
        // Check if there is any LQTY to liquidate
        if (remainderLQTY > 0) {
            // Liquidate LQTY to LUSD
            pcvLiquidator.triggerLiquidation(stakingToken, remainderLQTY);
            liquidatedAmount = IERC20(rewardToken).balanceOf(address(this));
            SafeERC20.safeTransfer(IERC20(rewardToken), integrationAddress, liquidatedAmount);
        }

        // 4. Emit an Event
        emit ProcessedStakingToken(stakingToken, stakeAmount, rewardToken, liquidatedAmount);
    }

    /**
     * @notice Claims tokens from the staking contract
     *         Claims LUSD (Unstake small amount)
     *         LUSD -> 50% to Feeder Pool
     *         LUSD -> 50% to Liquidator -> LQTY -> Staking
     */
    function handleRewardToken() external nonReentrant {
        // 1. Claim earned tokens from staking contract
        uint256 pendingRewards = stakingContract.getPendingLUSDGain(address(this));
        require(pendingRewards > 0, "No pending rewards");
        stakingContract.unstake(1);

        // 2. Liquidate LUSD to LQTY
        uint256 toLiquidateLUSD = IERC20(rewardToken)
        .balanceOf(address(this))
        .mul(liquidationRatioLUSD)
        .div(1e18);

        if (toLiquidateLUSD > 0) {
            pcvLiquidator.triggerLiquidation(rewardToken, toLiquidateLUSD);
        }

        // 3a. Stake LQTY
        uint256 stakeAmount = IERC20(stakingToken).balanceOf(address(this));
        if (stakeAmount > 0) {
            stakingContract.stake(stakeAmount);
        }

        // 3. Transfer LUSD to Feeder Pool
        uint256 distributionAmount = IERC20(rewardToken).balanceOf(address(this));
        if (distributionAmount > 0) {
            SafeERC20.safeTransfer(IERC20(rewardToken), integrationAddress, distributionAmount);
        }

        // 4. Emit an Event
        emit ProcessedRewardToken(rewardToken, distributionAmount, stakingToken, stakeAmount);
    }

    /**
     * @notice Simply emits an Event, Triggered when it receives ETH upon withdrawal from BAMM
     */
    receive() external payable {
        emit ReceivedEther(msg.sender, msg.value);
    }

    /***************************************
                    INTERNAL
    ****************************************/
}
