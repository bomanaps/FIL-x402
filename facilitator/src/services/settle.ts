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
import type { F3Service } from './f3.js';
import type { BondService } from './bond.js';

export class SettleService {
  private lotus: LotusService;
  private signature: SignatureService;
  private risk: RiskService;
  private verify: VerifyService;
  private config: Config;
  private f3: F3Service | null;
  private bond: BondService | null;

  // Settlement worker state
  private isProcessing: boolean = false;
  private settlementInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: Config,
    lotus: LotusService,
    signature: SignatureService,
    risk: RiskService,
    verify: VerifyService,
    f3?: F3Service,
    bond?: BondService
  ) {
    this.config = config;
    this.lotus = lotus;
    this.signature = signature;
    this.risk = risk;
    this.verify = verify;
    this.f3 = f3 || null;
    this.bond = bond || null;
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
    this.risk.reserveCredit(paymentId, payment, requirements);

    // Commit bond if bond service is available
    if (this.bond) {
      try {
        const hasCapacity = await this.bond.hasCapacity(BigInt(payment.value));
        if (!hasCapacity) {
          return {
            success: false,
            paymentId,
            error: 'insufficient_bond_capacity',
          };
        }
        await this.bond.commitPayment(paymentId, requirements.payTo, BigInt(payment.value));
      } catch (error) {
        return {
          success: false,
          paymentId,
          error: `bond_commit_failed: ${error}`,
        };
      }
    }

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

      // Capture current block height as the tipset this payment targets
      let tipsetHeight: number | undefined;
      try {
        tipsetHeight = await this.lotus.getBlockNumber();
      } catch {
        // Non-fatal: we just won't have per-payment FCR tracking
      }

      // Get initial FCR status for the response
      let fcrData: SettleResponse['fcr'];
      if (this.f3 && this.config.fcr.enabled && tipsetHeight !== undefined) {
        const status = await this.f3.evaluateConfirmationForTipset(tipsetHeight);
        fcrData = {
          level: status.level,
          instance: status.instance,
          round: status.round,
          phase: status.phase !== undefined ? status.phase.toString() : undefined,
        };
      }

      // Update settlement with transaction CID and FCR state
      this.risk.updatePendingSettlement(paymentId, {
        transactionCid: txCid,
        status: 'submitted',
        attempts: 1,
        tipsetHeight,
        confirmationLevel: fcrData?.level,
        f3Instance: fcrData?.instance,
      });

      return {
        success: true,
        paymentId,
        transactionCid: txCid,
        fcr: fcrData,
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
        // Update FCR confirmation level for each pending settlement
        await this.updateSettlementFCR(settlement);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Update FCR confirmation level for a settlement.
   * Called on each worker tick to track L0 → L1 → L2 → L3 progression.
   */
  private async updateSettlementFCR(settlement: PendingSettlement): Promise<void> {
    if (!this.f3 || !this.config.fcr.enabled) return;
    if (!settlement.tipsetHeight) return;
    // Already finalized — nothing to update
    if (settlement.confirmationLevel === 'L3') return;

    try {
      const status = await this.f3.evaluateConfirmationForTipset(settlement.tipsetHeight);

      // Only update if the level has advanced
      if (status.level !== settlement.confirmationLevel) {
        const updates: Partial<PendingSettlement> = {
          confirmationLevel: status.level,
          f3Instance: status.instance,
          f3Round: status.round,
          f3Phase: status.phase,
        };

        if (status.level === 'L3') {
          updates.confirmedAt = Date.now();
        }

        this.risk.updatePendingSettlement(settlement.paymentId, updates);
        console.log(
          `FCR update: payment=${settlement.paymentId} level=${status.level} instance=${status.instance}`
        );
      }
    } catch (error) {
      // Non-fatal: FCR tracking failure shouldn't block settlement processing
      console.warn(`FCR tracking failed for ${settlement.paymentId}:`, error);
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
          // Success! Release bond and credit
          if (this.bond) {
            try {
              await this.bond.releasePayment(paymentId);
            } catch (bondErr) {
              console.warn(`Bond release failed for ${paymentId}:`, bondErr);
            }
          }
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
