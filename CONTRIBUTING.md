# Contributing to FCR-x402

Thank you for your interest in contributing. This document covers everything you need to get started — environment setup, code standards, testing requirements, and the pull request process.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Before You Start](#before-you-start)
- [Development Environment](#development-environment)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Code Standards](#code-standards)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)
- [Smart Contract Contributions](#smart-contract-contributions)
- [Areas Open for Contribution](#areas-open-for-contribution)

---

## Code of Conduct

Be respectful and constructive. Harassment, discrimination, or personal attacks of any kind will not be tolerated.

---

## Before You Start

- Read the [Technical Docs](./filx402docs.md) to understand the architecture
- Read the [Technical Spec](./fcr-x402-spec.md) for the FCR confirmation model and bond design
- Check open issues before starting work — someone may already be working on it
- For significant changes, open an issue first to discuss the approach before writing code

---

## Development Environment

### Prerequisites

- Node.js 20+
- npm 9+
- Git
- A wallet with Filecoin Calibration testnet tokens:
  - **tFIL** (gas) from https://faucet.calibnet.chainsafe-fil.io
  - **USDFC** from https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc

### Setup

**1. Clone the repository**

```bash
git clone <repo-url>
cd FIL-x402
git submodule update --init --recursive
```

The `--recursive` flag is required to initialise the ERC-8004 contracts submodule under `contracts/contracts/erc8004/`.

**2. Install dependencies**

```bash
# Facilitator
cd facilitator && npm install

# Contracts
cd ../contracts && npm install

# Demo (optional)
cd ../demo && npm install
```

**3. Configure environment**

```bash
cd facilitator
cp .env.example .env
```

Set at minimum:

```env
FACILITATOR_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
FACILITATOR_ADDRESS=0xYOUR_ADDRESS
```

Everything else defaults to Calibration testnet. See the [full configuration reference](./filx402docs.md#configuration-reference).

**4. Start the facilitator**

```bash
cd facilitator
npm run dev
```

---

## Project Structure

```
FIL-x402/
├── facilitator/
│   ├── src/
│   │   ├── services/     Core business logic — start here for most changes
│   │   ├── routes/       HTTP handlers — thin layer, minimal logic
│   │   ├── types/        Zod schemas and TypeScript types
│   │   └── __tests__/    One test file per service
│   └── .env.example      All supported environment variables
│
├── contracts/
│   ├── contracts/        Solidity source
│   │   ├── BondedFacilitator.sol
│   │   ├── DeferredPaymentEscrow.sol
│   │   ├── interfaces/   IBondedFacilitator, IDeferredPaymentEscrow
│   │   └── erc8004/      ERC-8004 registries (git submodule — do not edit here)
│   └── test/             Hardhat/Chai contract tests
│
├── demo/
│   └── src/app/          Next.js pages (buyer, provider, dashboard, agent)
│
└── package/              NPM package (@toju.network/fil) — published separately
```

---

## Making Changes

### Branches

Branch off `main` for all work:

```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/issue-description
```

Use the prefixes:

| Prefix | Use for |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `test/` | Test additions or fixes |
| `docs/` | Documentation changes |
| `refactor/` | Refactors with no behaviour change |
| `chore/` | Dependency updates, config changes |

### Scope of changes

- Keep PRs focused. One logical change per PR.
- Do not bundle unrelated refactors into a feature PR.
- If you discover a separate bug while working, open a separate issue or PR.

---

## Code Standards

### TypeScript

- Strict mode is enabled — no implicit `any`, no unchecked nulls
- Use explicit return types on all exported functions
- Use Zod for all external input validation (HTTP request bodies, env vars)
- Prefer `const` over `let`; avoid `var`
- Use `BigInt` for all on-chain token amounts — never `number` for wei/attoFIL values
- Address comparisons must normalise case: use `.toLowerCase()` or ethers checksumming consistently

### Services

- Services are classes injected via constructor — follow the existing pattern
- Keep route handlers thin: validate input, call service, return response
- All service methods should be `async` and return typed results
- Do not throw from service methods where a typed return value is possible — return an error object instead

### Solidity

- Solidity 0.8.20+
- All public functions must have NatSpec (`@notice`, `@param`, `@return`)
- Use `ReentrancyGuard` for any function that transfers tokens
- No magic numbers — use named constants
- Follow the checks-effects-interactions pattern

---

## Testing

All changes must include tests. PRs without tests for new behaviour will not be merged.

### Facilitator tests (Vitest)

```bash
cd facilitator
npx vitest run          # run all tests
npx vitest run --coverage   # with coverage report
npx vitest watch        # watch mode during development
```

Tests live in `facilitator/src/__tests__/`, one file per service. Follow the existing pattern:

- Unit test each service method directly
- Mock external dependencies (Lotus RPC, Redis) using Vitest mocks
- Test both success paths and failure/edge cases
- For new services, create a corresponding `yourservice.test.ts`

### Contract tests (Hardhat)

```bash
cd contracts
npx hardhat test
npx hardhat coverage
```

Tests live in `contracts/test/`. Follow the existing pattern:

- Deploy fresh contracts in `beforeEach`
- Use `MockERC20` for token interactions in tests
- Test all revert conditions with `revertedWith` or `revertedWithCustomError`
- Test all emitted events with `emit`

### Test checklist before submitting a PR

- [ ] All existing tests pass
- [ ] New tests added for all new behaviour
- [ ] Edge cases and failure paths are tested
- [ ] No tests skipped (`.skip`) unless explicitly discussed in the PR

---

## Commit Messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `test`, `docs`, `refactor`, `chore`

**Scope:** The component being changed, e.g. `verify`, `settle`, `f3`, `bond`, `escrow`, `contracts`, `demo`

**Examples:**

```
feat(risk): add VERIFIED wallet tier with configurable daily limit

fix(f3): handle stale F3 certificate without crashing poll loop

test(settle): add test for bond release on submission failure

docs: add CONTRIBUTING guide

chore(deps): bump ethers to 6.14.0
```

Rules:
- Subject line: 72 characters max, imperative mood, no period at the end
- Body: explain *why*, not *what* — the diff shows what changed
- Reference issues in the footer: `Closes #42`

---

## Pull Request Process

1. **Ensure your branch is up to date** with `main` before opening a PR
2. **Run the full test suite** — all tests must pass
3. **Fill out the PR description** with:
   - What the change does
   - Why it is needed (link the relevant issue)
   - How you tested it
   - Any known limitations or follow-up work
4. **Keep PRs small** — large PRs are harder to review and slower to merge
5. **Respond to review comments** — address all feedback or explain why you disagree
6. **Do not force-push** after a review has started — add new commits instead

PRs are merged via squash merge. Your branch history does not need to be clean, but the squash commit message must follow the commit message format above.

---

## Reporting Bugs

Open an issue with:

- A clear title describing the problem
- Steps to reproduce
- Expected behaviour
- Actual behaviour (including error messages or logs)
- Environment: Node.js version, OS, network (Calibration/Mainnet)
- Relevant configuration (redact any private keys)

For security vulnerabilities, do **not** open a public issue. Contact the maintainers directly.

---

## Suggesting Features

Open an issue with the `enhancement` label and include:

- The problem you are trying to solve
- Your proposed solution
- Alternatives you considered
- Whether you are willing to implement it

Features that align with the project goals (modular, fast, extensible) will be prioritised.

---

## Smart Contract Contributions

Smart contract changes carry additional risk and have a higher bar for review:

- Any change to `BondedFacilitator.sol` or `DeferredPaymentEscrow.sol` requires a thorough test suite update covering all modified code paths
- Revert conditions must be explicitly tested
- Gas costs should not increase significantly without justification
- ABI-breaking changes require a version bump and migration notes
- Do not modify anything under `contracts/contracts/erc8004/` — that is a git submodule managed upstream

If you are proposing a security-relevant change (access control, fund handling, signature verification), flag it clearly in the PR description.

---

## Areas Open for Contribution

The following areas are well-suited for contributors:

| Area | Description |
|------|-------------|
| E2E tests | Full payment flow tests: verify → settle → finality confirmation |
| CI/CD | GitHub Actions for automated test runs on PRs |
| Rate limiting | Per-IP and per-wallet request limiting middleware |
| Exponential backoff | Replace flat retry delay in `settle.ts` with jitter + backoff |
| OpenAPI spec | Document all endpoints in OpenAPI 3.0 format |
| Docker Compose | Local orchestration for Redis + facilitator |
| Prometheus metrics | Expose payment counters, settlement latency, F3 level distribution |
| Mainnet deployment guide | Step-by-step guide for production deployment |
| SDK examples | Code examples for integrating `@toju.network/fil` in provider apps |

If you pick one of these up, comment on the relevant issue so others know it is in progress.
