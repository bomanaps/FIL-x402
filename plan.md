# FIL x402: Instant Payments on Filecoin

Technical specification for solving the finality problem.

---

## Problem

| Metric   | Required | Filecoin F3 | Gap       |
|----------|----------|-------------|-----------|
| Latency  | <1s      | 150-300s    | 150-300x  |

**Constraint**: Must remain Filecoin-native.

---

## Solution Paths

Two complementary approaches:

```text
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Option A: Bonded Optimistic Settlement                   │
│  ├── Works with existing infrastructure                 │
│  ├── Latency: <1 second                                 │
│  └── Risk: Covered by facilitator bond                  │
│                                                         │
│  Option B: IPC Payment Subnet                             │
│  ├── Requires new subnet deployment                     │
│  ├── Latency: 1-2 seconds (BFT finality)                │
│  └── Risk: None (true finality)                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Option A** can ship immediately with no infrastructure changes.
**Option B** provides true finality, eliminating settlement risk entirely.

Both paths can coexist: optimistic for frictionless onboarding, subnet for guaranteed finality.

---

## Option A: Bonded Optimistic Settlement

### Concept

Deliver data immediately after off-chain verification. Facilitator bond guarantees payment.

```text
Traditional:  Verify → Settle → Wait 5 min → Deliver
Optimistic:   Verify → Deliver → Settle async
```

### How It Works

```text
┌────────────────────────────────────────────────────────┐
│                                                        │
│  1. VERIFY (instant, off-chain)                        │
│     ├── Signature valid?                               │
│     ├── Balance ≥ 1.5× payment?                        │
│     ├── Nonce unused?                                  │
│     └── Within validity window?                        │
│                                                        │
│  2. DELIVER (immediate)                                │
│     └── Data sent to client                            │
│                                                        │
│  3. SETTLE (async, background)                         │
│     ├── Submit transferWithAuthorization               │
│     ├── Retry on failure                               │
│     └── Claim from bond if unrecoverable               │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Risk Model

| Failure                          | Probability | Mitigation                       |
|----------------------------------|-------------|----------------------------------|
| Balance drained before settlement| Medium      | Require 1.5× balance buffer      |
| Double-spend attempt             | Low         | Nonce tracking + fast settlement |
| Network congestion               | Medium      | Gas escalation + retry           |

**Why bond eliminates risk for providers:**

```text
Provider delivers data → Settlement fails → Provider claims from bond
```

Provider is guaranteed payment regardless of settlement outcome.

### Bond Contract

```solidity
contract BondedFacilitator {
    uint256 public constant MIN_BOND = 100_000e6;  // 100k USDFC

    struct PendingSettlement {
        address provider;
        uint256 amount;
        uint256 deadline;
        bytes32 paymentHash;
        bool settled;
    }

    mapping(bytes32 => PendingSettlement) public pending;
    mapping(address => uint256) public facilitatorBond;
    mapping(address => uint256) public totalPending;

    IERC20 public token;

    // Facilitator commits to settling a payment
    function commitPayment(
        bytes32 paymentId,
        address provider,
        uint256 amount
    ) external {
        require(
            facilitatorBond[msg.sender] >= totalPending[msg.sender] + amount,
            "Insufficient bond coverage"
        );

        pending[paymentId] = PendingSettlement({
            provider: provider,
            amount: amount,
            deadline: block.timestamp + 10 minutes,
            paymentHash: paymentId,
            settled: false
        });

        totalPending[msg.sender] += amount;
    }

    // Mark as settled after successful on-chain settlement
    function markSettled(bytes32 paymentId) external {
        pending[paymentId].settled = true;
        totalPending[msg.sender] -= pending[paymentId].amount;
    }

    // Provider claims from bond if settlement failed
    function claimFromBond(bytes32 paymentId) external {
        PendingSettlement storage p = pending[paymentId];

        require(block.timestamp > p.deadline, "Settlement window active");
        require(!p.settled, "Already settled");
        require(msg.sender == p.provider, "Not provider");

        totalPending[msg.sender] -= p.amount;
        facilitatorBond[msg.sender] -= p.amount;
        token.transfer(p.provider, p.amount);
    }
}
```

