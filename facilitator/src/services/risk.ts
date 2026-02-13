import type { Config } from '../types/config.js';
import type { PaymentPayload, PaymentRequirements, PendingSettlement, RiskLimits } from '../types/payment.js';
import { RedisService, REDIS_KEYS } from './redis.js';

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  riskScore: number;
  currentPending: bigint;
  dailyUsed: bigint;
  walletTier?: WalletTier;
}

export enum WalletTier {
  UNKNOWN = 'UNKNOWN',
  HISTORY_7D = 'HISTORY_7D',
  HISTORY_30D = 'HISTORY_30D',
  VERIFIED = 'VERIFIED',
}

const TIER_LIMITS_USD: Record<WalletTier, number> = {
  [WalletTier.UNKNOWN]: 5,
  [WalletTier.HISTORY_7D]: 50,
  [WalletTier.HISTORY_30D]: 500,
  [WalletTier.VERIFIED]: 5000,
};

const DAILY_USAGE_TTL = 25 * 60 * 60; // 25 hours
const SETTLEMENT_TTL = 24 * 60 * 60;  // 24 hours

interface StoredSettlement {
  paymentId: string;
  payment: Omit<PaymentPayload, 'value'> & { value: string };
  requirements: PaymentRequirements;
  status: string;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  transactionCid?: string;
  error?: string;
  tipsetHeight?: number;
  confirmationLevel?: string;
  f3Instance?: number;
  f3Round?: number;
  f3Phase?: number;
  confirmedAt?: number;
}

export class RiskService {
  private config: Config;
  private limits: RiskLimits;
  private redis: RedisService | null;

  // In-memory storage (used when Redis unavailable)
  private memory = {
    pending: new Map<string, bigint>(),
    daily: new Map<string, { amount: bigint; date: string }>(),
    settlements: new Map<string, PendingSettlement>(),
    tiers: new Map<string, WalletTier>(),
    firstSeen: new Map<string, number>(),
  };

  constructor(config: Config, redis?: RedisService) {
    this.config = config;
    this.redis = redis ?? null;

    const decimals = BigInt(10 ** config.token.decimals);
    this.limits = {
      maxPerTransaction: BigInt(config.risk.maxPerTransaction) * decimals,
      maxPendingPerWallet: BigInt(config.risk.maxPendingPerWallet) * decimals,
      dailyLimitPerWallet: BigInt(config.risk.dailyLimitPerWallet) * decimals,
    };
  }

  private useRedis(): boolean {
    return this.redis?.isAvailable() ?? false;
  }

  private today(): string {
    return new Date().toISOString().split('T')[0];
  }

  private calcTierFromAge(firstSeen: number): WalletTier {
    const days = (Date.now() - firstSeen) / (1000 * 60 * 60 * 24);
    if (days >= 30) return WalletTier.HISTORY_30D;
    if (days >= 7) return WalletTier.HISTORY_7D;
    return WalletTier.UNKNOWN;
  }

  // ─── Core Methods ───────────────────────────────────────────

  async getPendingAmount(wallet: string): Promise<bigint> {
    const key = wallet.toLowerCase();
    if (this.useRedis()) {
      return this.redis!.getBigInt(REDIS_KEYS.pendingByWallet(key));
    }
    return this.memory.pending.get(key) ?? 0n;
  }

  async getDailyUsage(wallet: string): Promise<bigint> {
    const key = wallet.toLowerCase();
    const date = this.today();

    if (this.useRedis()) {
      const data = await this.redis!.getJson<{ amount: string; date: string }>(
        REDIS_KEYS.dailyUsage(key, date)
      );
      return data?.date === date ? BigInt(data.amount) : 0n;
    }

    const usage = this.memory.daily.get(key);
    return usage?.date === date ? usage.amount : 0n;
  }

  async getWalletTier(wallet: string): Promise<WalletTier> {
    const key = wallet.toLowerCase();

    if (this.useRedis()) {
      const manual = await this.redis!.get(REDIS_KEYS.walletTier(key));
      if (manual && Object.values(WalletTier).includes(manual as WalletTier)) {
        return manual as WalletTier;
      }
      const firstSeenStr = await this.redis!.get(REDIS_KEYS.walletFirstSeen(key));
      return firstSeenStr ? this.calcTierFromAge(parseInt(firstSeenStr)) : WalletTier.UNKNOWN;
    }

    const manual = this.memory.tiers.get(key);
    if (manual) return manual;
    const firstSeen = this.memory.firstSeen.get(key);
    return firstSeen ? this.calcTierFromAge(firstSeen) : WalletTier.UNKNOWN;
  }

