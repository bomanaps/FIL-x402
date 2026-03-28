import { Counter, Gauge, Histogram, register } from 'prom-client';

export const metrics = {

  // ── Verify ────────────────────────────────────────────────────
  verifyTotal: new Counter({
    name: 'fcr_verify_total',
    help: 'Payment verification attempts',
    labelNames: ['result', 'reason'] as const,
  }),

  // ── Settlement ────────────────────────────────────────────────
  settleTotal: new Counter({
    name: 'fcr_settlements_total',
    help: 'Settlement outcomes',
    labelNames: ['status'] as const,
  }),
  settleRetries: new Counter({
    name: 'fcr_settlement_retries_total',
    help: 'Settlement retry attempts',
  }),
  settleDuration: new Histogram({
    name: 'fcr_settlement_duration_seconds',
    help: 'Time from settlement submission to on-chain confirmation',
    buckets: [5, 15, 30, 60, 120, 300],
  }),
  pendingSettlements: new Gauge({
    name: 'fcr_pending_settlements',
    help: 'Number of in-flight settlements',
  }),
  pendingAmountUsd: new Gauge({
    name: 'fcr_pending_amount_usd',
    help: 'Total USD value of pending settlements',
  }),

  // ── Risk ──────────────────────────────────────────────────────
  riskCheckTotal: new Counter({
    name: 'fcr_risk_checks_total',
    help: 'Risk check outcomes',
    labelNames: ['result', 'reason'] as const,
  }),

  // ── F3 / FCR ──────────────────────────────────────────────────
  f3Instance: new Gauge({
    name: 'fcr_f3_instance',
    help: 'Current F3 instance number',
  }),
  f3Round: new Gauge({
    name: 'fcr_f3_round',
    help: 'Current F3 round within the instance',
  }),
  f3RoundBumps: new Counter({
    name: 'fcr_f3_round_bumps_total',
    help: 'F3 round bump count — elevated values indicate consensus contention',
  }),
  confirmationLatency: new Histogram({
    name: 'fcr_confirmation_latency_seconds',
    help: 'Time for a payment to reach each FCR confirmation level',
    labelNames: ['level'] as const,
    buckets: [5, 15, 30, 60, 90, 120],
  }),

  // ── Bond ──────────────────────────────────────────────────────
  bondUtilization: new Gauge({
    name: 'fcr_bond_utilization_percent',
    help: 'Bond utilisation as a percentage of total bond',
  }),
  bondAvailable: new Gauge({
    name: 'fcr_bond_available_usdfc',
    help: 'Available (uncommitted) bond balance in USDFC base units',
  }),
  bondCommitted: new Gauge({
    name: 'fcr_bond_committed_usdfc',
    help: 'Currently committed bond in USDFC base units',
  }),
  bondCommitFailures: new Counter({
    name: 'fcr_bond_commit_failures_total',
    help: 'Bond commitment failures due to insufficient capacity',
  }),
};

export { register };