### Facilitator Implementation

```typescript
interface OptimisticVerifyResult {
    valid: boolean;
    riskScore: number;
    reason?: string;
}

async function verify(
    payment: PaymentPayload,
    requirements: PaymentRequirements
): Promise<OptimisticVerifyResult> {

    // 1. Signature check (instant)
    if (!verifyEIP712Signature(payment)) {
        return { valid: false, riskScore: 100, reason: 'invalid_signature' };
    }

    // 2. Balance check (RPC call)
    const balance = await getBalance(payment.from);
    const required = BigInt(requirements.maxAmountRequired);

    // Require 1.5× buffer
    if (balance < (required * 15n) / 10n) {
        return { valid: false, riskScore: 80, reason: 'insufficient_buffer' };
    }

    // 3. Nonce check
    const nonceUsed = await isNonceUsed(payment.from, payment.nonce);
    if (nonceUsed) {
        return { valid: false, riskScore: 100, reason: 'nonce_used' };
    }

    // 4. Time validity
    const now = Math.floor(Date.now() / 1000);
    if (now < payment.validAfter || now >= payment.validBefore) {
        return { valid: false, riskScore: 100, reason: 'expired' };
    }

    return { valid: true, riskScore: 0 };
}

async function settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements
): Promise<SettleResult> {

    // Commit to bond contract first
    const paymentId = keccak256(payment.signature);
    await bondContract.commitPayment(
        paymentId,
        requirements.payTo,
        requirements.maxAmountRequired
    );

    // Queue async settlement
    settlementQueue.add({
        payment,
        requirements,
        paymentId,
        attempts: 0,
        maxAttempts: 5
    });

    // Return immediately - don't wait
    return { success: true, paymentId };
}
```

### Settlement Worker

```typescript
async function processSettlementQueue() {
    for (const job of settlementQueue) {
        try {
            const tx = await token.transferWithAuthorization(
                job.payment.from,
                job.requirements.payTo,
                job.requirements.maxAmountRequired,
                job.payment.validAfter,
                job.payment.validBefore,
                job.payment.nonce,
                job.payment.signature
            );

            await tx.wait();
            await bondContract.markSettled(job.paymentId);

        } catch (error) {
            job.attempts++;

            if (job.attempts >= job.maxAttempts) {
                // Settlement failed - provider claims from bond
                log.error(`Settlement failed: ${job.paymentId}`);
            } else {
                // Retry with higher gas
                job.gasMultiplier = 1.2 ** job.attempts;
                settlementQueue.add(job);
            }
        }
    }
}
```

### Parameters

| Parameter           | Value         | Rationale                    |
|---------------------|---------------|------------------------------|
| Min bond            | 100,000 USDFC | Cover worst-case pending     |
| Balance buffer      | 1.5×          | Margin for concurrent payments|
| Settlement deadline | 10 minutes    | 2× F3 finality               |
| Max retry attempts  | 5             | With gas escalation          |

---

## Option B: IPC Payment Subnet

### Concept

Dedicated Filecoin subnet with fast BFT consensus for x402 payments.

