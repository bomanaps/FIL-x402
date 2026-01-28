// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBondedFacilitator {
    struct Payment {
        address provider;
        uint256 amount;
        uint256 committedAt;
        uint256 deadline;
        bool settled;
        bool claimed;
    }

    event BondDeposited(address indexed facilitator, uint256 amount);
    event BondWithdrawn(address indexed facilitator, uint256 amount);
    event PaymentCommitted(bytes32 indexed paymentId, address indexed provider, uint256 amount);
    event PaymentReleased(bytes32 indexed paymentId);
    event PaymentClaimed(bytes32 indexed paymentId, address indexed provider, uint256 amount);

    function depositBond(uint256 amount) external;
    function withdrawBond(uint256 amount) external;
    function commitPayment(bytes32 paymentId, address provider, uint256 amount) external;
    function releasePayment(bytes32 paymentId) external;
    function claimPayment(bytes32 paymentId) external;
    function getExposure(address facilitator) external view returns (uint256);
    function getAvailableBond(address facilitator) external view returns (uint256);
}
