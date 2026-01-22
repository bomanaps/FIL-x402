# FCR-x402: Fast Confirmation Rule for x402 Payments on Filecoin

Technical Specification v0.2

---

## Abstract

This specification defines a multi-layer payment confirmation mechanism for x402 payments on Filecoin. By combining economic guarantees (facilitator bond), consensus monitoring (FCR), and cryptographic finality (F3), providers can configure their desired trust/speed tradeoff while maintaining appropriate security for each use case.

---

## 1. Problem Statement

### Current State

| Approach | Latency | Risk | Friction |
| -------- | ------- | ---- | -------- |
| Credit (signature only) | Instant | HIGH - exploitable at scale | None |
| Full F3 finality | ~60s | Zero | None |
| Prepaid/Escrow | Instant (after deposit) | Zero | 60s deposit required |

### Goal

Provide a **configurable confirmation system** where providers choose their risk/speed tradeoff:

- Instant delivery with economic guarantees (bond model)
- Fast delivery with consensus confidence (FCR model)
- Certain delivery with cryptographic proof (F3 model)

---

## 2. Multi-Layer Confirmation Architecture

### Layer Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  LAYER 0: Mempool Inclusion (Instant)                       │
│  ├── Tx accepted by validator node                          │
│  ├── Security: Economic (validator reputation)              │
│  ├── Future: Restaking/slashing for inclusion guarantees    │
│  └── Use case: Streaming, pausable content                  │
│                                                             │
│  LAYER 1: EC Inclusion (~30s)                               │
│  ├── Tx included in tipset                                  │
│  ├── Security: Probabilistic (reorg possible)               │
│  └── Use case: Micropayments with bounded loss              │
│                                                             │
│  LAYER 2: FCR Fast Confirmation (~45s)                      │
│  ├── F3 COMMIT phase reached OR safe heuristic met          │
│  ├── Security: BFT assumption (>2/3 honest QAP)             │
│  └── Use case: Standard payments                            │
│                                                             │
│  LAYER 3: F3 Finality (~60s)                                │
│  ├── F3 certificate issued                                  │
│  ├── Security: Cryptographic (BLS aggregate signature)      │
│  └── Use case: High-value, audit/compliance                 │
│                                                             │
│  LAYER B: Facilitator Bond (Instant, Optional)              │
│  ├── Facilitator guarantees payment from bond               │
│  ├── Security: Economic (bond covers losses)                │
│  ├── Requires: Fee to cover risk                            │
│  └── Use case: Instant UX where speed critical              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Layer Selection by Use Case

| Use Case | Recommended Layer | Rationale |
| -------- | ----------------- | --------- |
| Streaming content | L0 + pause at L1 | Can stop delivery if payment fails |
| Micropayments (<$0.10) | L1 or Bond | Loss bounded, speed critical |
| Standard payments ($0.10-$100) | L2 (FCR) | Balance of speed and security |
| Large payments (>$100) | L3 (F3) | Maximum security required |
| Instant UX critical | Bond + L2 fallback | Economic guarantee, FCR confirms |

---

## 3. Confirmation Level Definitions

### Level Specifications

| Level | Condition | Latency | Security Model |
| ----- | --------- | ------- | -------------- |
| L0: Mempool | Tx in mempool | Instant | Validator inclusion promise |
| L1: Included | Tx in tipset (EC) | ~30s | Probabilistic (reorg possible) |
| L2: FCR Confirmed | Safe heuristic met (see 3.1) | ~45s | BFT: requires >1/3 Byzantine QAP to reverse |
| L3: Finalized | F3 certificate issued | ~60s | Cryptographic: BLS signature by >2/3 QAP |
| LB: Bonded | Facilitator bond committed | Instant | Economic: bond covers provider loss |

### 3.1 L2 Safe Heuristic (IMPORTANT)

**Do NOT treat PREPARE phase alone as confirmation.**

L2 (FCR Confirmed) requires ONE of:

1. **COMMIT phase reached** - Strong quorum on COMMIT value achieved
2. **DECIDE phase reached** - Decision made, certificate pending
3. **Safe heuristic met** - ALL of the following:
   - PREPARE phase active
   - Round = 0 (no round bumps indicating issues)
   - Time in PREPARE > 5 seconds (sufficient propagation)
   - No conflicting proposals observed

