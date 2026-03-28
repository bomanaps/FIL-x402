import { Hono } from 'hono';
import { register } from '../services/metrics.js';

export function createMetricsRoute(): Hono {
  const app = new Hono();
  app.get('/', async () => {
    return new Response(await register.metrics(), {
      headers: { 'Content-Type': register.contentType },
    });
  });
  return app;
}
