import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { type Config, defaultConfig } from '../types/config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyJson = any;
import {
  LotusService,
  SignatureService,
  RiskService,
  VerifyService,
  SettleService,
} from '../services/index.js';
import {
  createVerifyRoute,
  createSettleRoute,
  createHealthRoute,
} from '../routes/index.js';
import {
  TEST_TOKEN,
  TEST_CHAIN_ID,
  TEST_PROVIDER,
  createTestPayment,
  createTestRequirements,
  createExpiredPayment,
  createOverLimitPayment,
  createInvalidSignaturePayment,
} from './helpers.js';

// Mock Lotus service for testing without real node
class MockLotusService extends LotusService {
  private balances: Map<string, bigint> = new Map();
  private usedNonces: Set<string> = new Set();

  constructor(config: Config) {
    super(config);
  }

  setBalance(address: string, balance: bigint): void {
    this.balances.set(address.toLowerCase(), balance);
  }

  setNonceUsed(authorizer: string, nonce: string): void {
    this.usedNonces.add(`${authorizer.toLowerCase()}:${nonce}`);
  }

  async getBalance(address: string): Promise<bigint> {
    return this.balances.get(address.toLowerCase()) || 0n;
  }

  async isNonceUsed(authorizer: string, nonce: string): Promise<boolean> {
    return this.usedNonces.has(`${authorizer.toLowerCase()}:${nonce}`);
  }

  async submitTransferWithAuthorization(): Promise<string> {
    return '0x' + 'abc123'.repeat(10); // Mock tx hash
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('API Endpoints', () => {
  let app: Hono;
  let mockLotus: MockLotusService;
  let config: Config;

  beforeAll(() => {
    config = {
      ...defaultConfig,
      token: { address: TEST_TOKEN, decimals: 6, name: 'USD Coin' },
      chain: { id: TEST_CHAIN_ID, name: 'calibration' },
      risk: {
        maxPerTransaction: 100,
        maxPendingPerWallet: 50,
        dailyLimitPerWallet: 500,
      },
      facilitator: {
        privateKey: '0x' + '1'.repeat(64), // Mock private key
        address: '0x' + '3'.repeat(40),
      },
    };

    mockLotus = new MockLotusService(config);
    const signature = new SignatureService(config);
    const risk = new RiskService(config);
    const verify = new VerifyService(config, mockLotus, signature, risk);
    const settle = new SettleService(config, mockLotus, signature, risk, verify);

    app = new Hono();
    app.route('/verify', createVerifyRoute(verify));
    app.route('/settle', createSettleRoute(settle));
    app.route('/health', createHealthRoute(config, mockLotus, risk));
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const res = await app.request('/health');
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(body.chain.name).toBe('calibration');
      expect(body.chain.connected).toBe(true);
    });
  });

  describe('POST /verify', () => {
    it('should verify valid payment', async () => {
      const payment = await createTestPayment();
      const requirements = createTestRequirements();

      // Set sufficient balance
      mockLotus.setBalance(payment.from, 10000000n); // $10

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(200);
      expect(body.valid).toBe(true);
      expect(body.riskScore).toBe(0);
    });

    it('should reject expired payment', async () => {
      const payment = await createExpiredPayment();
      const requirements = createTestRequirements();

      mockLotus.setBalance(payment.from, 10000000n);

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.valid).toBe(false);
      expect(body.reason).toBe('expired_or_not_yet_valid');
    });

    it('should reject invalid signature', async () => {
      const payment = await createInvalidSignaturePayment();
      const requirements = createTestRequirements();

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.valid).toBe(false);
      expect(body.reason).toBe('invalid_signature');
    });

    it('should reject insufficient balance', async () => {
      const payment = await createTestPayment({ value: '5000000' }); // $5
      const requirements = createTestRequirements({ maxAmountRequired: '5000000' });

      mockLotus.setBalance(payment.from, 1000000n); // Only $1

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.valid).toBe(false);
      expect(body.reason).toBe('insufficient_balance');
    });

    it('should reject payment exceeding risk limits', async () => {
      const payment = await createOverLimitPayment(); // $200
      const requirements = createTestRequirements({ maxAmountRequired: '200000000' });

      mockLotus.setBalance(payment.from, 300000000n); // $300

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.valid).toBe(false);
      expect(body.reason).toContain('max per transaction');
    });

    it('should reject token mismatch', async () => {
      const payment = await createTestPayment();
      const requirements = createTestRequirements();
      requirements.tokenAddress = '0x' + '9'.repeat(40); // Different token

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.valid).toBe(false);
      expect(body.reason).toBe('token_mismatch');
    });

    it('should reject recipient mismatch', async () => {
      const payment = await createTestPayment();
      const requirements = createTestRequirements();
      requirements.payTo = '0x' + '9'.repeat(40); // Different recipient

      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.valid).toBe(false);
      expect(body.reason).toBe('recipient_mismatch');
    });
  });

  describe('POST /settle', () => {
    it('should settle valid payment', async () => {
      const payment = await createTestPayment();
      const requirements = createTestRequirements();

      mockLotus.setBalance(payment.from, 10000000n);

      const res = await app.request('/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.paymentId).toBeDefined();
      expect(body.transactionCid).toBeDefined();
    });

    it('should reject duplicate settlement', async () => {
      const payment = await createTestPayment();
      const requirements = createTestRequirements();

      mockLotus.setBalance(payment.from, 10000000n);

      // First settlement
      await app.request('/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });

      // Duplicate settlement
      const res = await app.request('/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment, requirements }),
      });
      const body = await res.json() as AnyJson;

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toBe('payment_already_submitted');
    });
  });
});