```typescript
function isL2Confirmed(progress: F3Progress, phaseStartTime: number): boolean {
  // Explicit: COMMIT or later phase
  if (progress.Phase >= F3Phase.COMMIT) {
    return true;
  }

  // Heuristic: PREPARE with safety conditions
  if (progress.Phase === F3Phase.PREPARE) {
    const timeInPhase = Date.now() - phaseStartTime;
    const safeTime = 5000; // 5 seconds

    return (
      progress.Round === 0 &&        // No round bumps
      timeInPhase > safeTime         // Sufficient propagation time
    );
  }

  return false;
}
```

### 3.2 Security Guarantees (Corrected)

| Level | Reversal Requires | Security Statement |
| ----- | ----------------- | ------------------ |
| L1 | Chain reorganization | Probabilistic; decreases with depth |
| L2 | >1/3 of QAP Byzantine during consensus | Cryptographically negligible under BFT assumption |
| L3 | Breaking BLS signatures OR >2/3 QAP collusion | Cryptographically impossible under standard assumptions |
| LB | Facilitator insolvency | Economic; bounded by bond size |

**Note**: Numeric probabilities (e.g., "<10^-9") are removed as they cannot be precisely calculated and may mislead. Security relies on the BFT assumption that <1/3 of QAP is Byzantine.

---

## 4. Tipset to F3 Instance Mapping

### 4.1 Dynamic Mapping (Required)

**Do NOT hardcode "~2 epochs per instance".**

Instance mapping must be derived from chain state:

```typescript
interface InstanceMapper {
  manifest: F3Manifest;
  latestCert: FinalityCertificate;
  certCache: Map<number, FinalityCertificate>;
}

async function getInstanceForTipset(
  mapper: InstanceMapper,
  tipsetHeight: number,
  lotus: LotusClient
): Promise<{ instance: number; status: 'pending' | 'active' | 'finalized' }> {

  // Refresh latest certificate
  mapper.latestCert = await lotus.F3GetLatestCertificate();

  // Check if tipset is already finalized
  const finalizedHeight = getFinalizedHeight(mapper.latestCert);
  if (tipsetHeight <= finalizedHeight) {
    return {
      instance: mapper.latestCert.GPBFTInstance,
      status: 'finalized'
    };
  }

  // Get current progress
  const progress = await lotus.F3GetProgress();

  // Query the instance that will cover this tipset
  // This requires understanding F3's catch-up and steady-state behavior
  const instance = await deriveInstanceFromChainState(
    lotus,
    tipsetHeight,
    mapper.manifest,
    progress
  );

  return {
    instance,
    status: progress.ID === instance ? 'active' : 'pending'
  };
}

async function deriveInstanceFromChainState(
  lotus: LotusClient,
  tipsetHeight: number,
  manifest: F3Manifest,
  progress: F3Progress
): Promise<number> {

  // Get the finalized tipset for the current instance
  const currentCert = await lotus.F3GetCertificate(progress.ID);

  if (currentCert) {
    const certHeight = getMaxHeightFromCert(currentCert);

    // If our tipset is covered by current instance
    if (tipsetHeight <= certHeight) {
      return progress.ID;
    }

    // Otherwise, estimate based on progress
    // Each instance typically covers a range of epochs
    // but this varies during catch-up vs steady-state
    return progress.ID + 1;
  }

  // Fallback: query manifest for bootstrap epoch
  if (tipsetHeight < manifest.BootstrapEpoch) {
    throw new Error('Tipset predates F3 activation');
  }

  // During steady state, instances advance roughly with epochs
  // But NEVER hardcode the ratio - always verify against actual certs
  return progress.ID;
}

function getFinalizedHeight(cert: FinalityCertificate): number {
  // Extract the maximum epoch from the certificate's ECChain
  return Math.max(...cert.ECChain.map(ts => ts.Epoch));
}
```

### 4.2 Certificate Caching

```typescript
class CertificateCache {
  private cache: Map<number, FinalityCertificate> = new Map();
  private lotus: LotusClient;

  async getCertificate(instance: number): Promise<FinalityCertificate | null> {
    if (this.cache.has(instance)) {
      return this.cache.get(instance)!;
    }

    const cert = await this.lotus.F3GetCertificate(instance);
    if (cert) {
      this.cache.set(instance, cert);
    }
    return cert;
  }

  // Check if a tipset height is covered by any cached certificate
  isTipsetFinalized(tipsetHeight: number): boolean {
    for (const cert of this.cache.values()) {
      if (getFinalizedHeight(cert) >= tipsetHeight) {
        return true;
      }
    }
    return false;
  }
}
```

---

## 5. Facilitator Bond Model

### 5.1 When Bond Model Applies

