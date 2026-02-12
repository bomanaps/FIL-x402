import Redis from 'ioredis';
import type { Config } from '../types/config.js';

/**
 * Redis key generators
 */
export const REDIS_KEYS = {
  pendingByWallet: (wallet: string) => `pending:${wallet.toLowerCase()}`,
  dailyUsage: (wallet: string, date: string) => `daily:${wallet.toLowerCase()}:${date}`,
  walletTier: (wallet: string) => `tier:${wallet.toLowerCase()}`,
  walletFirstSeen: (wallet: string) => `firstseen:${wallet.toLowerCase()}`,
  pendingSettlement: (paymentId: string) => `settlement:${paymentId}`,
  allPendingSettlements: 'settlements:pending',
  voucher: (voucherId: string, buyer: string, seller: string) =>
    `voucher:${voucherId}:${buyer.toLowerCase()}:${seller.toLowerCase()}`,
  vouchersByBuyer: (buyer: string) => `vouchers:buyer:${buyer.toLowerCase()}`,
  lock: (resource: string) => `lock:${resource}`,
} as const;

/**
 * Redis service for persistent storage
 */
export class RedisService {
  private client: Redis | null = null;
  private config: Config;
  private connected = false;

  constructor(config: Config) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (!this.config.redis.enabled) {
      console.log('Redis disabled, using in-memory storage');
      return;
    }

    this.client = new Redis({
      host: this.config.redis.host,
      port: this.config.redis.port,
      password: this.config.redis.password,
      db: this.config.redis.db,
      keyPrefix: this.config.redis.keyPrefix,
      retryStrategy: (times) => {
        if (times > this.config.redis.maxRetries) {
          console.error(`Redis connection failed after ${times} attempts`);
          return null;
        }
        return Math.min(times * this.config.redis.retryDelayMs, 5000);
      },
      lazyConnect: true,
    });

    this.client.on('connect', () => {
      this.connected = true;
      console.log('Redis connected');
    });

    this.client.on('error', (err) => {
      console.error('Redis error:', err.message);
      this.connected = false;
    });

    this.client.on('close', () => {
      this.connected = false;
    });

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  isAvailable(): boolean {
    return this.config.redis.enabled && this.connected && this.client !== null;
  }

  // Core operations
  async get(key: string): Promise<string | null> {
    return this.client?.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client?.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client?.exists(key)) === 1;
  }

  async incrBy(key: string, amount: bigint): Promise<bigint> {
    const result = await this.client?.incrby(key, Number(amount));
    return BigInt(result ?? 0);
  }

  async decrBy(key: string, amount: bigint): Promise<bigint> {
    const result = await this.client?.decrby(key, Number(amount));
    return BigInt(Math.max(result ?? 0, 0));
  }

  async getBigInt(key: string): Promise<bigint> {
    const value = await this.get(key);
    return value ? BigInt(value) : 0n;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.client?.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    await this.client?.srem(key, ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return (await this.client?.smembers(key)) ?? [];
  }

  // Batch get for avoiding N+1
  async mgetJson<T>(keys: string[]): Promise<(T | null)[]> {
    if (!this.client || keys.length === 0) return [];
    const values = await this.client.mget(...keys);
    return values.map(v => {
      if (!v) return null;
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    });
  }

  // Distributed lock
  async withLock<T>(resource: string, fn: () => Promise<T>, ttlMs = 30000): Promise<T> {
    if (!this.client) return fn(); // No lock needed if no Redis

    const lockKey = REDIS_KEYS.lock(resource);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    const acquired = await this.client.set(lockKey, token, 'EX', ttlSeconds, 'NX');
    if (acquired !== 'OK') {
      throw new Error(`Failed to acquire lock: ${resource}`);
    }

    try {
      return await fn();
    } finally {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.client.eval(script, 1, lockKey, token);
    }
  }
}
