import { ethers } from 'ethers';
import type { Config } from '../types/config.js';
import type { Voucher, EscrowAccount, StoredVoucher, DeferredConfig } from '../types/deferred.js';

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

  // In-memory voucher store (voucherId -> latest voucher)
  private voucherStore: Map<string, StoredVoucher> = new Map();

  constructor(
    config: Config,
    deferredConfig: DeferredConfig,
    provider: ethers.JsonRpcProvider
  ) {
    this.deferredConfig = deferredConfig;

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
  storeVoucher(voucher: Voucher): StoredVoucher {
    const key = `${voucher.id}:${voucher.buyer}:${voucher.seller}`;

    // Check if we already have a voucher with higher or equal nonce
    const existing = this.voucherStore.get(key);
    if (existing && existing.voucher.nonce >= voucher.nonce) {
      throw new Error(`Stale voucher: existing nonce ${existing.voucher.nonce} >= ${voucher.nonce}`);
    }

    const stored: StoredVoucher = {
      voucher,
      storedAt: Date.now(),
      settled: false,
    };

    this.voucherStore.set(key, stored);
    return stored;
  }

  /**
   * Get the latest stored voucher for a buyer/seller pair.
   */
  getLatestVoucher(voucherId: string, buyer: string, seller: string): StoredVoucher | undefined {
    const key = `${voucherId}:${buyer}:${seller}`;
    return this.voucherStore.get(key);
  }

  /**
   * Get all stored vouchers for a buyer.
   */
  getVouchersForBuyer(buyer: string): StoredVoucher[] {
    const results: StoredVoucher[] = [];
    for (const stored of this.voucherStore.values()) {
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
    const key = `${voucherId}:${buyer}:${seller}`;
    const stored = this.voucherStore.get(key);
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

    stored.settled = true;
    stored.settledTxHash = receipt.hash;

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
