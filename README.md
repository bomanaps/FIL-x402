# FCR-x402

Instant payments on Filecoin using the x402 HTTP payment protocol, Fast Confirmation Rule (FCR), and on-chain bond/escrow contracts.

## What is this?

A facilitator service that sits between API providers and buyers to handle payment verification, on-chain settlement, and finality tracking on Filecoin. It supports two payment models:

- **Instant (FCR)** — Buyer signs an EIP-3009 authorization off-chain. The facilitator verifies it, submits it on-chain, and tracks F3/GossiPBFT finality from L0 through L3. Provider gets paid in a single transaction.
- **Deferred (Escrow)** — Buyer deposits USDFC into an on-chain escrow. Each API call, the buyer signs an EIP-712 voucher off-chain with a monotonically increasing total. The provider collects periodically, paying gas once for many requests.

Both models are backed by a **bond contract** — the facilitator deposits USDFC collateral that gets locked per-payment, so providers have financial recourse if settlement fails.

Deployed and tested on Filecoin Calibration testnet with USDFC.

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

## Prerequisites

- Node.js 20+
- A wallet with Filecoin Calibration testnet tokens:
  - **tFIL** (gas) from https://faucet.calibnet.chainsafe-fil.io
  - **USDFC** test tokens from https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc
- The wallet's private key

## Quick Start

### 1. Install dependencies

```bash
# Facilitator
cd facilitator
npm install

# Contracts (only if you need to redeploy)
cd ../contracts
npm install
```

### 2. Configure environment

```bash
cd facilitator
cp .env.example .env
```

Edit `.env` with your wallet details:

```env
FACILITATOR_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
FACILITATOR_ADDRESS=0xYOUR_WALLET_ADDRESS_HERE
```

Everything else is pre-configured for Calibration testnet:
- Glif public RPC (`https://api.calibration.node.glif.io/rpc/v1`)
- USDFC (`0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`, 18 decimals)
- Chain ID 314159

### 3. Deploy contracts (optional)

