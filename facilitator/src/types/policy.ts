export type PaymentModel = 'fcr' | 'deferred';

export interface ProviderPolicy {
  /** Max payment amount for this policy tier (in USD) */
  maxAmountUsd: number;
  /** Which payment model to use */
  model: PaymentModel;
  /** Minimum confirmation level before delivering data */
  minConfirmationLevel: 'L0' | 'L1' | 'L2' | 'L3';
  /** Action if confirmation stalls */
  timeoutAction: 'continue' | 'pause' | 'abort';
  /** Timeout in ms before taking timeoutAction */
  timeoutMs: number;
}

export interface ProviderConfig {
  /** Provider address */
  address: string;
  /** Policy tiers ordered by maxAmountUsd ascending */
  policies: ProviderPolicy[];
}