The bond model is **not broken** - it's the same economic model used by Stripe, Paystack, and traditional payment processors. It requires proper guardrails.

```text
┌─────────────────────────────────────────────────────────────┐
│                   BOND MODEL GUARDRAILS                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Exposure Limits:                                           │
│  ├── Total bond: $100,000 USDFC                             │
│  ├── Max pending: 80% of bond ($80,000)                     │
│  └── Reserve: 20% for settlement failures                   │
│                                                             │
│  Per-Wallet Limits:                                         │
│  ├── Unknown wallet: $5/day                                 │
│  ├── 7-day history: $50/day                                 │
│  ├── 30-day history: $500/day                               │
│  └── Verified/KYC: $5,000/day                               │
│                                                             │
│  Fee Structure:                                             │
│  ├── Base fee: $0.01 per transaction                        │
│  ├── Risk fee: 1% of amount (covers expected fraud)         │
│  └── Provider fee: 0.1% (incentive for risk)                │
│                                                             │
│  Risk Monitoring:                                           │
│  ├── Real-time fraud scoring                                │
│  ├── Velocity checks                                        │
│  ├── Balance trajectory analysis                            │
│  └── Automatic limit adjustment                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Bond + FCR Hybrid Flow

```text
1. Payment received
2. Facilitator commits bond (instant guarantee to provider)
3. Provider delivers content immediately
4. FCR monitor tracks confirmation in background
5. On L2/L3 confirmation: Bond commitment released
6. On settlement failure: Provider claims from bond
```

```typescript
interface BondedPayment {
  paymentId: string;
  amount: bigint;
  provider: string;

  // Bond state
  bondCommitted: boolean;
  bondAmount: bigint;

  // FCR state
  fcrLevel: ConfirmationLevel;
  f3Instance?: number;

  // Settlement state
  settled: boolean;
  settledAt?: number;
  settlementTxHash?: string;

  // Failure handling
  claimedFromBond: boolean;
}

async function processWithBondAndFCR(
  payment: PaymentPayload,
  requirements: PaymentRequirements
): Promise<BondedPayment> {

  const paymentId = generatePaymentId(payment);

  // 1. Commit bond (instant)
  await bondContract.commitPayment(
    paymentId,
    requirements.payTo,
    requirements.maxAmountRequired
  );

  // 2. Submit transaction
  const submission = await submitPayment(payment);

  // 3. Return immediately - provider can deliver
  const result: BondedPayment = {
    paymentId,
    amount: requirements.maxAmountRequired,
    provider: requirements.payTo,
    bondCommitted: true,
    bondAmount: requirements.maxAmountRequired,
    fcrLevel: ConfirmationLevel.L0_PENDING,
    settled: false,
    claimedFromBond: false
  };

  // 4. Track FCR in background
  trackFCRAsync(result, submission.tipsetHeight);

  return result;
}
```

### 5.3 Bond Economics

| Metric | Value | Rationale |
| ------ | ----- | --------- |
| Expected fraud rate | 0.5-2% | Based on payment processor industry data |
| Risk fee | 1% | Covers expected fraud with margin |
| Bond size | $100,000 | Covers ~$80,000 pending at any time |
| Break-even volume | $10M/month | At 1% fee = $100k revenue |

---

## 6. Provider Configuration

### 6.1 Configurable Trust Policies

Providers can specify their confirmation requirements:

```yaml
# Provider configuration
provider:
  name: "example-storage-provider"

  # Default policy
  default_policy:
    start_delivery_at: L1        # Begin delivery at EC inclusion
    require_for_completion: L2   # Require FCR for full delivery
    timeout_action: pause        # Pause if confirmation stalls

  # Amount-based overrides
  policies:
    - max_amount: 100000         # $0.10
      start_delivery_at: L0      # Mempool is fine
      require_for_completion: L1
      accept_bond: true          # Accept bonded instant payments

    - max_amount: 100000000      # $100
      start_delivery_at: L1
      require_for_completion: L2
      accept_bond: true

    - max_amount: null           # No limit
      start_delivery_at: L2      # Wait for FCR
      require_for_completion: L3 # Require F3 finality
      accept_bond: false         # No bond for large amounts

  # Streaming/pausable content
  streaming_policy:
    start_at: L0
    pause_if_not_reached: L1
    pause_timeout: 30s
    resume_at: L2
    abort_if_not_reached: L2
    abort_timeout: 120s