Contracts are already deployed to Calibration (see [Deployed Contracts](#deployed-contracts)). If you need to redeploy:

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network calibration
```

Then update `.env` with the new addresses.

### 4. Start the facilitator

```bash
cd facilitator
npm run dev
```

You should see:

```
FCR-x402 Facilitator starting...
Bond service enabled: 0x0C79...
Deferred service enabled: 0x3EE8...
ERC-8004 service enabled: Agent #0
Server running at http://0.0.0.0:3402
```

### 5. Test a payment

In a second terminal:

```bash
cd facilitator
PAYER_PRIVATE_KEY=0xYOUR_KEY npx tsx scripts/test-payment.ts
```

This runs the full x402 payment flow:
1. Health check and FCR status
2. Signs an EIP-3009 payment for 1 USDFC
3. Verifies via `POST /verify`
4. Settles via `POST /settle`
5. Polls confirmation until L3 finality

### 6. Test bond + escrow contracts

```bash
cd facilitator
npx tsx --env-file .env scripts/test-stage3.ts
```

This tests on-chain contract operations:
1. Bond: deposit -> commit -> release -> withdraw
2. Escrow: deposit -> sign voucher -> collect
3. API: server health and deferred buyer endpoint

### 7. Run the demo frontend

```bash
# In a new terminal
npm install --prefix demo
npm run dev --prefix demo
```

Open http://localhost:3000 to see:
- **Buyer page** — Connect wallet, sign payments, watch FCR L0→L3 progression
- **Provider page** — Integration guide and code examples
- **Dashboard** — Real-time facilitator monitoring
- **Agent page** — ERC-8004 agent identity, reputation, and validation status

### 8. Run the test suite

```bash
# Contract tests (33 tests)
cd contracts
npx hardhat test

# Facilitator tests (60 tests)
cd facilitator
npx vitest run
```

93 tests total covering signatures, risk management, F3 heuristics, fee calculation, provider policies, deferred vouchers, and API endpoints.

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

## FCR Confirmation Levels

Filecoin's Fast Confirmation Rule using F3/GossiPBFT consensus:

| Level | Meaning | Safety |
|-------|---------|--------|
| L0 | Transaction submitted to mempool | No confirmation |
| L1 | Included in tipset | Basic inclusion (~30s) |
| L2 | COMMIT phase reached or PREPARE+R0+5s heuristic met | High confidence (~45s) |
| L3 | F3 certificate issued | Final, irreversible (~60s) |

## Configuration Reference

### Server & Chain

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3402` | Server port |
| `CHAIN_ID` | `314159` | Chain ID (314159=Calibration, 314=Mainnet) |
| `LOTUS_ENDPOINT` | Glif Calibration | JSON-RPC endpoint |
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
| `FCR_ENABLED` | `true` | Enable F3 monitoring |

### Contracts (Optional)

| Variable | Description |
|----------|-------------|
| `BOND_CONTRACT_ADDRESS` | BondedFacilitator contract |
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

## Project Structure

```
FIL-x402/
├── facilitator/          TypeScript payment service (Hono)
│   ├── src/services/     Core services (verify, settle, risk, f3, bond)
│   ├── src/routes/       API endpoints
│   └── src/__tests__/    Test suite (60 tests)
├── contracts/            Solidity smart contracts (Hardhat)
│   ├── contracts/        BondedFacilitator, DeferredPaymentEscrow
│   └── lib/erc8004-contracts/  ERC-8004 registries (submodule)
└── demo/                 Next.js frontend
    └── src/app/          Buyer, Provider, Dashboard, Agent pages
```

## Known Limitations

- **F3 is not active on Calibration testnet.** Public RPCs return stale F3 certificates (~23 days behind). The facilitator uses time-based heuristics as a fallback: L1 immediate, L2 at 30s, L3 at 60s. On mainnet, real F3 tracking works via `F3GetLatestCertificate`.
- **USDFC contract uses v,r,s signature format.** The EIP-3009 `transferWithAuthorization` on Calibration uses `(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`, not the `bytes signature` variant. This is handled automatically.
- **Single facilitator wallet.** All settlements and bond operations use one private key. Production would need key management (HSM/multi-sig) and rotation.
- **Redis optional but recommended.** Enable `REDIS_ENABLED=true` for persistent storage of risk tracking, settlements, and vouchers. Without Redis, data is stored in-memory and lost on restart.

## Mainnet Configuration

When deploying to Filecoin Mainnet:

| Setting | Calibration | Mainnet |
|---------|-------------|---------|
| `CHAIN_ID` | `314159` | `314` |
| `LOTUS_ENDPOINT` | `api.calibration.node.glif.io` | `api.node.glif.io` |
| `TOKEN_ADDRESS` | See [Deployed Contracts](#deployed-contracts) | Mainnet USDFC |
| Contracts | See [Deployed Contracts](#deployed-contracts) | Redeploy required |

**Additional requirements:**

- Enable Redis persistence (`REDIS_ENABLED=true`)
- Use HSM or multi-sig for facilitator key
- Deploy contracts with audited code
- Configure monitoring and alerting

## Deployed Contracts

Calibration testnet (`chainId: 314159`):

| Contract | Address |
|----------|---------|
| BondedFacilitator | `0x0C79179E91246998A7F3b372de69ba2a112a37ed` |
| DeferredPaymentEscrow | `0x3EE8f61b928295492886C6509D591da132531ef3` |
| ERC-8004 IdentityRegistry | `0x8A30335A7eff4450671E6aE412Fc786001ce149c` |
| ERC-8004 ReputationRegistry | `0x0510a352722D504767A86B961a493BBB3208a9a5` |
| ERC-8004 ValidationRegistry | `0x151EC586050d500e423f352A8EE6d781F7c7bE9E` |


## Documentation

- [Technical Spec](./fcr-x402-spec.md) — FCR confirmation model, F3 heuristics, bond design

## License

MIT
