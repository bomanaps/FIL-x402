import { ethers } from 'ethers';
import type { Config } from '../types/config.js';
import type { Voucher, EscrowAccount, StoredVoucher, DeferredConfig } from '../types/deferred.js';
import { RedisService, REDIS_KEYS } from './redis.js';

const VOUCHER_TTL = 7 * 24 * 60 * 60; // 7 days

const ESCROW_ABI = [
  'function deposit(uint256 amount) external',
  'function thaw(uint256 amount) external',
  'function withdraw() external',
  'function collect((bytes32 id, address buyer, address seller, uint256 valueAggregate, address asset, uint64 timestamp, uint256 nonce, address escrow, uint256 chainId) voucher, bytes signature) external',
  'function collectMany((bytes32 id, address buyer, address seller, uint256 valueAggregate, address asset, uint64 timestamp, uint256 nonce, address escrow, uint256 chainId)[] vouchers, bytes[] signatures) external',
  'function getAccount(address buyer) view returns (uint256 balance, uint256 thawingAmount, uint64 thawEndTime)',
  'function settledNonce(bytes32) view returns (uint256)',
  'function collectedValue(bytes32) view returns (uint256)',
];

export class DeferredService {
  private contract: ethers.Contract;
  private readContract: ethers.Contract;
  private deferredConfig: DeferredConfig;
  private redis: RedisService | null;

  // In-memory voucher store (fallback when Redis unavailable)
  private memory = {
    vouchers: new Map<string, StoredVoucher>(),
  };

  constructor(
    config: Config,
    deferredConfig: DeferredConfig,
    provider: ethers.JsonRpcProvider,
    redis?: RedisService
  ) {
    this.deferredConfig = deferredConfig;
    this.redis = redis ?? null;

    if (!deferredConfig.contractAddress) {
      throw new Error('Escrow contract address not configured');
    }

    // Read-only contract for queries
    this.readContract = new ethers.Contract(
      deferredConfig.contractAddress,
      ESCROW_ABI,
      provider
    );

    // Writable contract with signer
    if (config.facilitator.privateKey) {
      const signer = new ethers.Wallet(config.facilitator.privateKey, provider);
      this.contract = new ethers.Contract(
        deferredConfig.contractAddress,
        ESCROW_ABI,
        signer
      );
    } else {
      this.contract = this.readContract;
    }
  }

  private useRedis(): boolean {
    return this.redis?.isAvailable() ?? false;
  }

  private voucherKey(voucherId: string, buyer: string, seller: string): string {
    return `${voucherId}:${buyer.toLowerCase()}:${seller.toLowerCase()}`;
  }

  /**
   * Get escrow account state for a buyer.
   */
  async getAccount(buyer: string): Promise<EscrowAccount> {
    const result = await this.readContract.getAccount(buyer);
    return {
      balance: result[0],
      thawingAmount: result[1],
      thawEndTime: Number(result[2]),
    };
  }

  /**
   * Store a signed voucher. Validates basic fields before storing.
   */
  async storeVoucher(voucher: Voucher): Promise<StoredVoucher> {
    const key = this.voucherKey(voucher.id, voucher.buyer, voucher.seller);

    // Check if we already have a voucher with higher or equal nonce
    const existing = await this.getLatestVoucher(voucher.id, voucher.buyer, voucher.seller);
    if (existing && existing.voucher.nonce >= voucher.nonce) {
      throw new Error(`Stale voucher: existing nonce ${existing.voucher.nonce} >= ${voucher.nonce}`);
    }

    const stored: StoredVoucher = {
      voucher,
      storedAt: Date.now(),
      settled: false,
    };

    if (this.useRedis()) {
      await this.redis!.setJson(
        REDIS_KEYS.voucher(voucher.id, voucher.buyer, voucher.seller),
        stored,
        VOUCHER_TTL
      );
      // Track voucher in buyer's set for getVouchersForBuyer
      await this.redis!.sadd(REDIS_KEYS.vouchersByBuyer(voucher.buyer), key);
    } else {
      this.memory.vouchers.set(key, stored);
    }

    return stored;
  }

  /**
   * Get the latest stored voucher for a buyer/seller pair.
   */
  async getLatestVoucher(voucherId: string, buyer: string, seller: string): Promise<StoredVoucher | undefined> {
    if (this.useRedis()) {
      const stored = await this.redis!.getJson<StoredVoucher>(
        REDIS_KEYS.voucher(voucherId, buyer, seller)
      );
      return stored ?? undefined;
    }

    const key = this.voucherKey(voucherId, buyer, seller);
    return this.memory.vouchers.get(key);
  }

  /**
   * Get all stored vouchers for a buyer.
   */
  async getVouchersForBuyer(buyer: string): Promise<StoredVoucher[]> {
    if (this.useRedis()) {
      const keys = await this.redis!.smembers(REDIS_KEYS.vouchersByBuyer(buyer));
      if (keys.length === 0) return [];

      // Build Redis keys from the stored key format (voucherId:buyer:seller)
      const redisKeys = keys.map(k => {
        const [voucherId, b, seller] = k.split(':');
        return REDIS_KEYS.voucher(voucherId, b, seller);
      });

      const results = await this.redis!.mgetJson<StoredVoucher>(redisKeys);
      return results.filter((v): v is StoredVoucher => v !== null);
    }

    const results: StoredVoucher[] = [];
    for (const stored of this.memory.vouchers.values()) {
      if (stored.voucher.buyer.toLowerCase() === buyer.toLowerCase()) {
        results.push(stored);
      }
    }
    return results;
  }

  /**
   * Settle a single voucher by calling collect() on the escrow contract.
   */
  async settleVoucher(voucherId: string, buyer: string, seller: string): Promise<string> {
    const stored = await this.getLatestVoucher(voucherId, buyer, seller);
    if (!stored) {
      throw new Error('Voucher not found');
    }
    if (stored.settled) {
      throw new Error('Voucher already settled');
    }

    const v = stored.voucher;

    const voucherTuple = {
      id: v.id,
      buyer: v.buyer,
      seller: v.seller,
      valueAggregate: v.valueAggregate,
      asset: v.asset,
      timestamp: v.timestamp,
      nonce: v.nonce,
      escrow: v.escrow,
      chainId: v.chainId,
    };

    const tx = await this.contract.collect(voucherTuple, v.signature);
    const receipt = await tx.wait();

    // Update stored voucher with settlement info
    stored.settled = true;
    stored.settledTxHash = receipt.hash;

    if (this.useRedis()) {
      await this.redis!.setJson(
        REDIS_KEYS.voucher(voucherId, buyer, seller),
        stored,
        VOUCHER_TTL
      );
    } else {
      const key = this.voucherKey(voucherId, buyer, seller);
      this.memory.vouchers.set(key, stored);
    }

    return receipt.hash;
  }

  /**
   * Get on-chain settled nonce for a voucher ID.
   */
  async getSettledNonce(voucherId: string): Promise<bigint> {
    return this.readContract.settledNonce(voucherId);
  }

  /**
   * Get on-chain collected value for a voucher ID.
   */
  async getCollectedValue(voucherId: string): Promise<bigint> {
    return this.readContract.collectedValue(voucherId);
  }
}
