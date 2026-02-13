import { describe, it, expect, beforeEach } from 'vitest';
import { RiskService } from '../services/risk.js';
import { defaultConfig } from '../types/config.js';
import {
  TEST_TOKEN,
  TEST_CHAIN_ID,
  createTestPayment,
  createOverLimitPayment,
  createTestRequirements,
} from './helpers.js';

describe('RiskService', () => {
  let riskService: RiskService;
  const config = {
    ...defaultConfig,
    token: { address: TEST_TOKEN, decimals: 6, name: 'USD Coin' },
    chain: { id: TEST_CHAIN_ID, name: 'calibration' },
    risk: {
      maxPerTransaction: 100, // $100
      maxPendingPerWallet: 50, // $50
      dailyLimitPerWallet: 500, // $500
    },
  };

  beforeEach(() => {
    riskService = new RiskService(config);
  });

  describe('checkPayment', () => {
    it('should allow payment within all limits', async () => {
      const payment = await createTestPayment({ value: '1000000' }); // $1
      const result = await riskService.checkPayment(payment);

      expect(result.allowed).toBe(true);
      expect(result.riskScore).toBe(0);
    });

    it('should reject payment exceeding per-transaction limit', async () => {
      const payment = await createOverLimitPayment(); // $200
      const result = await riskService.checkPayment(payment);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('max per transaction');
    });

    it('should reject payment exceeding pending limit', async () => {
      // First, reserve some credit
      const payment1 = await createTestPayment({ value: '40000000' }); // $40
      await riskService.reserveCredit('payment1', payment1, createTestRequirements());

      // Try to add more that would exceed $50 pending
      const payment2 = await createTestPayment({ value: '20000000' }); // $20
      const result = await riskService.checkPayment(payment2);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('max pending');
    });

    it('should reject payment exceeding daily limit', async () => {
      // Simulate completed payments: 5 x $100 = $500 (hits daily limit exactly)
      for (let i = 0; i < 5; i++) {
        const payment = await createTestPayment({ value: '100000000' }); // $100 (max per tx)
        await riskService.reserveCredit(`payment${i}`, payment, createTestRequirements());
        await riskService.releaseCredit(`payment${i}`, true); // Mark as successful
      }

      // Try $10 payment - within pending limit ($50) but exceeds daily ($500)
      const newPayment = await createTestPayment({ value: '10000000' }); // $10
      const result = await riskService.checkPayment(newPayment);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('tier limit');
    });
  });

  describe('reserveCredit / releaseCredit', () => {
    it('should track pending amount after reserve', async () => {
      const payment = await createTestPayment({ value: '10000000' }); // $10
      await riskService.reserveCredit('payment1', payment, createTestRequirements());

      const pending = await riskService.getPendingAmount(payment.from);
      expect(pending).toBe(10000000n);
    });

    it('should clear pending and add to daily on successful release', async () => {
      const payment = await createTestPayment({ value: '10000000' }); // $10
      await riskService.reserveCredit('payment1', payment, createTestRequirements());
      await riskService.releaseCredit('payment1', true);

      const pending = await riskService.getPendingAmount(payment.from);
      const daily = await riskService.getDailyUsage(payment.from);

      expect(pending).toBe(0n);
      expect(daily).toBe(10000000n);
    });

    it('should clear pending without adding to daily on failed release', async () => {
      const payment = await createTestPayment({ value: '10000000' }); // $10
      await riskService.reserveCredit('payment1', payment, createTestRequirements());
      await riskService.releaseCredit('payment1', false);

      const pending = await riskService.getPendingAmount(payment.from);
      const daily = await riskService.getDailyUsage(payment.from);

      expect(pending).toBe(0n);
      expect(daily).toBe(0n);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      const payment1 = await createTestPayment({ value: '10000000' });
      const payment2 = await createTestPayment({ value: '20000000' });

      await riskService.reserveCredit('p1', payment1, createTestRequirements());
      await riskService.reserveCredit('p2', payment2, createTestRequirements());

      const stats = await riskService.getStats();

      expect(stats.totalPendingSettlements).toBe(2);
      expect(stats.totalPendingAmount).toBe(30000000n);
      expect(stats.walletsWithPending).toBe(1); // Same wallet
    });
  });
});
