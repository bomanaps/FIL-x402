import { ethers } from 'ethers';
import type { Config } from '../types/config.js';
import type { BondConfig, BondStatus } from '../types/bond.js';

const BONDED_FACILITATOR_ABI = [
  'function depositBond(uint256 amount) external',
  'function withdrawBond(uint256 amount) external',
  'function commitPayment(bytes32 paymentId, address provider, uint256 amount) external',
  'function releasePayment(bytes32 paymentId) external',
  'function claimPayment(bytes32 paymentId) external',
  'function getExposure(address facilitator) view returns (uint256)',
  'function getAvailableBond(address facilitator) view returns (uint256)',
  'function bondBalance(address) view returns (uint256)',
  'function totalCommitted(address) view returns (uint256)',
];

export class BondService {
  private contract: ethers.Contract;
  private signer: ethers.Wallet;
  private bondConfig: BondConfig;
  private facilitatorAddress: string;

  constructor(
    config: Config,
    bondConfig: BondConfig,
    provider: ethers.JsonRpcProvider
  ) {
    this.bondConfig = bondConfig;

    if (!bondConfig.contractAddress) {
      throw new Error('Bond contract address not configured');
    }

    if (!config.facilitator.privateKey) {
      throw new Error('Facilitator private key not configured');
    }

    this.signer = new ethers.Wallet(config.facilitator.privateKey, provider);
    this.facilitatorAddress = this.signer.address;

    this.contract = new ethers.Contract(
      bondConfig.contractAddress,
      BONDED_FACILITATOR_ABI,
      this.signer
    );
  }

  /**
   * Commit bond for a payment. Called before submitting the on-chain transfer.
   */
  async commitPayment(
    paymentId: string,
    provider: string,
    amount: bigint
  ): Promise<string> {
    const paymentIdBytes = ethers.id(paymentId);
    const tx = await this.contract.commitPayment(paymentIdBytes, provider, amount);
    return tx.hash;
  }

  /**
   * Release bond after successful settlement.
   */
  async releasePayment(paymentId: string): Promise<string> {
    const paymentIdBytes = ethers.id(paymentId);
    const tx = await this.contract.releasePayment(paymentIdBytes);
    return tx.hash;
  }

  /**
   * Get current bond exposure.
   */
  async getExposure(): Promise<bigint> {
    return this.contract.getExposure(this.facilitatorAddress);
  }

  /**
   * Get available (uncommitted) bond.
   */
  async getAvailableBond(): Promise<bigint> {
    return this.contract.getAvailableBond(this.facilitatorAddress);
  }

  /**
   * Get full bond status including utilization percentage.
   */
  async getBondStatus(): Promise<BondStatus> {
    const [totalBond, totalCommitted] = await Promise.all([
      this.contract.bondBalance(this.facilitatorAddress) as Promise<bigint>,
      this.contract.totalCommitted(this.facilitatorAddress) as Promise<bigint>,
    ]);

    const available = totalBond - totalCommitted;
    const utilizationPercent =
      totalBond > 0n
        ? Number((totalCommitted * 100n) / totalBond)
        : 0;

    if (utilizationPercent >= this.bondConfig.alertThresholdPercent) {
      console.warn(
        `Bond utilization alert: ${utilizationPercent}% (threshold: ${this.bondConfig.alertThresholdPercent}%)`
      );
    }

    return { totalBond, totalCommitted, available, utilizationPercent };
  }

  /**
   * Check if there is enough available bond for a given amount.
   */
  async hasCapacity(amount: bigint): Promise<boolean> {
    const available = await this.getAvailableBond();
    return available >= amount;
  }
}
