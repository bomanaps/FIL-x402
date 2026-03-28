# FCR-x402

Instant payments on Filecoin using the x402 HTTP payment protocol and Fast Confirmation Rule (FCR).

[Video Walkthrough](https://youtu.be/IgoX2aImy0s?si=_xdYRbNPlrjWWmmE) | [Technical Docs](./filx402docs.md) | [Technical Spec](./fcr-x402-spec.md) | [Contributing](./CONTRIBUTING.md)

## What is FCR-x402

FCR-x402 is a facilitator service that sits between API providers and buyers to handle payment verification, on-chain settlement, and finality tracking on Filecoin. It implements the x402 HTTP payment protocol with two payment models:

- **Instant (FCR)** — Buyer signs an EIP-3009 authorization off-chain. The facilitator verifies it, submits it on-chain, and tracks F3/GossiPBFT finality from L0 through L3.
- **Deferred (Escrow)** — Buyer deposits USDFC into an on-chain escrow and signs EIP-712 vouchers per API call. The provider collects periodically, paying gas once for many requests.

Both models are backed by a **bond contract** — the facilitator deposits USDFC collateral that gets locked per-payment, giving providers financial recourse if settlement fails.

## What is x402

x402 is an HTTP payment protocol that revives the unused `402 Payment Required` status code. An API responds with `402` and payment requirements; the client attaches a signed payment to the next request. No redirects, no accounts — payments happen at the HTTP layer.

## What is FCR

The Fast Confirmation Rule uses Filecoin's F3/GossiPBFT consensus to provide sub-minute finality. Payments move through confirmation levels L0 (mempool) → L1 (tipset) → L2 (COMMIT phase) → L3 (F3 certificate), giving providers configurable risk thresholds per payment size.

## Goals

Building a production-grade x402 facilitator for Filecoin that is:

- Modular — bond, escrow, ERC-8004 identity, and risk services are independently optional
- Contributor-friendly — fully typed TypeScript with 93 tests
- Fast — sub-second verification, single-transaction settlement
- Extensible — provider policy hooks, wallet tiering, Redis persistence

## Quick Start

**Prerequisites:** Node.js 20+, tFIL (gas), and USDFC on Calibration testnet.

```bash
cd facilitator
npm install
cp .env.example .env
# Add FACILITATOR_PRIVATE_KEY and FACILITATOR_ADDRESS to .env
npm run dev
```

Server starts at `http://localhost:3402`.

For full setup, contract deployment, demo frontend, and test instructions see the [Technical Docs](./filx402docs.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for environment setup, code standards, testing requirements, and the pull request process.

## Getting Help

- Open an issue on this repository
- See the [Technical Docs](./filx402docs.md) for API reference, configuration, and contract details

## License

MIT
