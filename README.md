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

Contracts are already deployed to Calibration. If you need to redeploy:

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network calibration
```

Then update `.env` with the new addresses:

```env
BOND_CONTRACT_ADDRESS=0x...
ESCROW_CONTRACT_ADDRESS=0x...
```

Current deployments:
- BondedFacilitator: `0x0C79179E91246998A7F3b372de69ba2a112a37ed`
- DeferredPaymentEscrow: `0x3EE8f61b928295492886C6509D591da132531ef3`

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
Server running at http://0.0.0.0:3402

Stage 3 Services:
  Bond: 0x0C79179E91246998A7F3b372de69ba2a112a37ed
  Escrow: 0x3EE8f61b928295492886C6509D591da132531ef3
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
| L0 | Transaction submitted | No confirmation |
| L1 | Included in tipset | Basic inclusion |
| L2 | F3 instance started covering the epoch | Consensus in progress |
| L3 | F3 finalized the epoch | Final, irreversible |
| LB | 900+ epochs deep | Legacy Filecoin finality |

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3402` | Server port |
| `LOTUS_ENDPOINT` | Glif Calibration | Filecoin JSON-RPC endpoint |
| `TOKEN_ADDRESS` | USDFC Calibration | ERC-20 token contract address |
| `TOKEN_DECIMALS` | `18` | Token decimal places |
| `TOKEN_NAME` | `USD for Filecoin Community` | EIP-712 domain name (must match contract) |
| `CHAIN_ID` | `314159` | Filecoin chain ID (314159=Calibration, 314=Mainnet) |
| `FACILITATOR_PRIVATE_KEY` | — | Wallet private key for submitting transactions |
| `FACILITATOR_ADDRESS` | — | Wallet address |
| `BOND_CONTRACT_ADDRESS` | — | BondedFacilitator contract (optional, enables bond) |
| `ESCROW_CONTRACT_ADDRESS` | — | DeferredPaymentEscrow contract (optional, enables deferred) |
| `RISK_MAX_PER_TX` | `100` | Max USD per transaction |
| `RISK_MAX_PENDING` | `50` | Max USD pending per wallet |
| `RISK_DAILY_LIMIT` | `500` | Max USD per wallet per day |
| `FCR_ENABLED` | `true` | Enable F3 monitoring |
| `REDIS_ENABLED` | `false` | Enable Redis persistence (recommended for production) |
| `REDIS_HOST` | `localhost` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | — | Redis password (optional) |
| `REDIS_DB` | `0` | Redis database index |
| `REDIS_KEY_PREFIX` | `fcr-x402:` | Key prefix for namespacing |

## Project Structure

```
FIL-x402/
  demo/                               Next.js demo frontend
    src/app/
      buyer/page.tsx                  Payment signing + FCR tracking
      provider/page.tsx               Integration guide
      dashboard/page.tsx              Facilitator monitoring
    src/lib/
      config.ts                       Chain/contract configuration
      facilitator.ts                  API client
  contracts/                          Hardhat project (Solidity)
    contracts/
      BondedFacilitator.sol           Bond collateral contract
      DeferredPaymentEscrow.sol       Escrow + EIP-712 voucher contract
      interfaces/                     Contract interfaces
      mocks/MockERC20.sol             Test token
    test/                             Contract tests (33 tests)
    scripts/deploy.ts                 Calibration deployment script
  facilitator/                        TypeScript service (Hono)
    src/
      index.ts                        Entry point, server, config
      types/
        config.ts                     Zod-validated configuration
        payment.ts                    EIP-3009 payload, requirements
        f3.ts                         F3 phases, confirmation levels
        bond.ts                       Bond config, payment status
        deferred.ts                   Voucher schema, escrow account
        policy.ts                     Provider policy interfaces
      services/
        lotus.ts                      Filecoin RPC client
        signature.ts                  EIP-712 / EIP-3009 verification
        verify.ts                     Payment verification pipeline
        risk.ts                       Tiered risk tracking
        settle.ts                     Settlement + bond integration
        f3.ts                         F3 monitor, L2 heuristic
        bond.ts                       Bond contract wrapper
        deferred.ts                   Escrow + voucher management
        fee.ts                        Fee calculation
        policy.ts                     Provider policy engine
        redis.ts                      Redis persistence + distributed locking
      routes/
        verify.ts                     POST /verify
        settle.ts                     POST /settle, GET /settle/:id
        health.ts                     GET /health
        fcr.ts                        GET /fcr/*
        deferred.ts                   GET/POST /deferred/*
      __tests__/                      Test suite (60 tests)
    scripts/
      test-payment.ts                 x402 payment flow test
      test-stage3.ts                  Bond + escrow integration test
```

## Known Limitations

- **F3 is not active on Calibration testnet.** Public RPCs return stale F3 certificates (~23 days behind). The facilitator uses time-based heuristics as a fallback: L1 immediate, L2 at 30s, L3 at 60s. On mainnet, real F3 tracking works via `F3GetLatestCertificate`.
- **USDFC contract uses v,r,s signature format.** The EIP-3009 `transferWithAuthorization` on Calibration uses `(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`, not the `bytes signature` variant. This is handled automatically.
- **Single facilitator wallet.** All settlements and bond operations use one private key. Production would need key management (HSM/multi-sig) and rotation.
- **Redis optional but recommended.** Enable `REDIS_ENABLED=true` for persistent storage of risk tracking, settlements, and vouchers. Without Redis, data is stored in-memory and lost on restart.

## Mainnet Configuration

When deploying to Filecoin Mainnet, update these settings:

| Setting | Calibration (Testnet) | Mainnet |
|---------|----------------------|---------|
| `CHAIN_ID` | `314159` | `314` |
| `LOTUS_ENDPOINT` | `https://api.calibration.node.glif.io/rpc/v1` | `https://api.node.glif.io/rpc/v1` |
| `TOKEN_ADDRESS` | `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0` | TBD (mainnet USDFC) |
| `BOND_CONTRACT_ADDRESS` | `0x0C79179E91246998A7F3b372de69ba2a112a37ed` | Redeploy required |
| `ESCROW_CONTRACT_ADDRESS` | `0x3EE8f61b928295492886C6509D591da132531ef3` | Redeploy required |

**Additional mainnet requirements:**
- Enable Redis persistence (`REDIS_ENABLED=true`)
- Use HSM or multi-sig for facilitator key
- Deploy contracts with audited code
- Configure monitoring and alerting

## Roadmap

| Stage | Description | Status |
|-------|-------------|--------|
| 1 | PoC — Core x402 protocol, EIP-3009 settlement | Complete |
| 2 | FCR Integration — F3 finality monitoring, L0-L3 levels | Complete |
| 3 | Bond + Deferred — Collateral contracts, escrow vouchers, risk tiers | Complete |
| 4 | Production Hardening — Persistence, key management, monitoring, audit | Planned |
| 5 | EIP-8004 Trustless Agents — Discovery, reputation, validation registries | Planned |
| 6 | Ecosystem Integration — Secured Finance partnership, x402 Foundation, storage provider onboarding | Planned |

## Docs

- [Technical Spec](./fcr-x402-spec.md) — FCR confirmation model, F3 heuristics, bond design
- [Implementation Roadmap](./plan.md) — 6-stage plan (Stages 1-3 complete)
- [API Reference](./facilitator/docs/api.md) — Endpoint details
- [Risk Model](./facilitator/docs/risk.md) — Risk management details

## License

MIT
