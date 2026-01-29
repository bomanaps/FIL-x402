// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDeferredPaymentEscrow {
    struct Voucher {
        bytes32 id;
        address buyer;
        address seller;
        uint256 valueAggregate; // Monotonically increasing total
        address asset;
        uint64 timestamp;
        uint256 nonce;          // Increments with each aggregation
        address escrow;
        uint256 chainId;
    }

    struct EscrowAccount {
        uint256 balance;
        uint256 thawingAmount;
        uint64 thawEndTime;
    }

    event Deposited(address indexed buyer, uint256 amount);
    event ThawStarted(address indexed buyer, uint256 amount, uint64 thawEndTime);
    event Withdrawn(address indexed buyer, uint256 amount);
    event Collected(bytes32 indexed voucherId, address indexed buyer, address indexed seller, uint256 amount);

    function deposit(uint256 amount) external;
    function thaw(uint256 amount) external;
    function withdraw() external;
    function collect(Voucher calldata voucher, bytes calldata signature) external;
    function collectMany(Voucher[] calldata vouchers, bytes[] calldata signatures) external;
    function getAccount(address buyer) external view returns (EscrowAccount memory);
}
