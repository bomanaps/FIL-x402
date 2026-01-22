import { Hono } from 'hono';
import type { LotusService } from '../services/lotus.js';
import type { RiskService } from '../services/risk.js';
import type { Config } from '../types/config.js';

export function createHealthRoute(
  config: Config,
  lotus: LotusService,
  risk: RiskService
): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const lotusHealthy = await lotus.healthCheck();
    const riskStats = risk.getStats();
    const limits = risk.getLimits();

    const healthy = lotusHealthy;

    return c.json(
      {
        status: healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        chain: {
          id: config.chain.id,
          name: config.chain.name,
          connected: lotusHealthy,
        },
        settlements: {
          pending: riskStats.totalPendingSettlements,
          totalPendingAmount: riskStats.totalPendingAmount.toString(),
          walletsWithPending: riskStats.walletsWithPending,
        },
        limits: {
          maxPerTransaction: limits.maxPerTransaction.toString(),
          maxPendingPerWallet: limits.maxPendingPerWallet.toString(),
          dailyLimitPerWallet: limits.dailyLimitPerWallet.toString(),
        },
      },
      healthy ? 200 : 503
    );
  });

  return app;
}
