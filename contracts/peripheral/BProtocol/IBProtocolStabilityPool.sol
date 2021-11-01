// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

/**
 * @dev BProtocol Stability Pool Integration
 * Source: https://github.com/backstop-protocol/dev/blob/main/packages/contracts/contracts/B.Protocol/BAMM.sol
 */

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBProtocolStabilityPool {
    function A() external view returns (uint256);

    function LUSD() external view returns (address);

    function MAX_A() external view returns (uint256);

    function MAX_FEE() external view returns (uint256);

    function MIN_A() external view returns (uint256);

    function PRECISION() external view returns (uint256);

    function SP() external view returns (address);

    function add(uint256 x, uint256 y) external pure returns (uint256 z);

    function balanceOf(address owner) external view returns (uint256 balance);

    function bonus() external view returns (address);

    function crops(address) external view returns (uint256);

    function dec() external view returns (uint256);

    function decimals() external view returns (uint256);

    function deposit(uint256 lusdAmount) external;

    function fee() external view returns (uint256);

    function feePool() external view returns (address);

    function fetchPrice() external view returns (uint256);

    function frontEndTag() external view returns (address);

    function gem() external view returns (address);

    function getConversionRate(
        address,
        address,
        uint256 srcQty,
        uint256
    ) external view returns (uint256);

    function getReturn(
        uint256 xQty,
        uint256 xBalance,
        uint256 yBalance,
        uint256 A
    ) external pure returns (uint256);

    function getSumFixedPoint(
        uint256 x,
        uint256 y,
        uint256 A
    ) external pure returns (uint256);

    function getSwapEthAmount(uint256 lusdQty)
        external
        view
        returns (uint256 ethAmount, uint256 feeEthAmount);

    function ilk() external view returns (bytes32);

    function isOwner() external view returns (bool);

    function maxDiscount() external view returns (uint256);

    function mul(uint256 x, uint256 y) external pure returns (uint256 z);

    function name() external view returns (string memory);

    function nav() external returns (uint256);

    function nps() external returns (uint256);

    function owner() external view returns (address);

    function priceAggregator() external view returns (address);

    function rdiv(uint256 x, uint256 y) external pure returns (uint256 z);

    function rmul(uint256 x, uint256 y) external pure returns (uint256 z);

    function rmulup(uint256 x, uint256 y) external pure returns (uint256 z);

    function setParams(uint256 _A, uint256 _fee) external;

    function share() external view returns (uint256);

    function stake(address) external view returns (uint256);

    function stock() external view returns (uint256);

    function sub(uint256 x, uint256 y) external pure returns (uint256 z);

    function swap(
        uint256 lusdAmount,
        uint256 minEthReturn,
        address dest
    ) external returns (uint256);

    function symbol() external view returns (string memory);

    function total() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function trade(
        address,
        uint256 srcAmount,
        address,
        address destAddress,
        uint256,
        bool
    ) external returns (bool);

    function transferOwnership(address newOwner) external;

    function vat() external view returns (address);

    function wdiv(uint256 x, uint256 y) external pure returns (uint256 z);

    function wdivup(uint256 x, uint256 y) external pure returns (uint256 z);

    function withdraw(uint256 numShares) external;

    function wmul(uint256 x, uint256 y) external pure returns (uint256 z);

    receive() external payable;
}
