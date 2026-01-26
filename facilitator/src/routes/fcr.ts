import { Hono } from 'hono';
import type { F3Service } from '../services/f3.js';
import { F3PhaseNames, ConfirmationLevel } from '../types/f3.js';

export function createFcrRoute(f3Service: F3Service): Hono {
  const app = new Hono();

  // Get current F3 status
  app.get('/status', async (c) => {
    const state = f3Service.getCurrentState();
    const confirmationStatus = f3Service.getConfirmationStatus();

    if (!state) {
      return c.json({
        running: false,
        message: 'F3 monitor not initialized',
      }, 503);
    }

    return c.json({
      running: true,
      instance: state.instance,
      round: state.round,
      phase: F3PhaseNames[state.phase],
      phaseCode: state.phase,
      roundBumps: state.roundBumps,
      isL2Safe: f3Service.isL2Safe(),
      confirmationLevel: confirmationStatus.level,
      timestamp: new Date().toISOString(),
    });
  });

  // Get confirmation level definitions
  app.get('/levels', (c) => {
    return c.json({
      levels: [
        {
          code: ConfirmationLevel.L0_MEMPOOL,
          name: 'Mempool',
          description: 'Payment accepted in mempool, not yet in block',
          latency: 'instant',
        },
        {
          code: ConfirmationLevel.L1_INCLUDED,
          name: 'Included',
          description: 'Payment included in EC block',
          latency: '~30s',
        },
        {
          code: ConfirmationLevel.L2_FCR_SAFE,
          name: 'FCR Safe',
          description: 'Safe heuristic passed (COMMIT or PREPARE+Round0+5s)',
          latency: '~45s',
        },
        {
          code: ConfirmationLevel.L3_FINALIZED,
          name: 'Finalized',
          description: 'Full F3 certificate issued',
          latency: '~60s',
        },
        {
          code: ConfirmationLevel.LB_BOND,
          name: 'Bond Backstop',
          description: 'Facilitator bond guarantees payment',
          latency: 'instant',
        },
      ],
    });
  });

  // Wait for a specific confirmation level
  app.get('/wait/:level', async (c) => {
    const level = c.req.param('level') as ConfirmationLevel;
    const timeout = parseInt(c.req.query('timeout') || '120000');

    const validLevels = Object.values(ConfirmationLevel);
    if (!validLevels.includes(level)) {
      return c.json({ error: `Invalid level. Must be one of: ${validLevels.join(', ')}` }, 400);
    }

    try {
      const status = await f3Service.waitForConfirmation(level, timeout);
      return c.json({
        reached: true,
        level: status.level,
        instance: status.instance,
        round: status.round,
        phase: status.phase !== undefined ? F3PhaseNames[status.phase] : undefined,
        timestamp: new Date(status.timestamp).toISOString(),
      });
    } catch (error) {
      return c.json({
        reached: false,
        error: 'Timeout waiting for confirmation level',
        requestedLevel: level,
      }, 408);
    }
  });

  return app;
}
