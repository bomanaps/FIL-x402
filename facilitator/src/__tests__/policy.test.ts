import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyService } from '../services/policy.js';

describe('PolicyService', () => {
  let policy: PolicyService;

  beforeEach(() => {
    policy = new PolicyService();
  });

  describe('selectPolicy (defaults)', () => {
    it('should select micro policy for tiny amounts', () => {
      const p = policy.selectPolicy('0x1234567890123456789012345678901234567890', 0.05);
      expect(p.model).toBe('fcr');
      expect(p.minConfirmationLevel).toBe('L1');
      expect(p.timeoutAction).toBe('continue');
    });

    it('should select standard policy for medium amounts', () => {
      const p = policy.selectPolicy('0x1234567890123456789012345678901234567890', 50);
      expect(p.model).toBe('fcr');
      expect(p.minConfirmationLevel).toBe('L2');
      expect(p.timeoutAction).toBe('pause');
    });

    it('should select large policy for big amounts', () => {
      const p = policy.selectPolicy('0x1234567890123456789012345678901234567890', 500);
      expect(p.model).toBe('fcr');
      expect(p.minConfirmationLevel).toBe('L3');
      expect(p.timeoutAction).toBe('abort');
    });
  });

  describe('custom provider policy', () => {
    it('should use provider-specific policies when registered', () => {
      const addr = '0xaabbccddee00112233445566778899aabbccddee';
      policy.registerProvider({
        address: addr,
        policies: [
          {
            maxAmountUsd: 10,
            model: 'deferred',
            minConfirmationLevel: 'L0',
            timeoutAction: 'continue',
            timeoutMs: 1000,
          },
          {
            maxAmountUsd: Infinity,
            model: 'fcr',
            minConfirmationLevel: 'L2',
            timeoutAction: 'abort',
            timeoutMs: 30000,
          },
        ],
      });

      const small = policy.selectPolicy(addr, 5);
      expect(small.model).toBe('deferred');

      const large = policy.selectPolicy(addr, 100);
      expect(large.model).toBe('fcr');
    });
  });

  describe('evaluateDelivery', () => {
    it('should start if confirmation level met', () => {
      const p = policy.selectPolicy('0x0000000000000000000000000000000000000001', 50);
      const result = policy.evaluateDelivery(p, 'L2', 0);
      expect(result).toBe('start');
    });

    it('should start if higher level met', () => {
      const p = policy.selectPolicy('0x0000000000000000000000000000000000000001', 50);
      const result = policy.evaluateDelivery(p, 'L3', 0);
      expect(result).toBe('start');
    });

    it('should pause if level not met and not timed out', () => {
      const p = policy.selectPolicy('0x0000000000000000000000000000000000000001', 50);
      const result = policy.evaluateDelivery(p, 'L1', 1000);
      expect(result).toBe('pause');
    });

    it('should apply timeout action when timed out', () => {
      // Standard policy: timeoutAction = 'pause', timeoutMs = 60000
      const p = policy.selectPolicy('0x0000000000000000000000000000000000000001', 50);
      const result = policy.evaluateDelivery(p, 'L1', 60000);
      expect(result).toBe('pause');
    });

    it('should continue for micro payments on timeout', () => {
      // Micro policy: timeoutAction = 'continue', timeoutMs = 5000
      const p = policy.selectPolicy('0x0000000000000000000000000000000000000001', 0.05);
      const result = policy.evaluateDelivery(p, 'L0', 5000);
      expect(result).toBe('start'); // 'continue' maps to 'start'
    });

    it('should abort for large payments on timeout', () => {
      const p = policy.selectPolicy('0x0000000000000000000000000000000000000001', 500);
      const result = policy.evaluateDelivery(p, 'L1', 120000);
      expect(result).toBe('abort');
    });
  });
});
