# FCR-x402: Instant Payments on Filecoin

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

---

## Implementation Roadmap

### Stage 1: PoC (Complete)
- Core x402 payment protocol
- EIP-3009 `transferWithAuthorization` verification and settlement
- Basic risk checks (balance, nonce, expiry)
- `/verify` and `/settle` endpoints
- Tested on Calibration with USDFC

### Stage 2: FCR Integration (Complete)
- F3/GossiPBFT finality monitoring
- Confirmation levels L0 → L1 → L2 → L3
- FCR-aware settlement decisions
- `/fcr/status`, `/fcr/levels`, `/fcr/wait/:level` endpoints

### Stage 3: Bond + Deferred Hybrid (Complete)
- BondedFacilitator contract (collateral, commit/release/claim)
- DeferredPaymentEscrow contract (deposit, thaw, EIP-712 vouchers, collect)
- Tiered risk limits by wallet history (UNKNOWN → VERIFIED)
- Fee calculation (base + risk + provider)
- Provider policies by payment amount
- Deployed to Calibration:
  - BondedFacilitator: `0x0C79179E91246998A7F3b372de69ba2a112a37ed`
  - DeferredPaymentEscrow: `0x3EE8f61b928295492886C6509D591da132531ef3`

### Stage 4: Production Hardening (Planned)
- Redis persistence for voucher store (risk service already uses Redis)
- Key management and rotation
- Rate limiting and DDoS protection
- Monitoring, alerting, and dashboards
- Security audit
- Mainnet deployment

### Stage 5: ERC-8004 Trustless Agents Integration (In Progress)

ERC-8004 defines three on-chain registries for autonomous agent discovery and trust. It explicitly supports x402 payments. Integrating this standard positions us as the payment layer for the AI agent economy.

**Deployed to Calibration:**
- IdentityRegistry: `0x8A30335A7eff4450671E6aE412Fc786001ce149c`
- ReputationRegistry: `0x0510a352722D504767A86B961a493BBB3208a9a5`
- ValidationRegistry: `0x151EC586050d500e423f352A8EE6d781F7c7bE9E`
- Facilitator registered as Agent ID: `0`

**Completed:**
- [x] Deploy ERC-8004 registries (Identity, Reputation, Validation)
- [x] Register facilitator as ERC-8004 agent
- [x] HTTP metadata endpoint (`/agent/agent-metadata`)
- [x] Agent status endpoint (`/agent/status`)
- [x] Well-known discovery endpoint (`/.well-known/erc8004-agent.json`)
- [x] Demo frontend Agent page

**Remaining:**
- [ ] Reputation integration (requires external feedback - self-feedback not allowed)
- [ ] Validation integration (requires third-party validators)
- [ ] Provider discovery endpoint
- [ ] IPFS metadata (optional, HTTP works for testnet)

#### Why ERC-8004

| Problem Today | ERC-8004 Solution |
|---------------|-------------------|
| Providers must be known upfront | Identity Registry enables discovery |
| Risk tiers are time-based only | Reputation Registry enables trust-based tiers |
| No proof of delivery | Validation Registry provides on-chain attestations |
| No standard for agent-to-agent payments | x402 + ERC-8004 = complete stack |

#### Integration Points

**1. Identity Registry (Provider Discovery)**
```
Providers register as agents:
  - x402Support: true
  - facilitatorUrl: "https://facilitator.example.com"
  - endpoints: { api: "https://api.example.com" }

Buyers query registry to discover x402-enabled providers
```

**2. Reputation Registry (Trust-Based Risk)**
```
After settlement:
  facilitator.giveFeedback(agentId, {
    value: 1,  // positive
    tag1: "payment_settled",
    proofOfPayment: { fromAddress, toAddress, chainId, txHash }
  })

During risk check:
  reputation = reputationRegistry.getSummary(buyerAgentId)
  tier = reputation.positiveCount > 50 ? VERIFIED : calculateFromHistory()
```

**3. Validation Registry (Delivery Attestation)**
```
After service delivery:
  provider.validationRequest(paymentId, facilitatorAddress)

Facilitator attests:
  facilitator.validationResponse(paymentId, {
    score: 100,  // payment settled successfully
    evidenceUri: "ipfs://Qm..."
  })
```

#### Implementation Steps

1. **Deploy ERC-8004 Registries** ✅
   - Deployed all 3 registries using UUPS proxy pattern
   - Contracts in `contracts/lib/erc8004-contracts/` (git submodule)
   - Deploy script: `contracts/scripts/deploy-erc8004.ts`

2. **Register Facilitator as Agent** ✅
   - Registration script: `facilitator/scripts/register-agent.ts`
   - Agent ID: 0 assigned on Calibration
   - Metadata served via HTTP endpoint

3. **Agent Metadata & Status Endpoints** ✅
   - Service: `facilitator/src/services/erc8004.ts`
   - Routes: `facilitator/src/routes/agent.ts`
   - Endpoints: `/agent/agent-metadata`, `/agent/status`, `/.well-known/erc8004-agent.json`

4. **Integrate Reputation Registry** (Pending)
   - Note: Self-feedback NOT allowed (contract enforces `isAuthorizedOrOwner`)
   - Requires external parties to give feedback on agent
   - Future: Call `giveFeedback()` from client after service delivery

5. **Integrate Validation Registry** (Pending)
   - Requires third-party validators
   - Future: Facilitator becomes a validator for other agents

6. **Provider Discovery Endpoint** (Pending)
   - `GET /discover` — query Identity Registry for x402 providers
   - Filter by reputation, validation scores, supported tokens

