import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SettleRequestSchema } from '../types/payment.js';
import type { SettleService } from '../services/settle.js';

export function createSettleRoute(settleService: SettleService): Hono {
  const app = new Hono();

  app.post(
    '/',
    zValidator('json', SettleRequestSchema),
    async (c) => {
      const { payment, requirements } = c.req.valid('json');

      try {
        const result = await settleService.settle(payment, requirements);

        return c.json(result, result.success ? 200 : 400);
      } catch (error) {
        console.error('Settle error:', error);
        return c.json(
          {
            success: false,
            paymentId: '',
            error: 'internal_error',
          },
          500
        );
      }
    }
  );

  // Get settlement status by payment ID
  app.get('/:paymentId', async (c) => {
    const paymentId = c.req.param('paymentId');

    const settlement = settleService.getSettlementStatus(paymentId);

    if (!settlement) {
      return c.json({ error: 'settlement_not_found' }, 404);
    }

    return c.json({
      paymentId: settlement.paymentId,
      status: settlement.status,
      transactionCid: settlement.transactionCid,
      attempts: settlement.attempts,
      createdAt: settlement.createdAt,
      updatedAt: settlement.updatedAt,
      error: settlement.error,
    });
  });

  return app;
}
