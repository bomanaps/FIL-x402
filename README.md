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

## API

```
POST /verify   - Verify payment before accepting
POST /settle   - Submit payment to chain
GET  /health   - Service status
```

## Docs

- [Technical Spec](./fcr-x402-spec.md)
- [Implementation Roadmap](../fin.md)
