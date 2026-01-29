// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IDeferredPaymentEscrow.sol";

/**
 * @title DeferredPaymentEscrow
 * @notice Escrow contract for x402 deferred payments.
 *         Buyers deposit funds, sign vouchers off-chain with monotonically
 *         increasing valueAggregate. Sellers call collect() to settle
 *         the latest voucher, paying only the delta since last collection.
 *
 *         Withdrawal requires a 1-day thawing period to prevent
 *         race conditions between voucher settlement and withdrawal.
 */
contract DeferredPaymentEscrow is IDeferredPaymentEscrow, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    /// @notice Thawing period before withdrawal (1 day)
    uint256 public constant THAW_PERIOD = 1 days;

    /// @notice EIP-712 typehash for Voucher
    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(bytes32 id,address buyer,address seller,uint256 valueAggregate,address asset,uint64 timestamp,uint256 nonce,address escrow,uint256 chainId)"
    );

    /// @notice buyer => EscrowAccount
    mapping(address => EscrowAccount) private accounts;

    /// @notice voucherId => highest settled nonce
    mapping(bytes32 => uint256) public settledNonce;

    /// @notice voucherId => total value already collected
    mapping(bytes32 => uint256) public collectedValue;

    constructor(
        address _token
    ) EIP712("DeferredPaymentEscrow", "1") {
        require(_token != address(0), "zero token address");
        token = IERC20(_token);
    }

    // ──────────────────────────────────────────────
    // Deposit
    // ──────────────────────────────────────────────

    /// @inheritdoc IDeferredPaymentEscrow
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        accounts[msg.sender].balance += amount;
        emit Deposited(msg.sender, amount);
    }

    // ──────────────────────────────────────────────
    // Thaw / Withdraw
    // ──────────────────────────────────────────────

    /// @inheritdoc IDeferredPaymentEscrow
    function thaw(uint256 amount) external {
        EscrowAccount storage acct = accounts[msg.sender];
        require(amount > 0, "zero amount");
        require(amount <= acct.balance, "exceeds balance");

        acct.thawingAmount = amount;
        acct.thawEndTime = uint64(block.timestamp + THAW_PERIOD);

        emit ThawStarted(msg.sender, amount, acct.thawEndTime);
    }

    /// @inheritdoc IDeferredPaymentEscrow
    function withdraw() external nonReentrant {
        EscrowAccount storage acct = accounts[msg.sender];
        require(acct.thawingAmount > 0, "nothing thawing");
        require(block.timestamp >= acct.thawEndTime, "thaw not complete");

        uint256 amount = acct.thawingAmount;

        // Clamp to actual balance (vouchers may have been collected during thaw)
        if (amount > acct.balance) {
            amount = acct.balance;
        }

        acct.balance -= amount;
        acct.thawingAmount = 0;
        acct.thawEndTime = 0;

        token.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ──────────────────────────────────────────────
    // Collect (settle vouchers)
    // ──────────────────────────────────────────────

    /// @inheritdoc IDeferredPaymentEscrow
    function collect(
        Voucher calldata voucher,
        bytes calldata signature
    ) external nonReentrant {
        _collect(voucher, signature);
    }

    /// @inheritdoc IDeferredPaymentEscrow
    function collectMany(
        Voucher[] calldata vouchers,
        bytes[] calldata signatures
    ) external nonReentrant {
        require(vouchers.length == signatures.length, "length mismatch");
        for (uint256 i = 0; i < vouchers.length; i++) {
            _collect(vouchers[i], signatures[i]);
        }
    }

    // ──────────────────────────────────────────────
    // View
    // ──────────────────────────────────────────────

    /// @inheritdoc IDeferredPaymentEscrow
    function getAccount(address buyer) external view returns (EscrowAccount memory) {
        return accounts[buyer];
    }

    /// @notice Get the domain separator for EIP-712
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ──────────────────────────────────────────────
    // Internal
    // ──────────────────────────────────────────────

    function _collect(
        Voucher calldata v,
        bytes calldata signature
    ) internal {
        // Validate voucher fields
        require(v.asset == address(token), "wrong asset");
        require(v.escrow == address(this), "wrong escrow");
        require(v.chainId == block.chainid, "wrong chain");
        require(v.valueAggregate > 0, "zero value");

        // Nonce must be strictly greater than previously settled
        require(v.nonce > settledNonce[v.id], "stale nonce");

        // valueAggregate must be monotonically increasing
        require(v.valueAggregate > collectedValue[v.id], "value not increasing");

        // Verify EIP-712 signature from buyer
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            v.id,
            v.buyer,
            v.seller,
            v.valueAggregate,
            v.asset,
            v.timestamp,
            v.nonce,
            v.escrow,
            v.chainId
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == v.buyer, "invalid signature");

        // Calculate delta (new amount to pay)
        uint256 delta = v.valueAggregate - collectedValue[v.id];

        // Check buyer has enough escrowed balance
        EscrowAccount storage acct = accounts[v.buyer];
        require(delta <= acct.balance, "insufficient escrow balance");

        // Update state
        settledNonce[v.id] = v.nonce;
        collectedValue[v.id] = v.valueAggregate;
        acct.balance -= delta;

        // Cancel any thawing that would exceed remaining balance
        if (acct.thawingAmount > acct.balance) {
            acct.thawingAmount = acct.balance;
        }

        // Transfer delta to seller
        token.safeTransfer(v.seller, delta);

        emit Collected(v.id, v.buyer, v.seller, delta);
    }
}
