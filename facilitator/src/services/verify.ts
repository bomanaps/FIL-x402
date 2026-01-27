import type { Config } from '../types/config.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
} from '../types/payment.js';
import { LotusService } from './lotus.js';
import { SignatureService } from './signature.js';
import { RiskService } from './risk.js';

export class VerifyService {
  private lotus: LotusService;
  private signature: SignatureService;
  private risk: RiskService;

  constructor(
    _config: Config,
    lotus: LotusService,
    signature: SignatureService,
    risk: RiskService
  ) {
    this.lotus = lotus;
    this.signature = signature;
    this.risk = risk;
  }

  /**
   * Verify a payment against requirements
   * Performs all checks needed before accepting a payment
   */
  async verify(
    payment: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    // 1. Basic validation - token and chain match
    if (payment.token.toLowerCase() !== requirements.tokenAddress.toLowerCase()) {
      return {
        valid: false,
        riskScore: 100,
        reason: 'token_mismatch',
      };
    }

    if (payment.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return {
        valid: false,
        riskScore: 100,
        reason: 'recipient_mismatch',
      };
    }

    // 2. Check payment amount meets requirements
    const paymentAmount = BigInt(payment.value);
    const requiredAmount = BigInt(requirements.maxAmountRequired);

    if (paymentAmount < requiredAmount) {
      return {
        valid: false,
        riskScore: 100,
        reason: 'insufficient_amount',
      };
    }

    // 3. Verify signature
    if (!this.signature.isValidPaymentSignature(payment)) {
      return {
        valid: false,
        riskScore: 100,
        reason: 'invalid_signature',
      };
    }

    // 4. Check validity window
    if (!this.signature.isWithinValidityWindow(payment)) {
      return {
        valid: false,
        riskScore: 100,
        reason: 'expired_or_not_yet_valid',
      };
    }

    // 5. Check if expiring too soon (need time to settle)
    if (this.signature.isExpiringSoon(payment, 120)) {
      return {
        valid: false,
        riskScore: 80,
        reason: 'expires_too_soon',
      };
    }

    // 6. Check nonce not already used
    try {
      const nonceUsed = await this.lotus.isNonceUsed(payment.from, payment.nonce);
      if (nonceUsed) {
        return {
          valid: false,
          riskScore: 100,
          reason: 'nonce_already_used',
        };
      }
    } catch (error) {
      // Log but don't fail - nonce check is best effort
      console.warn('Nonce check failed:', error);
    }

    // 7. Check balance
    let balance: bigint;
    try {
      balance = await this.lotus.getBalance(payment.from);
    } catch (error) {
      return {
        valid: false,
        riskScore: 90,
        reason: 'balance_check_failed',
      };
    }

    // Require balance >= payment amount (no buffer in Stage 1)
    if (balance < paymentAmount) {
      return {
        valid: false,
        riskScore: 80,
        reason: 'insufficient_balance',
        walletBalance: balance.toString(),
      };
    }

    // 8. Check risk limits
    const riskCheck = this.risk.checkPayment(payment);
    if (!riskCheck.allowed) {
      return {
        valid: false,
        riskScore: riskCheck.riskScore,
        reason: riskCheck.reason,
        pendingAmount: riskCheck.currentPending.toString(),
      };
    }

    // All checks passed!
    return {
      valid: true,
      riskScore: 0,
      walletBalance: balance.toString(),
      pendingAmount: riskCheck.currentPending.toString(),
    };
  }
}
