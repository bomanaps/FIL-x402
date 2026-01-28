import { z } from 'zod';

export const VoucherSchema = z.object({
  id: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  buyer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  seller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  valueAggregate: z.string(), // bigint as string
  asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  timestamp: z.number().int(),
  nonce: z.number().int().positive(),
  escrow: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int(),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

export type Voucher = z.infer<typeof VoucherSchema>;

export interface EscrowAccount {
  balance: bigint;
  thawingAmount: bigint;
  thawEndTime: number;
}

export interface DeferredConfig {
  enabled: boolean;
  contractAddress?: string;
}

export interface StoredVoucher {
  voucher: Voucher;
  storedAt: number;
  settled: boolean;
  settledTxHash?: string;
}
