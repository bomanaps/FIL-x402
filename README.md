# FCR-x402

Instant payments on Filecoin using Fast Confirmation Rule (FCR) + x402 protocol.


## What is this?

A facilitator service that enables sub-minute payment confirmation on Filecoin by:
1. Verifying EIP-3009 `transferWithAuthorization` signatures off-chain
2. Checking balance and risk limits
3. Submitting transactions and tracking settlement

## Quick Start

```bash
cd facilitator
npm install
cp .env.example .env
# Edit .env with your config
npm run dev
```

## Configuration

Required environment variables:

| Variable | Description |
|----------|-------------|
| `LOTUS_ENDPOINT` | Filecoin RPC endpoint |
| `TOKEN_ADDRESS` | USDFC contract address |
| `FACILITATOR_PRIVATE_KEY` | Wallet key for tx submission |
| `FCR_ENABLED` | Enable F3 monitoring (default: true) |

## API

```
POST /verify      - Verify payment before accepting
POST /settle      - Submit payment to chain
GET  /health      - Service status
GET  /fcr/status  - F3 consensus status
GET  /fcr/levels  - Confirmation level definitions
```

## Docs

- [Technical Spec](./fcr-x402-spec.md)
- [Implementation Roadmap](../fin.md)
