import { Hono } from 'hono';
import type { ERC8004Service } from '../services/erc8004.js';

export function createAgentRoute(erc8004: ERC8004Service): Hono {
  const app = new Hono();

  /**
   * GET /agent-metadata
   * Returns agent metadata JSON for ERC-8004 registration
   */
  app.get('/agent-metadata', (c) => {
    const metadata = erc8004.getAgentMetadata();
    return c.json(metadata);
  });

  /**
   * GET /agent-metadata/.well-known/erc8004-agent.json
   * Alternative well-known path for agent metadata
   */
  app.get('/.well-known/erc8004-agent.json', (c) => {
    const metadata = erc8004.getAgentMetadata();
    return c.json(metadata);
  });

  /**
   * GET /agent/status
   * Returns ERC-8004 registration status and reputation
   */
  app.get('/status', async (c) => {
    if (!erc8004.isEnabled()) {
      return c.json({
        enabled: false,
        message: 'ERC-8004 integration not configured',
      });
    }

    const agentId = erc8004.getAgentId();

    if (agentId === undefined) {
      return c.json({
        enabled: true,
        registered: false,
        message: 'Agent not yet registered. Run registration script.',
      });
    }

    try {
      const [reputation, validation, versions] = await Promise.all([
        erc8004.getReputationSummary(agentId).catch(() => null),
        erc8004.getValidationSummary(agentId).catch(() => null),
        erc8004.getVersions().catch(() => ({})),
      ]);

      return c.json({
        enabled: true,
        registered: true,
        agentId,
        reputation: reputation || { count: 0, averageValue: 0, valueDecimals: 0 },
        validation: validation || { count: 0, avgResponse: 0 },
        registryVersions: versions,
      });
    } catch (error) {
      return c.json({
        enabled: true,
        registered: true,
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return app;
}
