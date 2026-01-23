# Risk Parameters

## Overview

The facilitator enforces risk limits to bound potential losses from settlement failures. These limits are applied per-wallet and can be configured via environment variables.

## Default Limits

| Parameter | Default | Env Variable | Description |
|-----------|---------|--------------|-------------|
| Max per transaction | $100 | `RISK_MAX_PER_TX` | Maximum single payment amount |
| Max pending per wallet | $50 | `RISK_MAX_PENDING` | Maximum unsettled amount per wallet |
| Daily limit per wallet | $500 | `RISK_DAILY_LIMIT` | Maximum daily volume per wallet |

All values are in USD equivalent (converted to token units using 6 decimals).

## How Limits Work

### 1. Per-Transaction Limit

Each individual payment must be ≤ `maxPerTransaction`.

```
Payment of $150 → REJECTED (exceeds $100 limit)
Payment of $80  → ALLOWED
```

### 2. Pending Limit

Sum of all unsettled payments from a wallet must be ≤ `maxPendingPerWallet`.

```
Wallet has $30 pending
Payment of $25 → REJECTED ($30 + $25 = $55 > $50)
Payment of $15 → ALLOWED  ($30 + $15 = $45 ≤ $50)
```

### 3. Daily Limit

Sum of all settled payments from a wallet in the current day must be ≤ `dailyLimitPerWallet`.

```
Wallet has $450 settled today
Payment of $60 → REJECTED ($450 + $60 = $510 > $500)
Payment of $40 → ALLOWED  ($450 + $40 = $490 ≤ $500)
```

Daily limits reset at midnight UTC.

## Risk Scores

Rejected payments include a `riskScore` (0-100):

| Score | Meaning |
|-------|---------|
| 0 | No risk - payment valid |
| 60 | Daily limit exceeded |
| 70 | Pending limit exceeded |
| 80 | Per-transaction limit or insufficient balance |
| 90 | Balance check failed (RPC error) |
| 100 | Invalid signature, expired, or fundamental error |

## Settlement Tracking

Pending settlements are tracked in memory (Stage 1) with:
- Automatic retry on failure (default: 3 attempts)
- Retry delay: 5 seconds between attempts
- Settlement timeout: 5 minutes

After max retries, payments are marked as failed and credit is released.

## Configuration Example

```bash
# Conservative limits for PoC
RISK_MAX_PER_TX=50
RISK_MAX_PENDING=25
RISK_DAILY_LIMIT=200

# Higher limits for trusted testing
RISK_MAX_PER_TX=500
RISK_MAX_PENDING=250
RISK_DAILY_LIMIT=5000
```

## Future Enhancements (Stage 3)

- Per-wallet risk tiers based on history
- Balance buffer requirements (1.5x payment)
- Facilitator bond for guaranteed settlement
- Real-time exposure monitoring
