import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { VoucherSchema } from '../types/deferred.js';
import type { DeferredService } from '../services/deferred.js';
import { z } from 'zod';

export function createDeferredRoutes(deferred: DeferredService) {
  const app = new Hono();

  /**
   * GET /deferred/buyers/:buyer
   * Get escrow account state: balance, thawing, latest vouchers
   */
  app.get('/buyers/:buyer', async (c) => {
    const buyer = c.req.param('buyer');

    if (!/^0x[a-fA-F0-9]{40}$/.test(buyer)) {
      return c.json({ error: 'Invalid buyer address' }, 400);
    }

    try {
      const account = await deferred.getAccount(buyer);
      const vouchers = deferred.getVouchersForBuyer(buyer);

      return c.json({
        buyer,
        balance: account.balance.toString(),
        thawingAmount: account.thawingAmount.toString(),
        thawEndTime: account.thawEndTime,
        voucherCount: vouchers.length,
        vouchers: vouchers.map((v) => ({
          id: v.voucher.id,
          seller: v.voucher.seller,
          valueAggregate: v.voucher.valueAggregate,
          nonce: v.voucher.nonce,
          settled: v.settled,
          settledTxHash: v.settledTxHash,
        })),
      });
    } catch (error) {
      return c.json({ error: String(error) }, 500);
    }
  });

  /**
   * POST /deferred/vouchers
   * Store a signed voucher
   */
  app.post(
    '/vouchers',
    zValidator('json', VoucherSchema),
    async (c) => {
      const voucher = c.req.valid('json');

      try {
        const stored = deferred.storeVoucher(voucher);
        return c.json({
          success: true,
          voucherId: voucher.id,
          nonce: voucher.nonce,
          storedAt: stored.storedAt,
        });
      } catch (error) {
        return c.json({ error: String(error) }, 400);
      }
    }
  );

  /**
   * POST /deferred/vouchers/:id/settle
   * Settle a voucher by calling collect() on the escrow contract
   */
  app.post(
    '/vouchers/:id/settle',
    zValidator(
      'json',
      z.object({
        buyer: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        seller: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      })
    ),
    async (c) => {
      const voucherId = c.req.param('id');
      const { buyer, seller } = c.req.valid('json');

      try {
        const txHash = await deferred.settleVoucher(voucherId, buyer, seller);
        return c.json({
          success: true,
          voucherId,
          transactionHash: txHash,
        });
      } catch (error) {
        return c.json({ error: String(error) }, 400);
      }
    }
  );

  return app;
}