#### Planned Endpoints (Not Yet Implemented)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/discover` | GET | Query Identity Registry for x402-enabled providers |
| `/register` | POST | Register a provider in Identity Registry |
| `/reputation/:agentId` | GET | Get reputation summary for an agent |
| `/validate/:paymentId` | POST | Request/submit validation attestation |

#### Current Implementation

```text
facilitator/src/services/
  erc8004.ts         — ERC-8004 service (identity, reputation, validation)

facilitator/src/routes/
  agent.ts           — Agent metadata and status endpoints

contracts/lib/
  erc8004-contracts/ — ERC-8004 registry contracts (git submodule)

demo/src/app/
  agent/page.tsx     — ERC-8004 visualization page
```

#### Benefits

- **Discoverability**: Providers found on-chain, no manual coordination
- **Smarter Risk**: Reputation replaces time-based tier progression
- **Audit Trail**: On-chain proof of payments and delivery
- **Interoperability**: Standard interface for any agent protocol (MCP, A2A, OASF)
- **AI Agent Economy**: Position as the payment infrastructure for autonomous agents

#### Dependencies

- ✅ ERC-8004 registry contracts deployed to Calibration
- IPFS/Arweave for off-chain registration files (optional, HTTP works for testnet)
- May require subgraph for efficient registry queries (future)

### Stage 6: Ecosystem Integration & Go-to-Market (Planned)

Position FIL-x402 as THE Filecoin x402 facilitator and acquire users through strategic partnerships.

#### Market Context

x402 is exploding (930K weekly transactions, $10M+ volume) but Coinbase's facilitator only supports Base and Solana. **Filecoin has no x402 facilitator** — that's our gap.

Secured Finance is the DeFi backbone on Filecoin:
- USDFC stablecoin (110% FIL-collateralized, live on mainnet)
- Fixed-rate lending markets
- 24 hackathon projects built on their stack
- Backed by Consensys, Protocol Labs, Huobi, GSR

**They have the users and the money. We have the payment rails.**

#### Partnership Strategy

**1. Secured Finance Partnership**

| What we offer | What we get |
|---------------|-------------|
| x402 payment flow for USDFC | Access to their user base |
| Bond-backed settlement | Co-marketing (blogs, docs) |
| FCR finality tracking | Protocol Labs grant potential |
| Deferred escrow for recurring payments | Integration into their dApps |

Integration phases:

- **Phase 1: USDFC Payment Widget** — Embeddable "Pay with USDFC" button that signs EIP-3009, verifies via our facilitator, settles on-chain. Target: their lending dApp, third-party USDFC apps.

- **Phase 2: Lending Market Integration** — Providers deposit USDFC in Secured Finance lending market, earn fixed yield while waiting for payments. Our facilitator pulls from their balance when settlements occur. Result: yield-bearing escrow.

- **Phase 3: Storage Deal Financing** — Buyers borrow USDFC from Secured Finance, deposit into our escrow, pay storage providers via deferred vouchers. Result: storage deals become financeable.

**2. x402 Foundation Membership**

- Apply for membership (Coinbase, Cloudflare are founding members)
- Get listed as the official Filecoin facilitator
- Contribute Filecoin-specific extensions to the spec
- Access to ecosystem partnerships and grants

**3. Filecoin Storage Provider Onboarding**

Current pain points:
- Manual invoicing for storage deals
- 5+ minute finality wait
- No micropayment support

Our solution:
- Instant payment verification
- Pay-per-request storage APIs
- Deferred vouchers for ongoing deals

Target: top 50 storage providers on Filecoin.

**4. AI Agent Developer Outreach**

AI agents need Filecoin for:
- Decentralized storage (training data, model weights)
- Payment rails without human approval
- Micropayments for per-inference billing

We're the only x402 facilitator on Filecoin. With ERC-8004 (Stage 5), agents can discover us on-chain.

Target channels:
- Filecoin hackathons and grants
- AI agent frameworks (AutoGPT, LangChain, CrewAI)
- Protocol Labs developer relations

#### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Partnership proposal doc | One-pager for Secured Finance pitch |
| USDFC payment widget | Embeddable JS component + demo |
| Storage provider SDK | Simplified integration for SPs |
| x402 Foundation application | Membership request + contribution plan |
| Developer documentation | Guides for AI agent builders |
| Marketing site | Landing page at fil-x402.org or similar |

#### Success Metrics

| Metric | 3-month target | 6-month target |
|--------|----------------|----------------|
| Active providers | 10 | 50 |
| Monthly transaction volume | $10K | $100K |
| Weekly transactions | 1,000 | 10,000 |
| Storage providers integrated | 5 | 20 |
| AI agent integrations | 3 | 15 |

#### Go-to-Market Timeline

```
Month 1:
  - Secured Finance partnership outreach
  - x402 Foundation application
  - Payment widget MVP

Month 2:
  - Secured Finance integration (Phase 1)
  - Storage provider pilot (5 SPs)
  - Developer docs + guides

Month 3:
  - AI agent SDK release
  - Filecoin hackathon sponsorship
  - First 10 paying customers

Month 4-6:
  - Secured Finance Phase 2 (lending integration)
  - Scale to 50 providers
  - Protocol Labs grant application
```

---

## Option B: IPC Subnet (Future)

After Option A is production-ready, explore IPC subnet for true instant finality. See [IPC Payment Subnet](#option-b-ipc-payment-subnet) section above.
