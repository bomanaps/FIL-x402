import type { Config } from '../types/config.js';
import type { PaymentPayload, PendingSettlement, RiskLimits } from '../types/payment.js';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  riskScore: number;
  currentPending: bigint;
  dailyUsed: bigint;
}

/**
 * In-memory risk tracking service
 * For production, replace with Redis-backed implementation
 */
export class RiskService {
  private config: Config;
  private limits: RiskLimits;

  // In-memory tracking (replace with Redis for production)
  private pendingByWallet: Map<string, bigint> = new Map();
  private dailyUsageByWallet: Map<string, { amount: bigint; date: string }> = new Map();
  private pendingSettlements: Map<string, PendingSettlement> = new Map();

  constructor(config: Config) {
    this.config = config;

    // Convert USD limits to token units (assuming 6 decimals)
    const decimals = BigInt(10 ** config.token.decimals);
    this.limits = {
      maxPerTransaction: BigInt(config.risk.maxPerTransaction) * decimals,
      maxPendingPerWallet: BigInt(config.risk.maxPendingPerWallet) * decimals,
      dailyLimitPerWallet: BigInt(config.risk.dailyLimitPerWallet) * decimals,
    };
  }

  /**
   * Get current date string for daily limit tracking
   */
  private getDateKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get pending amount for a wallet
   */
  getPendingAmount(wallet: string): bigint {
    return this.pendingByWallet.get(wallet.toLowerCase()) || 0n;
  }

  /**
   * Get daily usage for a wallet
   */
  getDailyUsage(wallet: string): bigint {
    const usage = this.dailyUsageByWallet.get(wallet.toLowerCase());
    if (!usage || usage.date !== this.getDateKey()) {
      return 0n;
    }
    return usage.amount;
  }

  /**
   * Check if a payment passes risk limits
   */
  checkPayment(payment: PaymentPayload): RiskCheckResult {
    const wallet = payment.from.toLowerCase();
    const amount = BigInt(payment.value);

    // 1. Check max per transaction
    if (amount > this.limits.maxPerTransaction) {
      return {
        allowed: false,
        reason: `Amount ${amount} exceeds max per transaction ${this.limits.maxPerTransaction}`,
        riskScore: 80,
        currentPending: this.getPendingAmount(wallet),
        dailyUsed: this.getDailyUsage(wallet),
      };
    }

    // 2. Check pending limit
    const currentPending = this.getPendingAmount(wallet);
    if (currentPending + amount > this.limits.maxPendingPerWallet) {
      return {
        allowed: false,
        reason: `Pending ${currentPending + amount} would exceed max pending ${this.limits.maxPendingPerWallet}`,
        riskScore: 70,
        currentPending,
        dailyUsed: this.getDailyUsage(wallet),
      };
    }

    // 3. Check daily limit
    const dailyUsed = this.getDailyUsage(wallet);
    if (dailyUsed + amount > this.limits.dailyLimitPerWallet) {
      return {
        allowed: false,
        reason: `Daily usage ${dailyUsed + amount} would exceed daily limit ${this.limits.dailyLimitPerWallet}`,
        riskScore: 60,
        currentPending,
        dailyUsed,
      };
    }

    // All checks passed
    return {
      allowed: true,
      riskScore: 0,
      currentPending,
      dailyUsed,
    };
  }

  /**
   * Reserve credit for a pending payment
   * Called when a payment is verified and will be settled
   */
  reserveCredit(paymentId: string, payment: PaymentPayload): void {
    const wallet = payment.from.toLowerCase();
    const amount = BigInt(payment.value);

    // Add to pending
    const currentPending = this.getPendingAmount(wallet);
    this.pendingByWallet.set(wallet, currentPending + amount);

    // Store pending settlement
    this.pendingSettlements.set(paymentId, {
      paymentId,
      payment,
      requirements: {} as any, // Will be filled by caller
      status: 'pending',
      attempts: 0,
      maxAttempts: this.config.settlement.maxAttempts,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Release credit after successful settlement
   */
  releaseCredit(paymentId: string, success: boolean): void {
    const settlement = this.pendingSettlements.get(paymentId);
    if (!settlement) return;

    const wallet = settlement.payment.from.toLowerCase();
    const amount = BigInt(settlement.payment.value);

    // Remove from pending
    const currentPending = this.getPendingAmount(wallet);
    this.pendingByWallet.set(wallet, currentPending > amount ? currentPending - amount : 0n);

    if (success) {
      // Add to daily usage on success
      const dailyUsed = this.getDailyUsage(wallet);
      this.dailyUsageByWallet.set(wallet, {
        amount: dailyUsed + amount,
        date: this.getDateKey(),
      });
    }

    // Update settlement status
    settlement.status = success ? 'confirmed' : 'failed';
    settlement.updatedAt = Date.now();
  }

  /**
   * Get a pending settlement by ID
   */
  getPendingSettlement(paymentId: string): PendingSettlement | undefined {
    return this.pendingSettlements.get(paymentId);
  }

  /**
   * Update a pending settlement
   */
  updatePendingSettlement(paymentId: string, updates: Partial<PendingSettlement>): void {
    const settlement = this.pendingSettlements.get(paymentId);
    if (settlement) {
      Object.assign(settlement, updates, { updatedAt: Date.now() });
    }
  }

  /**
   * Get all pending settlements
   */
  getAllPendingSettlements(): PendingSettlement[] {
    return Array.from(this.pendingSettlements.values())
      .filter(s => s.status === 'pending' || s.status === 'submitted' || s.status === 'retry');
  }

  /**
   * Get risk limits for display
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Get stats for health check
   */
  getStats(): {
    totalPendingSettlements: number;
    totalPendingAmount: bigint;
    walletsWithPending: number;
  } {
    let totalPendingAmount = 0n;
    for (const amount of this.pendingByWallet.values()) {
      totalPendingAmount += amount;
    }

    return {
      totalPendingSettlements: this.getAllPendingSettlements().length,
      totalPendingAmount,
      walletsWithPending: this.pendingByWallet.size,
    };
  }
}
