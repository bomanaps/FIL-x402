import { z } from 'zod';

// EIP-3009 transferWithAuthorization payload
export const PaymentPayloadSchema = z.object({
  // The token contract address (USDFC)
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // The payer's address
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // The recipient's address (provider)
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // Amount in smallest unit (e.g., 6 decimals for USDFC)
  value: z.string(),
  // Unix timestamp - valid after this time
  validAfter: z.number().int(),
  // Unix timestamp - valid before this time
  validBefore: z.number().int(),
  // Unique nonce to prevent replay
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  // EIP-712 signature (r, s, v concatenated)
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
});

export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

// Payment requirements from the provider
export const PaymentRequirementsSchema = z.object({
  // The provider's address to receive payment
  payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // Maximum amount required (in smallest unit)
  maxAmountRequired: z.string(),
  // Token contract address
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // Chain ID (Filecoin mainnet: 314, Calibration: 314159)
  chainId: z.number().int(),
  // Resource being purchased
  resource: z.string().optional(),
  // Description of the payment
  description: z.string().optional(),
});

export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

// Verify request
export const VerifyRequestSchema = z.object({
  payment: PaymentPayloadSchema,
  requirements: PaymentRequirementsSchema,
});

export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

// Verify response
export interface VerifyResponse {
  valid: boolean;
  riskScore: number;
  reason?: string;
  walletBalance?: string;
  pendingAmount?: string;
}

// Settle request
export const SettleRequestSchema = z.object({
  payment: PaymentPayloadSchema,
  requirements: PaymentRequirementsSchema,
});

export type SettleRequest = z.infer<typeof SettleRequestSchema>;

// Settle response
export interface SettleResponse {
  success: boolean;
  transactionCid?: string;
  paymentId: string;
  error?: string;
  // FCR confirmation info
  fcr?: {
    level: string;
    instance?: number;
    round?: number;
    phase?: string;
  };
}

// Risk limits configuration
export interface RiskLimits {
  maxPerTransaction: bigint;
  maxPendingPerWallet: bigint;
  dailyLimitPerWallet: bigint;
}

// Settlement status
export type SettlementStatus =
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'retry';

// Pending settlement tracking
export interface PendingSettlement {
  paymentId: string;
  payment: PaymentPayload;
  requirements: PaymentRequirements;
  status: SettlementStatus;
  transactionCid?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  // FCR confirmation tracking
  tipsetHeight?: number;
  confirmationLevel?: string;
  f3Instance?: number;
  f3Round?: number;
  f3Phase?: number;
  confirmedAt?: number;
}
