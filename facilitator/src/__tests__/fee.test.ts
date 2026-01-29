import { describe, it, expect } from 'vitest';
import { FeeService } from '../services/fee.js';

describe('FeeService', () => {
  describe('18 decimals (USDFC on Calibration)', () => {
    const fee = new FeeService(18);

    it('should calculate FCR model fees correctly', () => {
      // $100 payment (100e18)
      const amount = 100n * 10n ** 18n;
      const breakdown = fee.getFeeBreakdown(amount, 'fcr');

      // Base: $0.01 = 1e16
      expect(breakdown.baseFee).toBe(10000000000000000n);
      // Risk: 1% of 100e18 = 1e18
      expect(breakdown.riskFee).toBe(1000000000000000000n);
      // Provider: 0.1% of 100e18 = 1e17
      expect(breakdown.providerFee).toBe(100000000000000000n);
      // Total: 0.01 + 1 + 0.1 = $1.11
      expect(breakdown.totalFee).toBe(1110000000000000000n);
    });

    it('should not charge risk fee for deferred model', () => {
      const amount = 100n * 10n ** 18n;
      const breakdown = fee.getFeeBreakdown(amount, 'deferred');

      expect(breakdown.riskFee).toBe(0n);
      // Total: base + provider = $0.01 + $0.10 = $0.11
      expect(breakdown.totalFee).toBe(110000000000000000n);
    });

    it('should handle small amounts', () => {
      // $0.01 payment
      const amount = 10n ** 16n;
      const breakdown = fee.getFeeBreakdown(amount, 'fcr');

      expect(breakdown.baseFee).toBe(10000000000000000n); // $0.01
      expect(breakdown.riskFee).toBe(100000000000000n);   // 1% of $0.01
      expect(breakdown.providerFee).toBe(10000000000000n); // 0.1% of $0.01
    });

    it('should return total via calculateFee', () => {
      const amount = 50n * 10n ** 18n;
      const total = fee.calculateFee(amount, 'fcr');
      const breakdown = fee.getFeeBreakdown(amount, 'fcr');
      expect(total).toBe(breakdown.totalFee);
    });
  });

  describe('6 decimals', () => {
    const fee = new FeeService(6);

    it('should calculate fees for 6-decimal token', () => {
      // $100 = 100_000_000 (1e8)
      const amount = 100_000_000n;
      const breakdown = fee.getFeeBreakdown(amount, 'fcr');

      // Base: $0.01 = 10_000
      expect(breakdown.baseFee).toBe(10000n);
      // Risk: 1% = 1_000_000
      expect(breakdown.riskFee).toBe(1000000n);
      // Provider: 0.1% = 100_000
      expect(breakdown.providerFee).toBe(100000n);
    });
  });
});