```text
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Filecoin Mainnet                                       │
│  ├── Finality: 2-5 minutes                              │
│  ├── Security: Full network                             │
│  └── Used for: Checkpoints, large withdrawals           │
│                                                         │
│              ▲                                          │
│              │ Checkpoint every ~50 seconds             │
│              │                                          │
│                                                         │
│  x402 Payment Subnet                                    │
│  ├── Finality: 1-2 seconds                              │
│  ├── Consensus: Tendermint/Mir BFT                      │
│  ├── Validators: Facilitators + providers               │
│  └── Used for: All x402 payments                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Why IPC Works

IPC (Interplanetary Consensus) is Filecoin's native scaling solution:

- **Production ready** - launched 2024
- **Inherits mainnet security** via checkpointing
- **Configurable consensus** - can use fast BFT
- **Native USDFC support** - bridge from mainnet

### Subnet Architecture

```text
┌────────────────────────────────────────────────────────┐
│                   x402 SUBNET                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Validators (4-7 nodes):                               │
│  ├── FIL Beam Facilitator (required)                   │
│  ├── Major data providers (2-3)                        │
│  └── Independent operators (1-3)                       │
│                                                        │
│  Consensus: Mir BFT                                    │
│  ├── Block time: 1 second                              │
│  ├── Finality: 1 block (instant)                       │
│  └── Throughput: ~1000 TPS                             │
│                                                        │
│  Assets:                                               │
│  ├── USDFC (bridged from mainnet)                      │
│  └── Subnet-native gas token                           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Payment Flow

```text
1. USER ONBOARDING (one-time)
   User deposits USDFC to subnet bridge
   Wait for mainnet finality (~5 min)
   User now has subnet USDFC

2. PAYMENT (every request, instant)
   Client → Server: Request
   Server → Client: 402 + PaymentRequirements
   Client: Sign subnet payment
   Client → Server: Request + payment
   Server → Subnet: Submit payment tx
   Subnet: 1 block finality (~1 second)
   Server → Client: Data

3. PROVIDER WITHDRAWAL (periodic)
   Provider withdraws subnet USDFC to mainnet
   Wait for checkpoint + mainnet finality
```

### Subnet Contract

```solidity
// Deployed on x402 subnet
contract X402SubnetPayments {
    IERC20 public usdfc;  // Bridged USDFC

    event Payment(address indexed from, address indexed to, uint256 amount, bytes32 requestId);

    // Simple transfer - no authorization complexity needed
    // Because subnet has instant finality
    function pay(
        address provider,
        uint256 amount,
        bytes32 requestId
    ) external {
        usdfc.transferFrom(msg.sender, provider, amount);
        emit Payment(msg.sender, provider, amount, requestId);
    }

    // Batch payments for efficiency
    function payBatch(
        address[] calldata providers,
        uint256[] calldata amounts,
        bytes32[] calldata requestIds
    ) external {
        for (uint i = 0; i < providers.length; i++) {
            usdfc.transferFrom(msg.sender, providers[i], amounts[i]);
            emit Payment(msg.sender, providers[i], amounts[i], requestIds[i]);
        }
    }
}
```

### Facilitator for Subnet

```typescript
// Simpler than optimistic - we have real finality
async function verify(payment: SubnetPayment): Promise<VerifyResult> {
    const balance = await subnet.getBalance(payment.from);

    if (balance < payment.amount) {
        return { valid: false, reason: 'insufficient_balance' };
    }

    return { valid: true };
}

async function settle(payment: SubnetPayment): Promise<SettleResult> {
    // Submit to subnet - finality in ~1 second
    const tx = await subnetContract.pay(
        payment.provider,
        payment.amount,
        payment.requestId
    );

    // Wait for 1 block (1 second)
    const receipt = await tx.wait(1);

    return {
        success: true,
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
    };
}
```

### Subnet Configuration

```typescript
const subnetConfig = {
    name: "x402-payments",
    parent: "filecoin-mainnet",

    consensus: {
        type: "mir-bft",
        blockTime: "1s",
        finality: "instant"  // Single block in BFT
    },

    validators: {
        minimum: 4,           // BFT requires 3f+1
        maxFaulty: 1,         // Can tolerate 1 Byzantine
        stakeRequired: "50000 FIL"
    },

    checkpointing: {
        interval: 50,         // Every 50 subnet blocks
        parentFinality: true  // Wait for F3 on mainnet
    },

    bridge: {
        assets: ["USDFC"],
        depositFinality: "f3",
        withdrawalDelay: "1 hour"
    }
};
```

### Security Analysis

**Subnet security model:**

