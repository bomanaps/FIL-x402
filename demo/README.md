# FCR-x402 Demo

Interactive demo showing the full x402 payment flow on Filecoin Calibration testnet.

## Features

- **Buyer Demo**: Connect wallet, sign EIP-3009 payment, track FCR confirmation L0→L3
- **Provider Demo**: See how to integrate x402 payments into your API
- **Dashboard**: Real-time FCR status, F3 consensus state, settlement monitoring

## Quick Start

### 1. Start the facilitator (in another terminal)

```bash
cd ../facilitator
npm install
npm run dev
```

The facilitator should be running at http://localhost:3402

### 2. Start the demo

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 3. Connect wallet

- Install MetaMask
- Add Filecoin Calibration network:
  - Network Name: Filecoin Calibration
  - RPC URL: https://api.calibration.node.glif.io/rpc/v1
  - Chain ID: 314159
  - Currency: tFIL
- Get test tFIL from https://faucet.calibnet.chainsafe-fil.io
- Get test USDFC (contact the team or use the faucet if available)

### 4. Make a payment

1. Go to **Buyer** page
2. Enter amount and recipient
3. Click "Sign & Pay"
4. Approve the signature in MetaMask
5. Watch the payment progress through FCR levels

## Environment Variables

Create `.env.local`:

```env
# Facilitator API endpoint
NEXT_PUBLIC_FACILITATOR_URL=http://localhost:3402

# Optional: WalletConnect project ID
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
```

## Architecture

```
Demo App (Next.js)
     │
     ├── Buyer Page ──────▶ Sign EIP-3009 payment
     │                      │
     │                      ▼
     │               ┌─────────────────┐
     │               │   Facilitator    │
     │               │   localhost:3402 │
     │               └────────┬────────┘
     │                        │
     ├── Provider Page ◀──────┤ POST /verify
     │                        │ POST /settle
     │                        │
     └── Dashboard ◀──────────┤ GET /health
                              │ GET /fcr/status
                              ▼
                    ┌─────────────────┐
                    │ Filecoin        │
                    │ Calibration     │
                    └─────────────────┘
```

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Home | `/` | Overview and status |
| Buyer | `/buyer` | Make payments |
| Provider | `/provider` | Integration guide |
| Dashboard | `/dashboard` | Monitoring |

## Tech Stack

- Next.js 14 (App Router)
- RainbowKit + wagmi (wallet connection)
- Tailwind CSS
- TypeScript

## Contract Addresses (Calibration)

| Contract | Address |
|----------|---------|
| USDFC | `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0` |
| BondedFacilitator | `0x0C79179E91246998A7F3b372de69ba2a112a37ed` |
| DeferredPaymentEscrow | `0x3EE8f61b928295492886C6509D591da132531ef3` |