```

### 6.2 Policy Enforcement

```typescript
interface ProviderPolicy {
  startDeliveryAt: ConfirmationLevel;
  requireForCompletion: ConfirmationLevel;
  acceptBond: boolean;
  timeoutAction: 'pause' | 'abort' | 'continue';
  timeoutMs: number;
}

function selectPolicy(
  config: ProviderConfig,
  amount: bigint
): ProviderPolicy {

  // Find matching policy by amount
  for (const policy of config.policies) {
    if (policy.maxAmount === null || amount <= policy.maxAmount) {
      return {
        startDeliveryAt: policy.startDeliveryAt,
        requireForCompletion: policy.requireForCompletion,
        acceptBond: policy.acceptBond,
        timeoutAction: policy.timeoutAction || 'pause',
        timeoutMs: policy.timeoutMs || 120000
      };
    }
  }

  return config.defaultPolicy;
}

async function enforcePolicy(
  policy: ProviderPolicy,
  payment: BondedPayment,
  deliveryController: DeliveryController
): Promise<void> {

  // Start delivery when threshold met
  if (payment.fcrLevel >= policy.startDeliveryAt || payment.bondCommitted) {
    deliveryController.startDelivery();
  }

  // Monitor for completion requirement
  const startTime = Date.now();

  while (payment.fcrLevel < policy.requireForCompletion) {
    await sleep(1000);

    if (Date.now() - startTime > policy.timeoutMs) {
      switch (policy.timeoutAction) {
        case 'pause':
          deliveryController.pauseDelivery();
          break;
        case 'abort':
          deliveryController.abortDelivery();
          return;
        case 'continue':
          // Continue delivery despite timeout
          break;
      }
    }
  }

  // Completion requirement met
  deliveryController.completeDelivery();
}
```

---

## 7. Updated FCR Monitor Implementation

### 7.1 Safe Confirmation Logic

```typescript
class FCRMonitor {
  private lotus: LotusClient;
  private manifest: F3Manifest;
  private instanceMapper: InstanceMapper;
  private phaseStartTimes: Map<string, number> = new Map();

  async initialize(): Promise<void> {
    this.manifest = await this.lotus.F3GetManifest();
    this.instanceMapper = {
      manifest: this.manifest,
      latestCert: await this.lotus.F3GetLatestCertificate(),
      certCache: new Map()
    };
  }

  async evaluateConfirmationLevel(
    tipsetHeight: number
  ): Promise<{ level: ConfirmationLevel; confidence: string }> {

    // Check finalization first
    const finalized = await this.lotus.ChainGetFinalizedTipSet();
    if (finalized.Height >= tipsetHeight) {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        confidence: 'Cryptographic finality achieved'
      };
    }

    // Get instance mapping
    const mapping = await getInstanceForTipset(
      this.instanceMapper,
      tipsetHeight,
      this.lotus
    );

    if (mapping.status === 'finalized') {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        confidence: 'Covered by finality certificate'
      };
    }

    // Get current progress
    const progress = await this.lotus.F3GetProgress();

    if (progress.ID > mapping.instance) {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        confidence: 'Instance already decided'
      };
    }

    if (progress.ID === mapping.instance) {
      return this.evaluateActiveInstance(progress);
    }

    return {
      level: ConfirmationLevel.L1_INCLUDED,
      confidence: 'Awaiting F3 processing'
    };
  }

  private evaluateActiveInstance(
    progress: F3Progress
  ): { level: ConfirmationLevel; confidence: string } {

    const phaseKey = `${progress.ID}-${progress.Phase}`;

    // Track phase start time
    if (!this.phaseStartTimes.has(phaseKey)) {
      this.phaseStartTimes.set(phaseKey, Date.now());
    }

    const phaseStartTime = this.phaseStartTimes.get(phaseKey)!;
    const timeInPhase = Date.now() - phaseStartTime;

    // DECIDE or TERMINATED = Finalized
    if (progress.Phase >= F3Phase.DECIDE) {
      return {
        level: ConfirmationLevel.L3_FINALIZED,
        confidence: 'F3 decision reached'
      };
    }

    // COMMIT = Strong confidence
    if (progress.Phase === F3Phase.COMMIT) {
      return {
        level: ConfirmationLevel.L2_FCR_CONFIRMED,
        confidence: 'COMMIT phase reached; >2/3 QAP prepared'
      };
    }

    // PREPARE with safe heuristic
    if (progress.Phase === F3Phase.PREPARE) {
      if (progress.Round === 0 && timeInPhase > 5000) {
        return {
          level: ConfirmationLevel.L2_FCR_CONFIRMED,
          confidence: 'PREPARE phase stable; no round bumps; sufficient propagation'
        };
      }

      if (progress.Round > 0) {
        return {
          level: ConfirmationLevel.L1_INCLUDED,
          confidence: `Round ${progress.Round} indicates potential consensus issues`
        };
      }

      return {
        level: ConfirmationLevel.L1_INCLUDED,
        confidence: 'PREPARE phase; awaiting propagation (safe heuristic not met)'
      };
    }

    return {
      level: ConfirmationLevel.L1_INCLUDED,
      confidence: `Phase ${progress.Phase}; awaiting voting phases`
    };
  }
}
```

---

## 8. Data Integrity Layer (Future)

### 8.1 ZK Proof Integration (Planned)

For use cases requiring data integrity verification:

```text
┌─────────────────────────────────────────────────────────────┐
│                  DATA INTEGRITY LAYER                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Purpose: Prove data correctness independent of payment     │
│                                                             │
│  Components:                                                │
│  ├── Content hash commitment (on-chain)                     │
│  ├── ZK proof of data availability                          │
│  ├── Retrieval verification                                 │
│  └── Dispute resolution                                     │
│                                                             │
│  Integration with x402:                                     │
│  ├── Payment includes content commitment                    │
│  ├── Provider proves data matches commitment                │
│  └── Client verifies before accepting delivery              │
│                                                             │
│  Status: Future enhancement, not required for MVP           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Implementation Priority

