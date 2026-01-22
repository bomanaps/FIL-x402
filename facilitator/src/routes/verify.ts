import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { VerifyRequestSchema } from '../types/payment.js';
import type { VerifyService } from '../services/verify.js';

export function createVerifyRoute(verifyService: VerifyService): Hono {
  const app = new Hono();

  app.post(
    '/',
    zValidator('json', VerifyRequestSchema),
    async (c) => {
      const { payment, requirements } = c.req.valid('json');

      try {
        const result = await verifyService.verify(payment, requirements);

        return c.json(result, result.valid ? 200 : 400);
      } catch (error) {
        console.error('Verify error:', error);
        return c.json(
          {
            valid: false,
            riskScore: 100,
            reason: 'internal_error',
          },
          500
        );
      }
    }
  );

  return app;
}
