import type { Config } from '../types/config.js';
import type { PaymentPayload, PaymentRequirements, PendingSettlement, RiskLimits } from '../types/payment.js';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  riskScore: number;
  currentPending: bigint;
  dailyUsed: bigint;
  walletTier?: WalletTier;
}

/**
 * Wallet risk tiers — daily limits increase with history.
 */
export enum WalletTier {
  UNKNOWN = 'UNKNOWN',         // No history: $5/day
  HISTORY_7D = 'HISTORY_7D',   // 7+ days of activity: $50/day
  HISTORY_30D = 'HISTORY_30D', // 30+ days of activity: $500/day
  VERIFIED = 'VERIFIED',       // Manually verified: $5,000/day
}

const TIER_DAILY_LIMITS_USD: Record<WalletTier, number> = {
  [WalletTier.UNKNOWN]: 5,
  [WalletTier.HISTORY_7D]: 50,
  [WalletTier.HISTORY_30D]: 500,
  [WalletTier.VERIFIED]: 5000,
};

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

  // Wallet tier tracking
  private walletTiers: Map<string, WalletTier> = new Map();
  private walletFirstSeen: Map<string, number> = new Map();

  constructor(config: Config) {
    this.config = config;

    // Convert USD limits to token units
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
   * Get the risk tier for a wallet, auto-upgrading based on history.
   */
  getWalletTier(wallet: string): WalletTier {
    const key = wallet.toLowerCase();

    // Check for manual override
    const manual = this.walletTiers.get(key);
    if (manual) return manual;

    // Auto-tier based on first-seen timestamp
    const firstSeen = this.walletFirstSeen.get(key);
    if (!firstSeen) return WalletTier.UNKNOWN;

    const ageMs = Date.now() - firstSeen;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays >= 30) return WalletTier.HISTORY_30D;
    if (ageDays >= 7) return WalletTier.HISTORY_7D;
    return WalletTier.UNKNOWN;
  }

  /**
   * Manually set a wallet's tier (e.g., for verified wallets).
   */
  setWalletTier(wallet: string, tier: WalletTier): void {
    this.walletTiers.set(wallet.toLowerCase(), tier);
  }

  /**
   * Get the daily limit for a wallet based on its tier (in token units).
   */
  private getDailyLimitForWallet(wallet: string): bigint {
    const tier = this.getWalletTier(wallet);
    const limitUsd = TIER_DAILY_LIMITS_USD[tier];
    const decimals = BigInt(10 ** this.config.token.decimals);
    return BigInt(limitUsd) * decimals;
  }

  /**
   * Track first-seen timestamp for a wallet.
   */
  private trackWalletFirstSeen(wallet: string): void {
    const key = wallet.toLowerCase();
    if (!this.walletFirstSeen.has(key)) {
      this.walletFirstSeen.set(key, Date.now());
    }
  }

  /**
   * Check if a payment passes risk limits
   */
  checkPayment(payment: PaymentPayload): RiskCheckResult {
    const wallet = payment.from.toLowerCase();
    const amount = BigInt(payment.value);
    const tier = this.getWalletTier(wallet);

    // Track first seen
    this.trackWalletFirstSeen(wallet);

    // 1. Check max per transaction
    if (amount > this.limits.maxPerTransaction) {
      return {
        allowed: false,
        reason: `Amount ${amount} exceeds max per transaction ${this.limits.maxPerTransaction}`,
        riskScore: 80,
        currentPending: this.getPendingAmount(wallet),
        dailyUsed: this.getDailyUsage(wallet),
        walletTier: tier,
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
        walletTier: tier,
      };
    }

    // 3. Check tier-based daily limit
    const dailyUsed = this.getDailyUsage(wallet);
    const dailyLimit = this.getDailyLimitForWallet(wallet);
    if (dailyUsed + amount > dailyLimit) {
      return {
        allowed: false,
        reason: `Daily usage would exceed tier limit (${tier}: $${TIER_DAILY_LIMITS_USD[tier]}/day)`,
        riskScore: 60,
        currentPending,
        dailyUsed,
        walletTier: tier,
      };
    }

    // All checks passed
    return {
      allowed: true,
      riskScore: 0,
      currentPending,
      dailyUsed,
      walletTier: tier,
    };
  }

  /**
   * Reserve credit for a pending payment
   * Called when a payment is verified and will be settled
   */
  reserveCredit(paymentId: string, payment: PaymentPayload, requirements: PaymentRequirements): void {
    const wallet = payment.from.toLowerCase();
    const amount = BigInt(payment.value);

    // Add to pending
    const currentPending = this.getPendingAmount(wallet);
    this.pendingByWallet.set(wallet, currentPending + amount);

    // Store pending settlement
    this.pendingSettlements.set(paymentId, {
      paymentId,
      payment,
      requirements,
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
