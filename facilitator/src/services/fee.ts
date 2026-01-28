/**
 * Fee calculation for x402 payments.
 *
 * Fee structure:
 *   Base fee:     $0.01 (flat per transaction)
 *   Risk fee:     1% of amount (FCR/bond model only)
 *   Provider fee: 0.1% of amount
 */

export type PaymentModel = 'fcr' | 'deferred';

export interface FeeBreakdown {
  baseFee: bigint;
  riskFee: bigint;
  providerFee: bigint;
  totalFee: bigint;
}

export class FeeService {
  private readonly decimals: number;

  // Fee parameters (in basis points: 1 bp = 0.01%)
  private readonly BASE_FEE_USD = 0.01;
  private readonly RISK_FEE_BPS = 100;     // 1% = 100 basis points
  private readonly PROVIDER_FEE_BPS = 10;  // 0.1% = 10 basis points

  constructor(decimals: number) {
    this.decimals = decimals;
  }

  /**
   * Calculate total fee for a payment amount.
   */
  calculateFee(amount: bigint, model: PaymentModel): bigint {
    const breakdown = this.getFeeBreakdown(amount, model);
    return breakdown.totalFee;
  }

  /**
   * Get detailed fee breakdown.
   */
  getFeeBreakdown(amount: bigint, model: PaymentModel): FeeBreakdown {
    // Base fee: $0.01 in token units
    const baseFee = this.usdToTokenUnits(this.BASE_FEE_USD);

    // Risk fee: 1% of amount (only for FCR/bond model, not deferred)
    const riskFee = model === 'fcr'
      ? (amount * BigInt(this.RISK_FEE_BPS)) / 10000n
      : 0n;

    // Provider fee: 0.1% of amount
    const providerFee = (amount * BigInt(this.PROVIDER_FEE_BPS)) / 10000n;

    return {
      baseFee,
      riskFee,
      providerFee,
      totalFee: baseFee + riskFee + providerFee,
    };
  }

  /**
   * Convert a USD amount to token units.
   */
  private usdToTokenUnits(usd: number): bigint {
    // For 18-decimal token: $0.01 = 10000000000000000 (1e16)
    // For 6-decimal token: $0.01 = 10000 (1e4)
    const factor = 10 ** this.decimals;
    return BigInt(Math.round(usd * factor));
  }
}
