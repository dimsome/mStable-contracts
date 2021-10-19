// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface ILiquityStabilityPool {
    function BORROWING_FEE_FLOOR() external view returns (uint256);

    function CCR() external view returns (uint256);

    function DECIMAL_PRECISION() external view returns (uint256);

    function LUSD_GAS_COMPENSATION() external view returns (uint256);

    function MCR() external view returns (uint256);

    function MIN_NET_DEBT() external view returns (uint256);

    function NAME() external view returns (string memory);

    function P() external view returns (uint256);

    function PERCENT_DIVISOR() external view returns (uint256);

    function SCALE_FACTOR() external view returns (uint256);

    function _100pct() external view returns (uint256);

    function activePool() external view returns (address);

    function borrowerOperations() external view returns (address);

    function communityIssuance() external view returns (address);

    function currentEpoch() external view returns (uint128);

    function currentScale() external view returns (uint128);

    function defaultPool() external view returns (address);

    function depositSnapshots(address)
        external
        view
        returns (
            uint256 S,
            uint256 P,
            uint256 G,
            uint128 scale,
            uint128 epoch
        );

    function deposits(address) external view returns (uint256 initialValue, address frontEndTag);

    function epochToScaleToG(uint128, uint128) external view returns (uint256);

    function epochToScaleToSum(uint128, uint128) external view returns (uint256);

    function frontEndSnapshots(address)
        external
        view
        returns (
            uint256 S,
            uint256 P,
            uint256 G,
            uint128 scale,
            uint128 epoch
        );

    function frontEndStakes(address) external view returns (uint256);

    function frontEnds(address) external view returns (uint256 kickbackRate, bool registered);

    function getCompoundedFrontEndStake(address _frontEnd) external view returns (uint256);

    function getCompoundedLUSDDeposit(address _depositor) external view returns (uint256);

    function getDepositorETHGain(address _depositor) external view returns (uint256);

    function getDepositorLQTYGain(address _depositor) external view returns (uint256);

    function getETH() external view returns (uint256);

    function getEntireSystemColl() external view returns (uint256 entireSystemColl);

    function getEntireSystemDebt() external view returns (uint256 entireSystemDebt);

    function getFrontEndLQTYGain(address _frontEnd) external view returns (uint256);

    function getTotalLUSDDeposits() external view returns (uint256);

    function isOwner() external view returns (bool);

    function lastETHError_Offset() external view returns (uint256);

    function lastLQTYError() external view returns (uint256);

    function lastLUSDLossError_Offset() external view returns (uint256);

    function lusdToken() external view returns (address);

    function offset(uint256 _debtToOffset, uint256 _collToAdd) external;

    function owner() external view returns (address);

    function priceFeed() external view returns (address);

    function provideToSP(uint256 _amount, address _frontEndTag) external;

    function registerFrontEnd(uint256 _kickbackRate) external;

    function setAddresses(
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _activePoolAddress,
        address _lusdTokenAddress,
        address _sortedTrovesAddress,
        address _priceFeedAddress,
        address _communityIssuanceAddress
    ) external;

    function sortedTroves() external view returns (address);

    function troveManager() external view returns (address);

    function withdrawETHGainToTrove(address _upperHint, address _lowerHint) external;

    function withdrawFromSP(uint256 _amount) external;

    receive() external payable;
}
