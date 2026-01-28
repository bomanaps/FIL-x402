import { describe, it, expect } from 'vitest';
import { VoucherSchema } from '../types/deferred.js';

describe('Deferred Types', () => {
  describe('VoucherSchema', () => {
    const validVoucher = {
      id: '0x' + 'ab'.repeat(32),
      buyer: '0x' + '11'.repeat(20),
      seller: '0x' + '22'.repeat(20),
      valueAggregate: '1000000000000000000', // 1e18
      asset: '0x' + '33'.repeat(20),
      timestamp: Math.floor(Date.now() / 1000),
      nonce: 1,
      escrow: '0x' + '44'.repeat(20),
      chainId: 314159,
      signature: '0x' + 'ff'.repeat(65),
    };

    it('should accept valid voucher', () => {
      const result = VoucherSchema.safeParse(validVoucher);
      expect(result.success).toBe(true);
    });

    it('should reject invalid buyer address', () => {
      const result = VoucherSchema.safeParse({
        ...validVoucher,
        buyer: 'not-an-address',
      });
      expect(result.success).toBe(false);
    });

    it('should reject zero nonce', () => {
      const result = VoucherSchema.safeParse({
        ...validVoucher,
        nonce: 0,
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const { id, ...incomplete } = validVoucher;
      const result = VoucherSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });
  });
});