| Assumption                 | Implication                       |
|----------------------------|-----------------------------------|
| ≥2/3 validators honest     | Subnet operates correctly         |
| <1/3 validators Byzantine  | Cannot finalize bad blocks        |
| Mainnet checkpoint         | Subnet state anchored to mainnet  |

**Attack scenarios:**

| Attack        | Requires           | Mitigation                    |
|---------------|--------------------|-------------------------------|
| Double spend  | >1/3 validators    | Stake slashing                |
| Censorship    | >1/3 validators    | Multiple validators           |
| Invalid state | >2/3 validators    | Checkpoints catch it          |

**Economic security:**

```text
Validator stake: 50,000 FIL × 4 validators = 200,000 FIL
At $5/FIL = $1,000,000 securing the subnet

Attack cost > potential gain for any realistic payment volume
```

---

## Comparison

| Aspect      | Bonded Optimistic       | IPC Subnet               |
|-------------|-------------------------|--------------------------|
| Finality    | Probabilistic           | True (BFT)               |
| Latency     | <1s (verify only)       | 1-2s (actual finality)   |
| Risk        | Bond covers failures    | Zero                     |
| Infra       | Existing                | New subnet deployment    |
| Cold start  | None                    | Deposit to subnet        |
| Complexity  | Low                     | Medium                   |

---

## Implementation

### Option A: Bonded Optimistic

1. Deploy BondedFacilitator contract
2. Fund facilitator bond (100k USDFC)
3. Implement verify() with balance buffer check
4. Implement async settlement worker
5. Add retry logic with gas escalation
6. Build monitoring dashboard
7. Integration testing on calibration
8. Mainnet deployment

### Option B: IPC Subnet

1. Subnet genesis configuration
2. Validator onboarding (4 initial)
3. Bridge contract deployment
4. Subnet contract deployment
5. Integration with x402 facilitator
6. Testing on calibration subnet
7. Security audit
8. Mainnet subnet launch

### Recommended Approach

```text
Start:
  All payments → Bonded Optimistic

After subnet launch:
  New users → Subnet (with deposit)
  Existing users → Either (their choice)
  Large payments → Subnet (no risk)
  Micropayments → Optimistic (no deposit friction)

Long-term:
  Subnet becomes primary
  Optimistic remains for cold-start users
```

---

## Risk Assessment

### Option A Risks

| Risk                     | Probability | Impact              | Mitigation              |
|--------------------------|-------------|---------------------|-------------------------|
| Settlement failures      | Medium      | Low (bond covers)   | Retry + escalation      |
| Bond depletion           | Low         | High                | Monitor + top-up alerts |
| Mass double-spend attack | Very Low    | Medium              | Rate limiting           |

**Expected loss rate**: <0.1% of volume (covered by fees)

### Option B Risks

| Risk                | Probability | Impact   | Mitigation                     |
|---------------------|-------------|----------|--------------------------------|
| Validator collusion | Very Low    | High     | Stake slashing + diversity     |
| Subnet liveness     | Low         | Medium   | Mainnet fallback               |
| Bridge exploit      | Very Low    | Critical | Audits + withdrawal delays     |

---

## Parameters Reference

### Bonded Optimistic

| Parameter           | Value         |
|---------------------|---------------|
| Minimum bond        | 100,000 USDFC |
| Balance buffer      | 1.5×          |
| Settlement deadline | 10 minutes    |
| Max retries         | 5             |
| Base fee            | 0.001 USDFC   |
| Fee rate            | 0.1%          |

### IPC Subnet

| Parameter           | Value     |
|---------------------|-----------|
| Block time          | 1 second  |
| Validators          | 4-7       |
| Validator stake     | 50,000 FIL|
| Checkpoint interval | 50 blocks |
| Withdrawal delay    | 1 hour    |

---

## Summary

**Option A (Bonded Optimistic)**: Ship with existing infrastructure. Facilitator bond guarantees provider payment. <1 second UX.

**Option B (IPC Subnet)**: True 1-2 second finality. Zero settlement risk. Filecoin-native scaling.

Both paths work together: optimistic for frictionless onboarding, subnet for guaranteed finality.