### Phase 1: MVP (Now)

| Component | Priority | Complexity |
| --------- | -------- | ---------- |
| Fix L2 safe heuristic | HIGH | Low |
| Dynamic instance mapping | HIGH | Medium |
| Basic FCR monitor | HIGH | Medium |
| Bond model with guardrails | MEDIUM | Medium |

### Phase 2: Production Ready

| Component | Priority | Complexity |
| --------- | -------- | ---------- |
| Provider policy configuration | HIGH | Medium |
| Streaming/pausable delivery | MEDIUM | Medium |
| Comprehensive metrics | HIGH | Low |
| Testnet validation | HIGH | Medium |

### Phase 3: Advanced Features

| Component | Priority | Complexity |
| --------- | -------- | ---------- |
| L0 mempool with validator incentives | LOW | High |
| ZK data integrity | LOW | High |
| Cross-chain settlement | LOW | High |

---

## 10. Configuration Reference

### 10.1 Facilitator Configuration

```yaml
fcr:
  enabled: true

  lotus:
    endpoint: "http://localhost:1234/rpc/v1"
    token: "${LOTUS_TOKEN}"

  # Confirmation settings
  confirmation:
    # L2 safe heuristic parameters
    l2_heuristic:
      require_round_zero: true
      min_time_in_prepare_ms: 5000
      require_commit_for_certainty: true

    # Polling intervals
    poll_interval_ms:
      default: 1000
      voting_phases: 500
      deciding: 200

  # Default levels by amount
  defaults:
    - max_amount_usd: 0.10
      level: L1
    - max_amount_usd: 100
      level: L2
    - max_amount_usd: null
      level: L3

# Bond configuration (optional)
bond:
  enabled: true
  contract_address: "0x..."

  limits:
    total_bond_usd: 100000
    max_pending_percent: 80

  per_wallet:
    unknown: 5           # $5/day
    history_7d: 50       # $50/day
    history_30d: 500     # $500/day
    verified: 5000       # $5000/day

  fees:
    base_usd: 0.01
    risk_percent: 1.0
    provider_percent: 0.1
```

---

## 11. References

- [FIP-0086: Fast Finality in Filecoin (F3)](https://github.com/filecoin-project/FIPs/blob/master/FIPS/fip-0086.md)
- [go-f3 Implementation](https://github.com/filecoin-project/go-f3)
- [x402 Protocol Specification](https://github.com/coinbase/x402)
- [Ethereum FCR PR #4747](https://github.com/ethereum/consensus-specs/pull/4747)
- [Ethereum FCR Discussion](https://github.com/ethereum/pm/issues/1870)
- [Lotus F3 API Documentation](https://docs.filecoin.io/reference/json-rpc)

---

## Changelog

- v0.2 (2026-01-22): Major revision based on feedback
  - Fixed L2 confirmation to require explicit evidence or safe heuristic
  - Removed hardcoded instance mapping; now derived from APIs
  - Replaced numeric probabilities with proper security statements
  - Added multi-layer architecture with bond model
  - Added configurable provider policies
  - Added streaming/pausable delivery support
- v0.1 (2026-01-21): Initial specification