  async setWalletTier(wallet: string, tier: WalletTier): Promise<void> {
    const key = wallet.toLowerCase();
    if (this.useRedis()) {
      await this.redis!.set(REDIS_KEYS.walletTier(key), tier);
    } else {
      this.memory.tiers.set(key, tier);
    }
  }

  private async trackFirstSeen(wallet: string): Promise<void> {
    const key = wallet.toLowerCase();
    if (this.useRedis()) {
      if (!(await this.redis!.exists(REDIS_KEYS.walletFirstSeen(key)))) {
        await this.redis!.set(REDIS_KEYS.walletFirstSeen(key), Date.now().toString());
      }
    } else if (!this.memory.firstSeen.has(key)) {
      this.memory.firstSeen.set(key, Date.now());
    }
  }

  // ─── Payment Risk Check ─────────────────────────────────────

  async checkPayment(payment: PaymentPayload): Promise<RiskCheckResult> {
    const wallet = payment.from.toLowerCase();
    const amount = BigInt(payment.value);

    await this.trackFirstSeen(wallet);

    const [tier, currentPending, dailyUsed] = await Promise.all([
      this.getWalletTier(wallet),
      this.getPendingAmount(wallet),
      this.getDailyUsage(wallet),
    ]);

    // Check max per transaction
    if (amount > this.limits.maxPerTransaction) {
      return {
        allowed: false,
        reason: `Amount exceeds max per transaction ($${this.config.risk.maxPerTransaction})`,
        riskScore: 80,
        currentPending,
        dailyUsed,
        walletTier: tier,
      };
    }

    // Check pending limit
    if (currentPending + amount > this.limits.maxPendingPerWallet) {
      return {
        allowed: false,
        reason: `Would exceed max pending ($${this.config.risk.maxPendingPerWallet})`,
        riskScore: 70,
        currentPending,
        dailyUsed,
        walletTier: tier,
      };
    }

    // Check daily tier limit
    const tierLimit = BigInt(TIER_LIMITS_USD[tier]) * BigInt(10 ** this.config.token.decimals);
    if (dailyUsed + amount > tierLimit) {
      return {
        allowed: false,
        reason: `Daily usage would exceed tier limit (${tier}: $${TIER_LIMITS_USD[tier]}/day)`,
        riskScore: 60,
        currentPending,
        dailyUsed,
        walletTier: tier,
      };
    }

    return { allowed: true, riskScore: 0, currentPending, dailyUsed, walletTier: tier };
  }

  // ─── Credit Management ──────────────────────────────────────

