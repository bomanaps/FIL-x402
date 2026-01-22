import { z } from 'zod';

export const ConfigSchema = z.object({
  // Server configuration
  server: z.object({
    port: z.number().default(3402),
    host: z.string().default('0.0.0.0'),
  }),

  // Lotus node configuration
  lotus: z.object({
    endpoint: z.string().url(),
    token: z.string().optional(),
  }),

  // USDFC token configuration
  token: z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    decimals: z.number().default(6),
  }),

  // Chain configuration
  chain: z.object({
    id: z.number(), // 314 for mainnet, 314159 for calibration
    name: z.string(),
  }),

  // Risk limits (in USD, will be converted to token units)
  risk: z.object({
    maxPerTransaction: z.number().default(100),
    maxPendingPerWallet: z.number().default(50),
    dailyLimitPerWallet: z.number().default(500),
  }),

  // Settlement configuration
  settlement: z.object({
    maxAttempts: z.number().default(3),
    retryDelayMs: z.number().default(5000),
    timeoutMs: z.number().default(300000), // 5 minutes
  }),

  // Facilitator wallet (for gas payments)
  facilitator: z.object({
    privateKey: z.string().optional(),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// Default configuration for Calibration testnet
export const defaultConfig: Config = {
  server: {
    port: 3402,
    host: '0.0.0.0',
  },
  lotus: {
    endpoint: 'http://localhost:1234/rpc/v1',
    token: undefined,
  },
  token: {
    // USDFC on Calibration - placeholder, update with actual address
    address: '0x0000000000000000000000000000000000000000',
    decimals: 6,
  },
  chain: {
    id: 314159,
    name: 'calibration',
  },
  risk: {
    maxPerTransaction: 100,
    maxPendingPerWallet: 50,
    dailyLimitPerWallet: 500,
  },
  settlement: {
    maxAttempts: 3,
    retryDelayMs: 5000,
    timeoutMs: 300000,
  },
  facilitator: {
    privateKey: undefined,
    address: undefined,
  },
};
