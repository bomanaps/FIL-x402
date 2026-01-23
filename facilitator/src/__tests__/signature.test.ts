import { describe, it, expect, beforeAll } from 'vitest';
import { SignatureService } from '../services/signature.js';
import { defaultConfig } from '../types/config.js';
import {
  TEST_WALLET,
  TEST_TOKEN,
  TEST_CHAIN_ID,
  createTestPayment,
  createExpiredPayment,
  createFuturePayment,
  createInvalidSignaturePayment,
} from './helpers.js';

describe('SignatureService', () => {
  let signatureService: SignatureService;

  beforeAll(() => {
    const config = {
      ...defaultConfig,
      token: { address: TEST_TOKEN, decimals: 6 },
      chain: { id: TEST_CHAIN_ID, name: 'calibration' },
    };
    signatureService = new SignatureService(config);
  });

  describe('verifySignature', () => {
    it('should recover correct signer from valid signature', async () => {
      const payment = await createTestPayment();
      const recovered = signatureService.verifySignature(payment);

      expect(recovered).not.toBeNull();
      expect(recovered?.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    });

    it('should return null for invalid signature', async () => {
      const payment = await createInvalidSignaturePayment();
      const recovered = signatureService.verifySignature(payment);

      // Should either return null or a different address
      if (recovered) {
        expect(recovered.toLowerCase()).not.toBe(TEST_WALLET.address.toLowerCase());
      }
    });
  });

  describe('isValidPaymentSignature', () => {
    it('should return true for valid payment signature', async () => {
      const payment = await createTestPayment();
      const isValid = signatureService.isValidPaymentSignature(payment);

      expect(isValid).toBe(true);
    });

    it('should return false for tampered signature', async () => {
      const payment = await createInvalidSignaturePayment();
      const isValid = signatureService.isValidPaymentSignature(payment);

      expect(isValid).toBe(false);
    });

    it('should return false when from address does not match signer', async () => {
      const payment = await createTestPayment();
      // Change the from address
      const tampered = {
        ...payment,
        from: '0x' + '9'.repeat(40),
      };
      const isValid = signatureService.isValidPaymentSignature(tampered);

      expect(isValid).toBe(false);
    });
  });

  describe('isWithinValidityWindow', () => {
    it('should return true for valid time window', async () => {
      const payment = await createTestPayment();
      const isValid = signatureService.isWithinValidityWindow(payment);

      expect(isValid).toBe(true);
    });

    it('should return false for expired payment', async () => {
      const payment = await createExpiredPayment();
      const isValid = signatureService.isWithinValidityWindow(payment);

      expect(isValid).toBe(false);
    });

    it('should return false for not-yet-valid payment', async () => {
      const payment = await createFuturePayment();
      const isValid = signatureService.isWithinValidityWindow(payment);

      expect(isValid).toBe(false);
    });
  });

  describe('isExpiringSoon', () => {
    it('should return false for payment with plenty of time', async () => {
      const payment = await createTestPayment();
      const isExpiring = signatureService.isExpiringSoon(payment, 60);

      expect(isExpiring).toBe(false);
    });

    it('should return true for payment about to expire', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payment = await createTestPayment({
        validBefore: now + 30, // Expires in 30 seconds
      });
      const isExpiring = signatureService.isExpiringSoon(payment, 60);

      expect(isExpiring).toBe(true);
    });
  });

  describe('generatePaymentId', () => {
    it('should generate consistent payment ID for same payment', async () => {
      const payment = await createTestPayment();
      const id1 = signatureService.generatePaymentId(payment);
      const id2 = signatureService.generatePaymentId(payment);

      expect(id1).toBe(id2);
    });

    it('should generate different IDs for different payments', async () => {
      const payment1 = await createTestPayment();
      const payment2 = await createTestPayment();
      const id1 = signatureService.generatePaymentId(payment1);
      const id2 = signatureService.generatePaymentId(payment2);

      expect(id1).not.toBe(id2);
    });
  });
});