  async reserveCredit(paymentId: string, payment: PaymentPayload, requirements: PaymentRequirements): Promise<void> {
    const wallet = payment.from.toLowerCase();
    const amount = BigInt(payment.value);

    const settlement: PendingSettlement = {
      paymentId,
      payment,
      requirements,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.config.settlement.maxAttempts,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (this.useRedis()) {
      await this.redis!.withLock(`wallet:${wallet}`, async () => {
        await this.redis!.incrBy(REDIS_KEYS.pendingByWallet(wallet), amount);
        await this.redis!.setJson(REDIS_KEYS.pendingSettlement(paymentId), this.toStored(settlement), SETTLEMENT_TTL);
        await this.redis!.sadd(REDIS_KEYS.allPendingSettlements, paymentId);
      });
    } else {
      this.memory.pending.set(wallet, (this.memory.pending.get(wallet) ?? 0n) + amount);
      this.memory.settlements.set(paymentId, settlement);
    }
  }

  async releaseCredit(paymentId: string, success: boolean): Promise<void> {
    const settlement = await this.getPendingSettlement(paymentId);
    if (!settlement) return;

    const wallet = settlement.payment.from.toLowerCase();
    const amount = BigInt(settlement.payment.value);
    const date = this.today();

    if (this.useRedis()) {
      await this.redis!.withLock(`wallet:${wallet}`, async () => {
        await this.redis!.decrBy(REDIS_KEYS.pendingByWallet(wallet), amount);

        if (success) {
          const usageKey = REDIS_KEYS.dailyUsage(wallet, date);
          const existing = await this.redis!.getJson<{ amount: string; date: string }>(usageKey);
          const current = existing ? BigInt(existing.amount) : 0n;
          await this.redis!.setJson(usageKey, { amount: (current + amount).toString(), date }, DAILY_USAGE_TTL);
        }

        settlement.status = success ? 'confirmed' : 'failed';
        settlement.updatedAt = Date.now();
        await this.redis!.setJson(REDIS_KEYS.pendingSettlement(paymentId), this.toStored(settlement), SETTLEMENT_TTL);
        await this.redis!.srem(REDIS_KEYS.allPendingSettlements, paymentId);
      });
    } else {
      const current = this.memory.pending.get(wallet) ?? 0n;
      this.memory.pending.set(wallet, current > amount ? current - amount : 0n);

      if (success) {
        const usage = this.memory.daily.get(wallet);
        const currentDaily = usage?.date === date ? usage.amount : 0n;
        this.memory.daily.set(wallet, { amount: currentDaily + amount, date });
      }

      settlement.status = success ? 'confirmed' : 'failed';
      settlement.updatedAt = Date.now();
    }
  }

  // ─── Settlement Access ──────────────────────────────────────

  async getPendingSettlement(paymentId: string): Promise<PendingSettlement | undefined> {
    if (this.useRedis()) {
      const data = await this.redis!.getJson<StoredSettlement>(REDIS_KEYS.pendingSettlement(paymentId));
      return data ? this.fromStored(data) : undefined;
    }
    return this.memory.settlements.get(paymentId);
  }

  async updatePendingSettlement(paymentId: string, updates: Partial<PendingSettlement>): Promise<void> {
    const settlement = await this.getPendingSettlement(paymentId);
    if (!settlement) return;

    Object.assign(settlement, updates, { updatedAt: Date.now() });

    if (this.useRedis()) {
      await this.redis!.setJson(REDIS_KEYS.pendingSettlement(paymentId), this.toStored(settlement), SETTLEMENT_TTL);
    } else {
      this.memory.settlements.set(paymentId, settlement);
    }
  }

  async getAllPendingSettlements(): Promise<PendingSettlement[]> {
    if (this.useRedis()) {
      const ids = await this.redis!.smembers(REDIS_KEYS.allPendingSettlements);
      if (ids.length === 0) return [];

      const keys = ids.map(id => REDIS_KEYS.pendingSettlement(id));
      const results = await this.redis!.mgetJson<StoredSettlement>(keys);

      return results
        .filter((d): d is StoredSettlement => d !== null)
        .map(d => this.fromStored(d))
        .filter(s => ['pending', 'submitted', 'retry'].includes(s.status));
    }

    return Array.from(this.memory.settlements.values())
      .filter(s => ['pending', 'submitted', 'retry'].includes(s.status));
  }

  async getSettlementsNeedingFCR(): Promise<PendingSettlement[]> {
    const all = await this.getAllPendingSettlements();
    return all.filter(s => s.confirmationLevel !== 'L3' && s.tipsetHeight !== undefined);
  }

  // ─── Utilities ──────────────────────────────────────────────

  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  async getStats(): Promise<{
    totalPendingSettlements: number;
    totalPendingAmount: bigint;
    walletsWithPending: number;
    redisEnabled: boolean;
  }> {
    const settlements = await this.getAllPendingSettlements();

    let totalPendingAmount = 0n;
    let walletsWithPending = 0;

    // Count from settlements directly (simpler, no scan needed)
    const walletAmounts = new Map<string, bigint>();
    for (const s of settlements) {
      const wallet = s.payment.from.toLowerCase();
      const amount = BigInt(s.payment.value);
      walletAmounts.set(wallet, (walletAmounts.get(wallet) ?? 0n) + amount);
    }

    for (const amount of walletAmounts.values()) {
      totalPendingAmount += amount;
      if (amount > 0n) walletsWithPending++;
    }

    return {
      totalPendingSettlements: settlements.length,
      totalPendingAmount,
      walletsWithPending,
      redisEnabled: this.useRedis(),
    };
  }

  async loadFromRedis(): Promise<void> {
    if (!this.useRedis()) return;
    console.log('Redis persistence enabled');
  }

  // ─── Serialization ──────────────────────────────────────────

  private toStored(s: PendingSettlement): StoredSettlement {
    return { ...s, payment: { ...s.payment, value: s.payment.value.toString() } };
  }

  private fromStored(d: StoredSettlement): PendingSettlement {
    return { ...d, payment: { ...d.payment, value: d.payment.value } } as PendingSettlement;
  }
}
