# FCR-x402

Instant payments on Filecoin using Fast Confirmation Rule (FCR) + x402 protocol.

## What is this?

A facilitator service that enables sub-minute payment confirmation on Filecoin by:
1. Verifying EIP-3009 `transferWithAuthorization` signatures off-chain
2. Checking balance, nonce, expiry, and risk limits
3. Submitting transactions on-chain and tracking settlement
4. Monitoring F3 (Fast Finality) consensus for confirmation levels

Tested on Filecoin Calibration testnet with USDFC.

## Prerequisites

- Node.js 20+
- A wallet with Filecoin Calibration testnet tokens:
  - **tFIL** (gas) from https://faucet.calibnet.chainsafe-fil.io
  - **USDFC** test tokens
- The wallet's private key (exported from MetaMask or derived from recovery phrase)

## Setup

### 1. Install dependencies

```bash
cd facilitator
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in your wallet details:

```env
FACILITATOR_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
FACILITATOR_ADDRESS=0xYOUR_WALLET_ADDRESS_HERE
```

Everything else is pre-configured for Calibration testnet. The defaults use:
- Glif public RPC (`https://api.calibration.node.glif.io/rpc/v1`)
- USDFC on Calibration (`0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`, 18 decimals)
- Chain ID 314159

### 3. Start the facilitator

```bash
npm run dev
```

You should see:

```
FCR-x402 Facilitator starting...
Starting server on 0.0.0.0:3402
Chain: calibration (314159)
Token: 0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0
Server running at http://0.0.0.0:3402
```

### 4. Run a test payment

In a second terminal:

```bash
PAYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE npx tsx facilitator/scripts/test-payment.ts
```

This will:
1. Check facilitator health
2. Check FCR status
3. Sign an EIP-3009 payment for 1 USDFC
4. Send to `/verify` — validates signature, balance, risk limits
5. Send to `/settle` — submits `transferWithAuthorization` on-chain
6. Poll `/settle/:paymentId` every 5s until confirmed

Expected output:

```
✓ Verification PASSED
✓ Settlement SUBMITTED
  [07:23:06] Settlement: submitted | FCR: L0
✓ Payment FINALIZED (L3)
```

Total time from request to on-chain confirmation: ~60 seconds.

### 5. Run the test suite

```bash
npx vitest run --root facilitator
```

82 tests covering signatures, risk management, F3 heuristics, and API endpoints.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/verify` | POST | Verify a payment (signature, balance, risk, expiry) |
| `/settle` | POST | Submit payment on-chain |
| `/settle/:paymentId` | GET | Get settlement status + FCR confirmation level |
| `/health` | GET | Service status, chain connectivity, risk stats |
| `/fcr/status` | GET | Current F3 consensus state |
| `/fcr/levels` | GET | Confirmation level definitions (L0-L3, LB) |
| `/fcr/wait/:level` | GET | Wait for a specific confirmation level |

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
| `RISK_MAX_PER_TX` | `100` | Max USD per transaction |
| `RISK_MAX_PENDING` | `50` | Max USD pending per wallet |
| `RISK_DAILY_LIMIT` | `500` | Max USD per wallet per day |
| `FCR_ENABLED` | `true` | Enable F3 monitoring |

## Known Limitations

- **F3 monitoring requires a full Lotus node.** Public RPCs (Glif, Ankr) do not expose `F3GetManifest` / `F3GetProgress`. Without a Lotus node with F3 enabled, FCR stays at L0. The facilitator still works for payment submission and verification.
- **No bond contract.** There is no on-chain collateral backing the facilitator's payment commitments. Providers trust the facilitator without financial recourse (Stage 3).
- **No deferred payment scheme.** Every payment is an individual on-chain transaction. Micropayment batching via vouchers is not yet implemented (Stage 3).
- **USDFC contract uses v,r,s signature format.** The EIP-3009 `transferWithAuthorization` on Calibration uses `(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`, not the `bytes signature` variant. This is handled automatically.

## Architecture

```
facilitator/src/
  index.ts              Entry point, Hono server, config loading
  types/
    config.ts           Zod-validated configuration schema
    payment.ts          EIP-3009 payload, requirements, settlement types
    f3.ts               F3 phases, confirmation levels, instance state
  services/
    lotus.ts            Filecoin RPC client (balance, nonce, tx submission)
    signature.ts        EIP-712 / EIP-3009 signature verification
    verify.ts           Full payment verification pipeline
    risk.ts             In-memory risk tracking (per-tx, pending, daily)
    settle.ts           Settlement submission + background retry worker
    f3.ts               F3 progress monitor, L2 safe heuristic, instance mapping
  routes/
    verify.ts           POST /verify
    settle.ts           POST /settle, GET /settle/:id
    health.ts           GET /health
    fcr.ts              GET /fcr/status, /fcr/levels, /fcr/wait/:level
  __tests__/            Test suite (signature, risk, F3, API integration)
  scripts/
    test-payment.ts     End-to-end test client
```

## Docs

- [Technical Spec](./fcr-x402-spec.md) — FCR confirmation model, F3 heuristics, bond design
- [Implementation Roadmap](./plan.md) — 4-stage plan (Stage 1 complete, Stage 2 complete)
