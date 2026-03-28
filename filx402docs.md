# FCR-x402 Technical Documentation

## How it works

```
  BUYER                         PROVIDER                      FACILITATOR
    |                               |                               |
    |-- GET /api/resource --------->|                               |
    |<-- 402 PaymentRequirements ---|                               |
    |                               |                               |
    | [signs EIP-3009 off-chain]    |                               |
    |                               |                               |
    |-- GET /api/resource --------->|                               |
    |   + X-Payment header          |                               |
    |                               |-- POST /verify -------------->|
    |                               |<-- { valid: true } -----------|
    |                               |                               |
    |<-- 200 + API response --------|                               |
    |                               |                               |
    |                               |-- POST /settle -------------->|
    |                               |   [commits bond]              |
    |                               |   [submits tx on-chain]       |
    |                               |   [tracks FCR L0 -> L3]       |
    |                               |   [releases bond]             |
    |                               |<-- { paymentId, status } -----|
```

1. Buyer requests a resource, gets a `402 Payment Required` with payment details
2. Buyer signs an EIP-3009 `transferWithAuthorization` off-chain (no gas)
3. Buyer retries the request with the signed payment attached
4. Provider forwards the payment to the facilitator for verification
5. If valid, provider delivers the response immediately
6. Provider asks the facilitator to settle — the facilitator commits bond, submits the on-chain transfer, and tracks finality

---

## API Endpoints

### Core (x402 Payment)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/verify` | POST | Verify a payment (signature, balance, risk, expiry) |
| `/settle` | POST | Submit payment on-chain with bond commitment |
| `/settle/:paymentId` | GET | Settlement status + FCR confirmation level |
| `/health` | GET | Service status, chain connectivity, risk stats |

### FCR (Finality Tracking)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/fcr/status` | GET | Current F3 consensus state |
| `/fcr/levels` | GET | Confirmation level definitions (L0-L3, LB) |
| `/fcr/wait/:level` | GET | Wait for a specific confirmation level |

### Deferred (Escrow)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/deferred/buyers/:address` | GET | Escrow balance, thawing state, stored vouchers |
| `/deferred/vouchers` | POST | Store a signed EIP-712 voucher |
| `/deferred/vouchers/:id/settle` | POST | Collect a voucher on-chain |

### ERC-8004 Agent Identity

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/agent/agent-metadata` | GET | Agent metadata (name, capabilities, limits) |
| `/agent/status` | GET | Registration status, reputation, validation |
| `/.well-known/erc8004-agent.json` | GET | Standard discovery endpoint |

---

## Smart Contracts

### BondedFacilitator

The facilitator deposits USDFC as collateral. Each payment locks a portion of the bond. On successful settlement, the lock is released. If settlement fails after 10 minutes, the provider can claim directly from the bond.

| Function | Description |
|----------|-------------|
| `depositBond(amount)` | Deposit USDFC as collateral |
| `withdrawBond(amount)` | Withdraw unused collateral |
| `commitPayment(id, provider, amount)` | Lock bond for a payment |
| `releasePayment(id)` | Unlock bond after successful settlement |
| `claimPayment(id)` | Provider claims from bond after timeout |

### DeferredPaymentEscrow

Buyers deposit USDFC into escrow. They sign EIP-712 vouchers off-chain with a monotonically increasing `valueAggregate`. Sellers collect on-chain — only the delta since last collection is transferred.

| Function | Description |
|----------|-------------|
| `deposit(amount)` | Buyer deposits USDFC into escrow |
| `thaw(amount)` | Start 1-day withdrawal cooldown |
| `withdraw()` | Withdraw thawed funds after cooldown |
| `collect(voucher, signature)` | Settle a single voucher |
| `collectMany(vouchers, signatures)` | Batch settle multiple vouchers |

---

## Risk Model

### Wallet Tiers

Spending limits scale with wallet history:

| Tier | Daily Limit | Criteria |
|------|------------|----------|
| UNKNOWN | $5/day | New wallets |
| HISTORY_7D | $50/day | 7+ days of history |
| HISTORY_30D | $500/day | 30+ days of history |
| VERIFIED | $5,000/day | Manually verified |

### Provider Policies

The facilitator selects confirmation requirements based on payment size:

| Amount | Model | Min Level | On Timeout |
|--------|-------|-----------|------------|
| < $0.10 | FCR | L1 | Continue (deliver anyway) |
| < $100 | FCR | L2 | Pause (wait longer) |
| >= $100 | FCR | L3 | Abort (reject payment) |

### Fee Structure

| Component | Rate | Applies to |
|-----------|------|------------|
| Base fee | $0.01 | All payments |
| Risk fee | 1% | FCR payments only |
| Provider fee | 0.1% | All payments |

---

## FCR Confirmation Levels

Filecoin's Fast Confirmation Rule using F3/GossiPBFT consensus:

| Level | Meaning | Safety |
|-------|---------|--------|
| L0 | Transaction submitted to mempool | No confirmation |
| L1 | Included in tipset | Basic inclusion (~30s) |
| L2 | COMMIT phase reached or PREPARE+R0+5s heuristic met | High confidence (~45s) |
| L3 | F3 certificate issued | Final, irreversible (~60s) |

---

## Configuration Reference

### Server & Chain

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3402` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `CHAIN_ID` | `314159` | Chain ID (314159=Calibration, 314=Mainnet) |
| `LOTUS_ENDPOINT` | Glif Calibration | JSON-RPC endpoint |
| `LOTUS_TOKEN` | — | Optional RPC auth token |
| `FACILITATOR_PRIVATE_KEY` | — | Wallet private key for transactions |
| `FACILITATOR_ADDRESS` | — | Wallet address |

