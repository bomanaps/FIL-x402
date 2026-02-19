import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { ethers } from 'ethers';
import { type Config, defaultConfig, ConfigSchema } from './types/config.js';
import {
  LotusService,
  SignatureService,
  RiskService,
  VerifyService,
  SettleService,
  F3Service,
  BondService,
  DeferredService,
  FeeService,
  PolicyService,
  RedisService,
} from './services/index.js';
import {
  createVerifyRoute,
  createSettleRoute,
  createHealthRoute,
  createFcrRoute,
  createDeferredRoutes,
} from './routes/index.js';
import type { BondConfig } from './types/bond.js';
import type { DeferredConfig } from './types/deferred.js';

/**
 * Load configuration from environment variables
 */
function loadConfig(): Config {
  const config: Config = {
    server: {
      port: parseInt(process.env.PORT || '3402'),
      host: process.env.HOST || '0.0.0.0',
    },
    redis: {
      enabled: process.env.REDIS_ENABLED === 'true',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'fcr-x402:',
      maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
      retryDelayMs: parseInt(process.env.REDIS_RETRY_DELAY_MS || '1000'),
    },
    lotus: {
      endpoint: process.env.LOTUS_ENDPOINT || defaultConfig.lotus.endpoint,
      token: process.env.LOTUS_TOKEN,
    },
    token: {
      address: process.env.TOKEN_ADDRESS || defaultConfig.token.address,
      decimals: parseInt(process.env.TOKEN_DECIMALS || '6'),
      name: process.env.TOKEN_NAME || defaultConfig.token.name,
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
    fcr: {
      enabled: process.env.FCR_ENABLED !== 'false',
      pollIntervalMs: parseInt(process.env.FCR_POLL_INTERVAL_MS || '1000'),
      requireRoundZero: process.env.FCR_REQUIRE_ROUND_ZERO !== 'false',
      minTimeInPrepareMs: parseInt(process.env.FCR_MIN_TIME_IN_PREPARE_MS || '5000'),
      confirmationTimeoutMs: parseInt(process.env.FCR_CONFIRMATION_TIMEOUT_MS || '120000'),
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
function createApp(config: Config, redis?: RedisService) {
  // Initialize core services
  const lotus = new LotusService(config);
  const signature = new SignatureService(config, config.token.name);
  const risk = new RiskService(config, redis);
  const verify = new VerifyService(config, lotus, signature, risk);
  const f3 = new F3Service(config);
  const fee = new FeeService(config.token.decimals);
  const policy = new PolicyService();

  // Initialize ethers provider for bond/deferred services
  const provider = new ethers.JsonRpcProvider(
    config.lotus.endpoint,
    { chainId: config.chain.id, name: config.chain.name }
  );

  // Initialize bond service (optional)
  let bond: BondService | undefined;
  const bondConfig: BondConfig = {
    enabled: !!process.env.BOND_CONTRACT_ADDRESS,
    contractAddress: process.env.BOND_CONTRACT_ADDRESS,
    alertThresholdPercent: parseInt(process.env.BOND_ALERT_THRESHOLD || '80'),
  };
  if (bondConfig.enabled && bondConfig.contractAddress && config.facilitator.privateKey) {
    try {
      bond = new BondService(config, bondConfig, provider);
      console.log(`Bond service enabled: ${bondConfig.contractAddress}`);
    } catch (error) {
      console.warn('Bond service initialization failed:', error);
    }
  }

  // Initialize deferred service (optional)
  let deferred: DeferredService | undefined;
  const deferredConfig: DeferredConfig = {
    enabled: !!process.env.ESCROW_CONTRACT_ADDRESS,
    contractAddress: process.env.ESCROW_CONTRACT_ADDRESS,
  };
  if (deferredConfig.enabled && deferredConfig.contractAddress) {
    try {
      deferred = new DeferredService(config, deferredConfig, provider, redis);
      console.log(`Deferred service enabled: ${deferredConfig.contractAddress}`);
    } catch (error) {
      console.warn('Deferred service initialization failed:', error);
    }
  }

  const settle = new SettleService(config, lotus, signature, risk, verify, f3, bond);

  // Create Hono app
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // FCR headers middleware - adds confirmation status to responses
  app.use('*', async (c, next) => {
    await next();

    // Add FCR headers if F3 is running
    if (config.fcr.enabled && f3.isF3Running()) {
      const status = f3.getConfirmationStatus();
      c.header('X-FCR-Level', status.level);
      if (status.instance !== undefined) {
        c.header('X-FCR-Instance', status.instance.toString());
      }
      if (status.phase !== undefined) {
        c.header('X-FCR-Phase', status.phase.toString());
      }
    }
  });

  // Mount routes
  app.route('/verify', createVerifyRoute(verify));
  app.route('/settle', createSettleRoute(settle));
  app.route('/health', createHealthRoute(config, lotus, risk));
  app.route('/fcr', createFcrRoute(f3));

  // Mount deferred routes if enabled
  if (deferred) {
    app.route('/deferred', createDeferredRoutes(deferred));
  }

  // Root endpoint
  app.get('/', (c) => {
    return c.json({
      name: 'FCR-x402 Facilitator',
      version: '0.3.0',
      chain: config.chain.name,
      fcrEnabled: config.fcr.enabled,
      bondEnabled: bondConfig.enabled,
      deferredEnabled: deferredConfig.enabled,
      endpoints: {
        verify: '/verify',
        settle: '/settle',
        health: '/health',
        fcr: '/fcr/status',
        ...(deferredConfig.enabled ? {
          deferred_buyers: '/deferred/buyers/:address',
          deferred_vouchers: '/deferred/vouchers',
        } : {}),
      },
    });
  });

  return { app, settle, f3, risk };
}

/**
 * Main entry point
 */
async function main() {
  console.log('FCR-x402 Facilitator starting...');

  const config = loadConfig();

  // Initialize Redis if enabled
  let redis: RedisService | undefined;
  if (config.redis.enabled) {
    console.log(`Connecting to Redis at ${config.redis.host}:${config.redis.port}...`);
    redis = new RedisService(config);
    await redis.connect();
  }

  const { app, settle, f3, risk } = createApp(config, redis);

  // Load state from Redis if available
  if (redis?.isAvailable()) {
    await risk.loadFromRedis();
  }

  // Start settlement worker
  settle.startWorker();

  // Start F3 monitor if enabled
  if (config.fcr.enabled) {
    await f3.start();
  }

  // Handle shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    settle.stopWorker();
    f3.stop();
    if (redis) {
      await redis.disconnect();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

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
  console.log('FCR Settings:');
  console.log(`  Enabled: ${config.fcr.enabled}`);
  console.log(`  Poll interval: ${config.fcr.pollIntervalMs}ms`);
  console.log(`  Safe buffer: ${config.fcr.minTimeInPrepareMs}ms`);
  console.log('');
  console.log('Stage 3 Services:');
  console.log(`  Bond: ${process.env.BOND_CONTRACT_ADDRESS || 'disabled'}`);
  console.log(`  Escrow: ${process.env.ESCROW_CONTRACT_ADDRESS || 'disabled'}`);
  console.log('');
  console.log('Storage:');
  console.log(`  Redis: ${redis?.isAvailable() ? `connected (${config.redis.host}:${config.redis.port})` : 'disabled (using in-memory)'}`);
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
