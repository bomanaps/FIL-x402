// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IBondedFacilitator.sol";

/**
 * @title BondedFacilitator
 * @notice On-chain bond collateral for x402 optimistic settlement.
 *         A facilitator deposits USDFC as bond. When processing a payment,
 *         it commits bond equal to the payment amount. On successful settlement
 *         the bond is released. If settlement fails and the deadline passes,
 *         the provider can claim directly from the bond.
 */
contract BondedFacilitator is IBondedFacilitator, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    /// @notice Settlement deadline duration (10 minutes)
    uint256 public constant CLAIM_TIMEOUT = 10 minutes;

    /// @notice facilitator address => total bond deposited
    mapping(address => uint256) public bondBalance;

    /// @notice facilitator address => total currently committed
    mapping(address => uint256) public totalCommitted;

    /// @notice paymentId => Payment struct
    mapping(bytes32 => Payment) public payments;

    /// @notice paymentId => facilitator that committed it
    mapping(bytes32 => address) public paymentFacilitator;

    constructor(address _token) {
        require(_token != address(0), "zero token address");
        token = IERC20(_token);
    }

    // ──────────────────────────────────────────────
    // Bond management
    // ──────────────────────────────────────────────

    /// @inheritdoc IBondedFacilitator
    function depositBond(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        bondBalance[msg.sender] += amount;
        emit BondDeposited(msg.sender, amount);
    }

    /// @inheritdoc IBondedFacilitator
    function withdrawBond(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        uint256 available = bondBalance[msg.sender] - totalCommitted[msg.sender];
        require(amount <= available, "exceeds available bond");
        bondBalance[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(msg.sender, amount);
    }

    // ──────────────────────────────────────────────
    // Payment lifecycle
    // ──────────────────────────────────────────────

    /// @inheritdoc IBondedFacilitator
    function commitPayment(
        bytes32 paymentId,
        address provider,
        uint256 amount
    ) external nonReentrant {
        require(provider != address(0), "zero provider");
        require(amount > 0, "zero amount");
        require(payments[paymentId].provider == address(0), "payment exists");

        uint256 available = bondBalance[msg.sender] - totalCommitted[msg.sender];
        require(amount <= available, "insufficient bond");

        payments[paymentId] = Payment({
            provider: provider,
            amount: amount,
            committedAt: block.timestamp,
            deadline: block.timestamp + CLAIM_TIMEOUT,
            settled: false,
            claimed: false
        });
        paymentFacilitator[paymentId] = msg.sender;
        totalCommitted[msg.sender] += amount;

        emit PaymentCommitted(paymentId, provider, amount);
    }

    /// @inheritdoc IBondedFacilitator
    function releasePayment(bytes32 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.provider != address(0), "payment not found");
        require(!p.settled && !p.claimed, "already resolved");
        require(paymentFacilitator[paymentId] == msg.sender, "not facilitator");

        p.settled = true;
        totalCommitted[msg.sender] -= p.amount;

        emit PaymentReleased(paymentId);
    }

    /// @inheritdoc IBondedFacilitator
    function claimPayment(bytes32 paymentId) external nonReentrant {
        Payment storage p = payments[paymentId];
        require(p.provider != address(0), "payment not found");
        require(!p.settled && !p.claimed, "already resolved");
        require(block.timestamp > p.deadline, "deadline not reached");
        require(msg.sender == p.provider, "not provider");

        address facilitator = paymentFacilitator[paymentId];

        p.claimed = true;
        totalCommitted[facilitator] -= p.amount;
        bondBalance[facilitator] -= p.amount;

        token.safeTransfer(p.provider, p.amount);

        emit PaymentClaimed(paymentId, p.provider, p.amount);
    }

    // ──────────────────────────────────────────────
    // View helpers
    // ──────────────────────────────────────────────

    /// @inheritdoc IBondedFacilitator
    function getExposure(address facilitator) external view returns (uint256) {
        return totalCommitted[facilitator];
    }

    /// @inheritdoc IBondedFacilitator
    function getAvailableBond(address facilitator) external view returns (uint256) {
        return bondBalance[facilitator] - totalCommitted[facilitator];
    }
}
