// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IPCVLiquidator {
    struct Liquidation {
        address sellToken;
        address buyToken;
        bytes uniswapPath;
        bytes uniswapPathReversed;
        uint256 allowedSlippage; // allowed slippage in percentage in % (e.g. 0.1% = 10e15, 100% = 1e18)
        uint256 lastTriggered;
    }

    function activatePCVModule(address _pcvModule) external;

    function createLiquidation(
        address _pcvModule,
        address _sellToken,
        address _buyToken,
        bytes calldata _uniswapPath,
        bytes calldata _uniswapPathReversed,
        uint256 _allowedSlippage,
        bool _override
    ) external;

    function deactivatePCVModule(address _pcvModule) external;

    function deleteLiquidation(address _pcvModule, address _sellToken) external;

    function getLiquidation(address _pcvModule, address _sellToken)
        external
        view
        returns (Liquidation memory);

    function initialize() external;

    function nexus() external view returns (address);

    function reApproveLiquidation(address _pcvModule, address _sellToken) external;

    function triggerLiquidation(address _sellToken, uint256 _amount) external;

    function uniswapQuoter() external view returns (address);

    function uniswapRouter() external view returns (address);
}