### Token

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKEN_ADDRESS` | USDFC Calibration | ERC-20 token contract |
| `TOKEN_DECIMALS` | `18` | Token decimal places |
| `TOKEN_NAME` | `USD for Filecoin Community` | EIP-712 domain name |

### Risk Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `RISK_MAX_PER_TX` | `100` | Max USD per transaction |
| `RISK_MAX_PENDING` | `50` | Max USD pending per wallet |
| `RISK_DAILY_LIMIT` | `500` | Max USD per wallet per day |

### Settlement

| Variable | Default | Description |
|----------|---------|-------------|
| `SETTLEMENT_MAX_ATTEMPTS` | `3` | Max retry attempts |
| `SETTLEMENT_RETRY_DELAY_MS` | `5000` | Delay between retries |
| `SETTLEMENT_TIMEOUT_MS` | `300000` | Total settlement timeout |

### FCR

| Variable | Default | Description |
|----------|---------|-------------|
| `FCR_ENABLED` | `true` | Enable F3 monitoring |
| `FCR_POLL_INTERVAL_MS` | `1000` | F3 polling interval |
| `FCR_MIN_TIME_IN_PREPARE_MS` | `5000` | Heuristic buffer before L2 |

### Contracts (Optional)

| Variable | Description |
|----------|-------------|
| `BOND_CONTRACT_ADDRESS` | BondedFacilitator contract |
| `BOND_ALERT_THRESHOLD` | Bond utilisation alert % (default: 80) |
| `ESCROW_CONTRACT_ADDRESS` | DeferredPaymentEscrow contract |
| `ERC8004_IDENTITY_REGISTRY` | ERC-8004 Identity registry |
| `ERC8004_REPUTATION_REGISTRY` | ERC-8004 Reputation registry |
| `ERC8004_VALIDATION_REGISTRY` | ERC-8004 Validation registry |
| `ERC8004_AGENT_ID` | Registered agent ID |

### Redis (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_ENABLED` | `false` | Enable persistence (recommended for production) |
| `REDIS_HOST` | `localhost` | Server host |
| `REDIS_PORT` | `6379` | Server port |
| `REDIS_PASSWORD` | — | Password |
| `REDIS_DB` | `0` | Database index |
| `REDIS_KEY_PREFIX` | `fcr-x402:` | Key prefix |
| `REDIS_MAX_RETRIES` | `3` | Connection retries |
| `REDIS_RETRY_DELAY_MS` | `1000` | Retry delay |

---

## Project Structure

```
FIL-x402/
├── facilitator/          TypeScript payment service (Hono)
│   ├── src/services/     Core services (verify, settle, risk, f3, bond, deferred, erc8004)
│   ├── src/routes/       API endpoints
│   ├── src/types/        Zod schemas and TypeScript types
│   └── src/__tests__/    Test suite (60 tests)
├── contracts/            Solidity smart contracts (Hardhat)
│   ├── contracts/        BondedFacilitator, DeferredPaymentEscrow
│   └── contracts/erc8004/  ERC-8004 registries (git submodule)
├── demo/                 Next.js frontend
│   └── src/app/          Buyer, Provider, Dashboard, Agent pages
└── package/              NPM package (@toju.network/fil v0.2.1)
```

---

## Deployed Contracts

Calibration testnet (`chainId: 314159`):

| Contract | Address |
|----------|---------|
| BondedFacilitator | `0x0C79179E91246998A7F3b372de69ba2a112a37ed` |
| DeferredPaymentEscrow | `0x3EE8f61b928295492886C6509D591da132531ef3` |
| ERC-8004 IdentityRegistry | `0x8A30335A7eff4450671E6aE412Fc786001ce149c` |
| ERC-8004 ReputationRegistry | `0x0510a352722D504767A86B961a493BBB3208a9a5` |
| ERC-8004 ValidationRegistry | `0x151EC586050d500e423f352A8EE6d781F7c7bE9E` |

---

## Mainnet Configuration

| Setting | Calibration | Mainnet |
|---------|-------------|---------|
| `CHAIN_ID` | `314159` | `314` |
| `LOTUS_ENDPOINT` | `api.calibration.node.glif.io` | `api.node.glif.io` |
| `TOKEN_ADDRESS` | See Deployed Contracts | Mainnet USDFC |
| Contracts | See Deployed Contracts | Redeploy required |

**Additional requirements for mainnet:**

- Enable Redis persistence (`REDIS_ENABLED=true`)
- Use HSM or multi-sig for facilitator key
- Deploy contracts with audited code
- Configure monitoring and alerting

---

## Known Limitations

- **F3 is not active on Calibration testnet.** Public RPCs return stale F3 certificates (~23 days behind). The facilitator uses time-based heuristics as a fallback: L1 immediate, L2 at 30s, L3 at 60s. On mainnet, real F3 tracking works via `F3GetLatestCertificate`.
- **USDFC contract uses v,r,s signature format.** The EIP-3009 `transferWithAuthorization` on Calibration uses `(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`, not the `bytes signature` variant. This is handled automatically.
- **Single facilitator wallet.** All settlements and bond operations use one private key. Production would need key management (HSM/multi-sig) and rotation.
- **Redis optional but recommended.** Enable `REDIS_ENABLED=true` for persistent storage of risk tracking, settlements, and vouchers. Without Redis, data is stored in-memory and lost on restart.
