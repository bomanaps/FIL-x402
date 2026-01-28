import { z } from 'zod';

export const BondConfigSchema = z.object({
  enabled: z.boolean().default(false),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  // Alert threshold: warn when bond utilization exceeds this percentage
  alertThresholdPercent: z.number().default(80),
});

export type BondConfig = z.infer<typeof BondConfigSchema>;

export interface BondedPayment {
  paymentId: string;
  provider: string;
  amount: bigint;
  committedAt: number;
  deadline: number;
  settled: boolean;
  claimed: boolean;
}

export interface BondStatus {
  totalBond: bigint;
  totalCommitted: bigint;
  available: bigint;
  utilizationPercent: number;
}
