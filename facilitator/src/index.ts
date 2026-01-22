import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { type Config, defaultConfig, ConfigSchema } from './types/config.js';
import {
  LotusService,
  SignatureService,
  RiskService,
  VerifyService,
  SettleService,
} from './services/index.js';
import {
  createVerifyRoute,
  createSettleRoute,
  createHealthRoute,
} from './routes/index.js';

/**
 * Load configuration from environment variables
 */
function loadConfig(): Config {
  const config: Config = {
    server: {
      port: parseInt(process.env.PORT || '3402'),
      host: process.env.HOST || '0.0.0.0',
    },
    lotus: {
      endpoint: process.env.LOTUS_ENDPOINT || defaultConfig.lotus.endpoint,
      token: process.env.LOTUS_TOKEN,
    },
    token: {
      address: process.env.TOKEN_ADDRESS || defaultConfig.token.address,
      decimals: parseInt(process.env.TOKEN_DECIMALS || '6'),
    },
    chain: {
      id: parseInt(process.env.CHAIN_ID || '314159'),
      name: process.env.CHAIN_NAME || 'calibration',
    },
    risk: {
      maxPerTransaction: parseInt(process.env.RISK_MAX_PER_TX || '100'),
      maxPendingPerWallet: parseInt(process.env.RISK_MAX_PENDING || '50'),
      dailyLimitPerWallet: parseInt(process.env.RISK_DAILY_LIMIT || '500'),
    },
    settlement: {
      maxAttempts: parseInt(process.env.SETTLEMENT_MAX_ATTEMPTS || '3'),
      retryDelayMs: parseInt(process.env.SETTLEMENT_RETRY_DELAY_MS || '5000'),
      timeoutMs: parseInt(process.env.SETTLEMENT_TIMEOUT_MS || '300000'),
    },
    facilitator: {
      privateKey: process.env.FACILITATOR_PRIVATE_KEY,
      address: process.env.FACILITATOR_ADDRESS,
    },
  };

  // Validate config
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    process.exit(1);
  }

  return result.data;
}

/**
 * Create and configure the application
 */
function createApp(config: Config) {
  // Initialize services
  const lotus = new LotusService(config);
  const signature = new SignatureService(config);
  const risk = new RiskService(config);
  const verify = new VerifyService(config, lotus, signature, risk);
  const settle = new SettleService(config, lotus, signature, risk, verify);

  // Create Hono app
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // Mount routes
  app.route('/verify', createVerifyRoute(verify));
  app.route('/settle', createSettleRoute(settle));
  app.route('/health', createHealthRoute(config, lotus, risk));

  // Root endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'FCR-x402 Facilitator',
      version: '0.1.0',
      chain: config.chain.name,
      endpoints: {
        verify: '/verify',
        settle: '/settle',
        health: '/health',
      },
    });
  });

  return { app, settle };
}

/**
 * Main entry point
 */
async function main() {
  console.log('FCR-x402 Facilitator starting...');

  const config = loadConfig();
  const { app, settle } = createApp(config);

  // Start settlement worker
  settle.startWorker();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    settle.stopWorker();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    settle.stopWorker();
    process.exit(0);
  });

  // Start server
  console.log(`Starting server on ${config.server.host}:${config.server.port}`);
  console.log(`Chain: ${config.chain.name} (${config.chain.id})`);
  console.log(`Token: ${config.token.address}`);
  console.log(`Lotus: ${config.lotus.endpoint}`);
  console.log('');
  console.log('Risk Limits:');
  console.log(`  Max per transaction: $${config.risk.maxPerTransaction}`);
  console.log(`  Max pending per wallet: $${config.risk.maxPendingPerWallet}`);
  console.log(`  Daily limit per wallet: $${config.risk.dailyLimitPerWallet}`);
  console.log('');

  serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
  });

  console.log(`Server running at http://${config.server.host}:${config.server.port}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
