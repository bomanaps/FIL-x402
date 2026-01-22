import type { Config } from '../types/config.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  PendingSettlement,
} from '../types/payment.js';
import { LotusService } from './lotus.js';
import { SignatureService } from './signature.js';
import { RiskService } from './risk.js';
import { VerifyService } from './verify.js';

export class SettleService {
  private lotus: LotusService;
  private signature: SignatureService;
  private risk: RiskService;
  private verify: VerifyService;
  private config: Config;

  // Settlement worker state
  private isProcessing: boolean = false;
  private settlementInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: Config,
    lotus: LotusService,
    signature: SignatureService,
    risk: RiskService,
    verify: VerifyService
  ) {
    this.config = config;
    this.lotus = lotus;
    this.signature = signature;
    this.risk = risk;
    this.verify = verify;
  }

  /**
   * Settle a payment - verify, reserve credit, submit to chain
   */
  async settle(
    payment: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    // Generate unique payment ID
    const paymentId = this.signature.generatePaymentId(payment);

    // Check if already being processed
    const existing = this.risk.getPendingSettlement(paymentId);
    if (existing) {
      return {
        success: false,
        paymentId,
        error: 'payment_already_submitted',
        transactionCid: existing.transactionCid,
      };
    }

    // Verify payment first
    const verifyResult = await this.verify.verify(payment, requirements);
    if (!verifyResult.valid) {
      return {
        success: false,
        paymentId,
        error: verifyResult.reason,
      };
    }

    // Reserve credit
    this.risk.reserveCredit(paymentId, payment);

    // Update settlement with requirements
    this.risk.updatePendingSettlement(paymentId, {
      requirements,
      status: 'pending',
    });

    // Submit transaction to chain
    try {
      const txCid = await this.lotus.submitTransferWithAuthorization(
        payment.from,
        payment.to,
        payment.value,
        payment.validAfter,
        payment.validBefore,
        payment.nonce,
        payment.signature
      );

      // Update settlement with transaction CID
      this.risk.updatePendingSettlement(paymentId, {
        transactionCid: txCid,
        status: 'submitted',
        attempts: 1,
      });

      return {
        success: true,
        paymentId,
        transactionCid: txCid,
      };
    } catch (error) {
      // Mark as retry for background processing
      this.risk.updatePendingSettlement(paymentId, {
        status: 'retry',
        attempts: 1,
        error: String(error),
      });

      return {
        success: false,
        paymentId,
        error: `submission_failed: ${error}`,
      };
    }
  }

  /**
   * Start the background settlement worker
   */
  startWorker(): void {
    if (this.settlementInterval) {
      return; // Already running
    }

    console.log('Starting settlement worker...');

    this.settlementInterval = setInterval(
      () => this.processSettlements(),
      this.config.settlement.retryDelayMs
    );
  }

  /**
   * Stop the background settlement worker
   */
  stopWorker(): void {
    if (this.settlementInterval) {
      clearInterval(this.settlementInterval);
      this.settlementInterval = null;
      console.log('Settlement worker stopped');
    }
  }

  /**
   * Process pending settlements
   */
  private async processSettlements(): Promise<void> {
    if (this.isProcessing) {
      return; // Already processing
    }

    this.isProcessing = true;

    try {
      const pending = this.risk.getAllPendingSettlements();

      for (const settlement of pending) {
        await this.processSettlement(settlement);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single settlement
   */
  private async processSettlement(settlement: PendingSettlement): Promise<void> {
    const { paymentId, payment, status, transactionCid, attempts, maxAttempts } = settlement;

    // Check if submitted transaction is confirmed
    if (status === 'submitted' && transactionCid) {
      try {
        const receipt = await this.lotus.waitForTransaction(transactionCid, 1);

        if (receipt && receipt.status === 1) {
          // Success!
          this.risk.releaseCredit(paymentId, true);
          console.log(`Settlement ${paymentId} confirmed: ${transactionCid}`);
          return;
        } else if (receipt && receipt.status === 0) {
          // Transaction failed on-chain
          this.risk.updatePendingSettlement(paymentId, {
            status: 'retry',
            error: 'transaction_reverted',
          });
        }
      } catch (error) {
        // Still pending, check later
        console.log(`Settlement ${paymentId} still pending...`);
      }
      return;
    }

    // Handle retry status
    if (status === 'retry') {
      if (attempts >= maxAttempts) {
        // Max retries reached - mark as failed
        this.risk.releaseCredit(paymentId, false);
        console.error(`Settlement ${paymentId} failed after ${attempts} attempts`);
        return;
      }

      // Check if payment expired
      const now = Math.floor(Date.now() / 1000);
      if (now >= payment.validBefore) {
        this.risk.releaseCredit(paymentId, false);
        console.error(`Settlement ${paymentId} expired`);
        return;
      }

      // Retry submission
      try {
        const txCid = await this.lotus.submitTransferWithAuthorization(
          payment.from,
          payment.to,
          payment.value,
          payment.validAfter,
          payment.validBefore,
          payment.nonce,
          payment.signature
        );

        this.risk.updatePendingSettlement(paymentId, {
          transactionCid: txCid,
          status: 'submitted',
          attempts: attempts + 1,
        });

        console.log(`Settlement ${paymentId} retry ${attempts + 1} submitted: ${txCid}`);
      } catch (error) {
        this.risk.updatePendingSettlement(paymentId, {
          attempts: attempts + 1,
          error: String(error),
        });
        console.error(`Settlement ${paymentId} retry ${attempts + 1} failed:`, error);
      }
    }
  }

  /**
   * Get settlement status
   */
  getSettlementStatus(paymentId: string): PendingSettlement | undefined {
    return this.risk.getPendingSettlement(paymentId);
  }
}
