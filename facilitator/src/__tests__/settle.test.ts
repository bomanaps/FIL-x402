import { describe, it, expect, beforeEach } from 'vitest';
import {
  LotusService,
  SignatureService,
  RiskService,
  VerifyService,
  SettleService,
} from '../services/index.js';
import { type Config, defaultConfig } from '../types/config.js';
import {
  TEST_TOKEN,
  TEST_CHAIN_ID,
  createTestPayment,
  createTestRequirements,
} from './helpers.js';

// ─── Mock Lotus ──────────────────────────────────────────────────────────────

class MockLotusService extends LotusService {
  private balances: Map<string, bigint> = new Map();
  submitShouldThrow = false;

  constructor(config: Config) {
    super(config);
  }

  setBalance(address: string, balance: bigint): void {
    this.balances.set(address.toLowerCase(), balance);
  }

  async getBalance(address: string): Promise<bigint> {
    return this.balances.get(address.toLowerCase()) ?? 0n;
  }

  async isNonceUsed(): Promise<boolean> {
    return false;
  }

  // 0.2 FIL — above the 0.1 FIL minimum required by settle.ts
  async getNativeBalance(): Promise<bigint> {
    return BigInt('200000000000000000');
  }

  async submitTransferWithAuthorization(): Promise<string> {
    if (this.submitShouldThrow) {
      throw new Error('rpc: connection refused');
    }
    return '0x' + 'abc123'.repeat(10);
  }

  async getBlockNumber(): Promise<number> {
    return 1000;
  }

  async waitForTransaction(): Promise<{ status: number }> {
    return { status: 1 };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

// ─── Mock Bond ───────────────────────────────────────────────────────────────

class MockBondService {
  commitPaymentCalled = false;
  releasePaymentCalled = false;
  releasedPaymentId: string | null = null;

  async hasCapacity(_amount: bigint): Promise<boolean> {
    return true;
  }

  async commitPayment(paymentId: string, _provider: string, _amount: bigint): Promise<string> {
    this.commitPaymentCalled = true;
    return '0xtxhash_commit';
  }

  async releasePayment(paymentId: string): Promise<string> {
    this.releasePaymentCalled = true;
    this.releasedPaymentId = paymentId;
    return '0xtxhash_release';
  }
}

// ─── Shared Setup ────────────────────────────────────────────────────────────

const BASE_CONFIG: Config = {
  ...defaultConfig,
  token: { address: TEST_TOKEN, decimals: 6, name: 'USD Coin' },
  chain: { id: TEST_CHAIN_ID, name: 'calibration' },
  risk: {
    maxPerTransaction: 100,
    maxPendingPerWallet: 50,
    dailyLimitPerWallet: 500,
  },
  facilitator: {
    privateKey: '0x' + '1'.repeat(64),
    address: '0x' + '3'.repeat(40),
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SettleService', () => {
  let mockLotus: MockLotusService;
  let signatureService: SignatureService;
  let riskService: RiskService;
  let verifyService: VerifyService;

  beforeEach(() => {
    mockLotus = new MockLotusService(BASE_CONFIG);
    signatureService = new SignatureService(BASE_CONFIG);
    riskService = new RiskService(BASE_CONFIG);
    verifyService = new VerifyService(BASE_CONFIG, mockLotus, signatureService, riskService);
  });

  // ── Test 1: Concurrent double-submit ─────────────────────────────────────

  describe('concurrent double-submit with same payment', () => {
    it('should allow exactly one submission and reject the other', async () => {
      const settleService = new SettleService(
        BASE_CONFIG,
        mockLotus,
        signatureService,
        riskService,
        verifyService
      );

      const payment = await createTestPayment();
      const requirements = createTestRequirements();
      mockLotus.setBalance(payment.from, 10_000_000n);

      // Fire both requests at the same time — only one nonce lock can be acquired
      const [result1, result2] = await Promise.all([
        settleService.settle(payment, requirements),
        settleService.settle(payment, requirements),
      ]);

      const successes = [result1, result2].filter(r => r.success);
      const failures  = [result1, result2].filter(r => !r.success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      // Either the nonce lock or the duplicate-payment check fires
      expect(failures[0].error).toMatch(
        /payment_already_submitted|payment_submission_in_progress/
      );
    });
  });

  // ── Test 2: Bond rollback on chain submission failure ────────────────────

  describe('bond rollback when on-chain submission fails', () => {
    it('should call releasePayment after commitPayment succeeds but submission throws', async () => {
      const mockBond = new MockBondService();

      const settleService = new SettleService(
        BASE_CONFIG,
        mockLotus,
        signatureService,
        riskService,
        verifyService,
        undefined,                    // no F3 service
        mockBond as unknown as any    // bond service
      );

      // Bond commit succeeds, but the on-chain transfer will fail
      mockLotus.submitShouldThrow = true;

      const payment = await createTestPayment();
      const requirements = createTestRequirements();
      mockLotus.setBalance(payment.from, 10_000_000n);

      const result = await settleService.settle(payment, requirements);

      // Settlement must have failed
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/submission_failed/);

      // Bond was committed then rolled back
      expect(mockBond.commitPaymentCalled).toBe(true);
      expect(mockBond.releasePaymentCalled).toBe(true);

      // The correct payment ID was released
      expect(mockBond.releasedPaymentId).toBe(result.paymentId);
    });
  });

  // ── Test 4: Max retry exhaustion releases credit ─────────────────────────

  describe('max retry exhaustion releases wallet credit', () => {
    it('should release pending credit after all retry attempts are exhausted', async () => {
      // Set maxAttempts to 1 so the first failed submission immediately exhausts retries
      const testConfig: Config = {
        ...BASE_CONFIG,
        settlement: {
          ...defaultConfig.settlement,
          maxAttempts: 1,
        },
      };

      mockLotus.submitShouldThrow = true;

      const testRisk    = new RiskService(testConfig);
      const testVerify  = new VerifyService(testConfig, mockLotus, signatureService, testRisk);
      const settleService = new SettleService(
        testConfig,
        mockLotus,
        signatureService,
        testRisk,
        testVerify
      );

      const payment      = await createTestPayment();
      const requirements = createTestRequirements();
      mockLotus.setBalance(payment.from, 10_000_000n);

      // First (and only) attempt — submission fails → status becomes 'retry', attempts = 1
      const result = await settleService.settle(payment, requirements);
      expect(result.success).toBe(false);

      // Credit is reserved at this point
      const pendingBefore = await testRisk.getPendingAmount(payment.from);
      expect(pendingBefore).toBe(BigInt(payment.value));

      // Trigger the settlement worker cycle — maxAttempts (1) is already hit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (settleService as any).processSettlements();

      // Pending credit must be released — wallet can make new payments again
      const pendingAfter = await testRisk.getPendingAmount(payment.from);
      expect(pendingAfter).toBe(0n);
    });
  });
});
