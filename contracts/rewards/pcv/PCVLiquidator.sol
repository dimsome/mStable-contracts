// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IUniswapV3SwapRouter } from "../../peripheral/Uniswap/IUniswapV3SwapRouter.sol";
import { IUniswapV3Quoter } from "../../peripheral/Uniswap/IUniswapV3Quoter.sol";

import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";

/**
 * @title   Liquidator
 * @author  mStable
 * @notice  PCVLiquidator Module for the PCV Module. Allows to store multiple liquidation paths per PCVModule contract for each token that is to be liquidated.
 *          Added support to specify the amount of tokens to be liquidated.
 *          Liquidation and PCVModules are to be add/created via Govenor.
 *          Liquidations are triggered by the PCVModule contract.
 *          Liquidation is done via the UniswapV3SwapRouter contract.
 *          Based on the previous Liquidator version 1.3.
 * @dev     VERSION: 1.0
 *          DATE:    2021-11-12
 */

contract PCVLiquidator is Initializable, ImmutableModule, InitializableReentrancyGuard {
    /**
     * Libraries
     */
    using SafeERC20 for IERC20;

    /**
     * Events
     */
    event LiquidationModified(address indexed pcvModule, address sellToken);
    event LiquidationDeleted(address indexed pcvModule, address sellToken);
    event Liquidated(
        address indexed pcvModule,
        address sellToken,
        uint256 amountSellToken,
        address buyToken,
        uint256 amountBuyToken
    );
    event PCVModuleActivated(address indexed pcvModule);
    event PCVModuleDeactivated(address indexed pcvModule);

    /**
     * Vars
     */
    /// @notice mapping of PCVModule addresses to liquidation data
    mapping(address => PCVModule) internal pcvModules;
    /// @notice Uniswap V3 Router address
    IUniswapV3SwapRouter public immutable uniswapRouter;
    /// @notice Uniswap V3 Quoter address
    IUniswapV3Quoter public immutable uniswapQuoter;

    /**
     * Structs
     */
    struct PCVModule {
        /// @notice PCVModule active status
        /// @dev true if the PCVModule is active, false otherwise
        bool active;
        /// @notice mapping of token addresses to liquidation data
        /// @dev A PCVModule can have multiple tokens to be liquidated.
        mapping(address => Liquidation) liquidation;
    }

    struct Liquidation {
        address sellToken;
        address buyToken;
        bytes uniswapPath;
        bytes uniswapPathReversed;
        uint256 allowedSlippage; // allowed slippage in percentage in % (e.g. 0.1% = 10e15, 100% = 1e18)
        uint256 lastTriggered;
    }

    /**
     * Modifiers
     */
    modifier onlyPCVModules {
        require(pcvModules[msg.sender].active, "PCVModule is not active");
        _;
    }

    /**
     * @dev Constructor
     * @param _nexus                    Address of the Nexus
     * @param _uniswapRouter            Address of the Uniswap V3 Router
     * @param _uniswapQuoter            Address of the Uniswap V3 Quoter
     */

    constructor(
        address _nexus,
        address _uniswapRouter,
        address _uniswapQuoter
    ) ImmutableModule(_nexus) {
        require(_uniswapRouter != address(0), "Invalid Uniswap Router address");
        uniswapRouter = IUniswapV3SwapRouter(_uniswapRouter);

        require(_uniswapQuoter != address(0), "Invalid Uniswap Quoter address");
        uniswapQuoter = IUniswapV3Quoter(_uniswapQuoter);
    }

    /**
     * @notice Not sure if this is needed
     * @dev to be called via the proxy proposeUpgrade function, not the constructor.
     */
    function initialize() external initializer {
        _initializeReentrancyGuard();
    }

    /***************************************
                    GOVERNANCE
    ****************************************/
    /**
     * @notice Create a liquidation for a given token and PCVModule
     * @param _pcvModule The PCVModule contract address from which to receive sellToken
     * @param _sellToken Token harvested from the PCVModule contract. eg LQTY
     * @param _buyToken Token to be bought and send back to PCVModule contract. eg LUSD
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     * @param _uniswapPathReversed The Uniswap V3 bytes encoded reversed path.
     * @param _allowedSlippage The allowed slippage in percentage in % (e.g. 0.1% = 10e15, 100% = 1e18)
     * @param _override If true, will override the liquidation if it already exists
     */
    function createLiquidation(
        address _pcvModule,
        address _sellToken,
        address _buyToken,
        bytes calldata _uniswapPath,
        bytes calldata _uniswapPathReversed,
        uint256 _allowedSlippage,
        bool _override
    ) external onlyGovernance {
        // Check inputs
        require(
            _pcvModule != address(0) &&
                _sellToken != address(0) &&
                _buyToken != address(0) &&
                _allowedSlippage > 0 &&
                _allowedSlippage <= 1e18,
            "Invalid inputs"
        );

        // Load liquidation data
        Liquidation memory liquidation = getLiquidation(_pcvModule, _sellToken);

        // Check if the PCVModule is already registered
        require(liquidation.sellToken == address(0) || _override, "Liquidation already exists");

        require(_validUniswapPath(_sellToken, _buyToken, _uniswapPath), "Invalid uniswap path");
        require(
            _validUniswapPath(_buyToken, _sellToken, _uniswapPathReversed),
            "Invalid uniswap path reversed"
        );

        // Create Liquidation
        pcvModules[_pcvModule].liquidation[_sellToken] = Liquidation({
            sellToken: _sellToken,
            buyToken: _buyToken,
            uniswapPath: _uniswapPath,
            uniswapPathReversed: _uniswapPathReversed,
            allowedSlippage: _allowedSlippage,
            lastTriggered: 0
        });

        if (!pcvModules[_pcvModule].active) {
            pcvModules[_pcvModule].active = true;
            emit PCVModuleActivated(_pcvModule);
        }

        // approve spending of sellToken
        IERC20(_sellToken).safeApprove(address(uniswapRouter), type(uint256).max);

        emit LiquidationModified(_pcvModule, _sellToken);
    }

    /**
     * @notice Delete a liquidation for a given token and PCVModule
     * @param _pcvModule The PCVModule contract address from which to receive sellToken
     * @param _sellToken Token harvested from the PCVModule contract. eg LQTY
     */
    function deleteLiquidation(address _pcvModule, address _sellToken) external onlyGovernance {
        Liquidation memory liquidation = getLiquidation(_pcvModule, _sellToken);
        require(liquidation.sellToken != address(0), "Liquidation does not exist");

        delete pcvModules[_pcvModule].liquidation[_sellToken];

        emit LiquidationDeleted(_pcvModule, _sellToken);
    }

    /**
     * @notice Activate a PCVModule
     * @param _pcvModule The PCVModule contract address
     */
    function activatePCVModule(address _pcvModule) external onlyGovernance {
        require(pcvModules[_pcvModule].active == false, "PCVModule is already active");

        pcvModules[_pcvModule].active = true;

        emit PCVModuleActivated(_pcvModule);
    }

    /**
     * @notice Deactivate a PCVModule
     * @param _pcvModule The PCVModule contract address
     */
    function deactivatePCVModule(address _pcvModule) external onlyGovernance {
        require(pcvModules[_pcvModule].active == true, "PCVModule is already inactive");

        pcvModules[_pcvModule].active = false;

        emit PCVModuleDeactivated(_pcvModule);
    }

    /**
     * @notice reapproves the sellToken allowance to the UniswapV3Router
     * @param _pcvModule The PCVModule contract address
     * @param _sellToken The sellToken address
     */
    function reApproveLiquidation(address _pcvModule, address _sellToken) external onlyGovernance {
        // Load Liquidation into memory
        Liquidation memory liquidation = pcvModules[_pcvModule].liquidation[_sellToken];

        require(liquidation.sellToken != address(0), "Liquidation does not exist");

        IERC20(_sellToken).safeApprove(address(uniswapRouter), 0);
        IERC20(_sellToken).safeApprove(address(uniswapRouter), type(uint256).max);
    }

    /***************************************
                    LIQUIDATION
    ****************************************/
    /**
     * @notice Triggers a single liquidation, flow:
     *    - transfers sellToken from PCVModule to PCVLiquidator. eg LQTY
     *    - Swap sell token for buyToken on Uniswap (up to trancheAmount). eg
     *      - LQTY to LUSD
     *    - Transfer butToken to PCVModule contract. eg transfer LUSD
     * @dev Caller msg.sender is the PCVModule contract
     * @param _sellToken Token harvested from the PCVModule contract. eg LQTY
     * @param _amount How much sellToken to sell. eg LQTY
     */
    function triggerLiquidation(address _sellToken, uint256 _amount) external onlyPCVModules {
        address pcvModule = msg.sender;

        // Load Liquidation into memory
        Liquidation memory liquidation = getLiquidation(pcvModule, _sellToken);
        require(liquidation.sellToken != address(0), "Liquidation does not exist");

        // Check if liquidation has already been triggered
        require(block.timestamp > liquidation.lastTriggered + 7 days, "Must wait for interval");

        liquidation.lastTriggered = block.timestamp;

        address sellToken = liquidation.sellToken;

        // 1. Transfer the sellToken from the PCVModule to the PCVLiquidator
        //    Assumes that the sellToken is approved by the PCVModule

        // Check if valid amount
        require(_amount > 0 && _amount <= IERC20(sellToken).balanceOf(pcvModule), "Invalid amount");
        IERC20(sellToken).safeTransferFrom(pcvModule, address(this), _amount);

        // 2. Swap sell token for buyToken on Uniswap
        //    Check contract balance
        uint256 balanceSellToken = IERC20(sellToken).balanceOf(address(this));

        // calculate output without swapping
        uint256 amountOut = uniswapQuoter.quoteExactInput(
            liquidation.uniswapPath,
            balanceSellToken
        );
        uint256 buyTokenDecimals = IBasicToken(liquidation.buyToken).decimals();
        // TODO: Check this math is correct
        uint256 minOut = (amountOut * liquidation.allowedSlippage) / (10**buyTokenDecimals);

        IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter.ExactInputParams(
            liquidation.uniswapPath,
            address(this),
            block.timestamp,
            balanceSellToken,
            minOut
        );

        uniswapRouter.exactInput(param);

        // 3. Transfer the buyToken to the PCVModule contract
        uint256 amountBuyToken = IERC20(liquidation.buyToken).balanceOf(address(this));
        IERC20(liquidation.buyToken).transfer(pcvModule, amountBuyToken);

        emit Liquidated(
            pcvModule,
            _sellToken,
            balanceSellToken,
            liquidation.buyToken,
            amountBuyToken
        );
    }

    /***************************************
                    INTERNAL
    ****************************************/
    /**
     * @notice Validates a given uniswap path - valid if sellToken at position 0 and bAsset at end
     * @param _sellToken Token harvested from the integration contract
     * @param _buyToken New asset to buy on Uniswap
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     */
    function _validUniswapPath(
        address _sellToken,
        address _buyToken,
        bytes calldata _uniswapPath
    ) internal pure returns (bool) {
        uint256 len = _uniswapPath.length;
        require(_uniswapPath.length >= 43, "Uniswap path too short");
        // check sellToken is first 20 bytes and bAsset is the last 20 bytes of the uniswap path
        return
            keccak256(abi.encodePacked(_sellToken)) ==
            keccak256(abi.encodePacked(_uniswapPath[0:20])) &&
            keccak256(abi.encodePacked(_buyToken)) ==
            keccak256(abi.encodePacked(_uniswapPath[len - 20:len]));
    }

    /***************************************
                    GETTERS
    ****************************************/
    /**
     * @dev Returns the liquidation data for a given token and PCVModule
     * @param _pcvModule The PCVModule contract address
     * @param _sellToken Token harvested from the PCVModule contract. eg LQTY
     */
    function getLiquidation(address _pcvModule, address _sellToken)
        public
        view
        returns (Liquidation memory)
    {
        return pcvModules[_pcvModule].liquidation[_sellToken];
    }
}
