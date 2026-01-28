import type { ProviderPolicy, ProviderConfig } from '../types/policy.js';

/**
 * Default policies by amount tier:
 *   Micro  (<$0.10): FCR model, L1 confirmation, continue on timeout
 *   Standard (<$100): FCR model, L2 confirmation, pause on timeout
 *   Large  (>=$100):  FCR model, L3 confirmation, abort on timeout
 */
const DEFAULT_POLICIES: ProviderPolicy[] = [
  {
    maxAmountUsd: 0.1,
    model: 'fcr',
    minConfirmationLevel: 'L1',
    timeoutAction: 'continue',
    timeoutMs: 5000,
  },
  {
    maxAmountUsd: 100,
    model: 'fcr',
    minConfirmationLevel: 'L2',
    timeoutAction: 'pause',
    timeoutMs: 60000,
  },
  {
    maxAmountUsd: Infinity,
    model: 'fcr',
    minConfirmationLevel: 'L3',
    timeoutAction: 'abort',
    timeoutMs: 120000,
  },
];

export class PolicyService {
  private providerConfigs: Map<string, ProviderConfig> = new Map();

  /**
   * Register a provider with custom policies.
   */
  registerProvider(config: ProviderConfig): void {
    // Sort policies by maxAmountUsd ascending
    config.policies.sort((a, b) => a.maxAmountUsd - b.maxAmountUsd);
    this.providerConfigs.set(config.address.toLowerCase(), config);
  }

  /**
   * Select the appropriate policy for a provider and amount.
   * Falls back to default policies if provider has no custom config.
   */
  selectPolicy(providerAddress: string, amountUsd: number): ProviderPolicy {
    const config = this.providerConfigs.get(providerAddress.toLowerCase());
    const policies = config?.policies || DEFAULT_POLICIES;

    for (const policy of policies) {
      if (amountUsd <= policy.maxAmountUsd) {
        return policy;
      }
    }

    // Fallback to last (highest tier) policy
    return policies[policies.length - 1];
  }

  /**
   * Evaluate whether to start, pause, or abort delivery based on policy.
   */
  evaluateDelivery(
    policy: ProviderPolicy,
    currentLevel: string,
    elapsedMs: number
  ): 'start' | 'pause' | 'abort' {
    const levelOrder = ['L0', 'L1', 'L2', 'L3'];
    const currentIdx = levelOrder.indexOf(currentLevel);
    const requiredIdx = levelOrder.indexOf(policy.minConfirmationLevel);

    // Confirmation met
    if (currentIdx >= requiredIdx) {
      return 'start';
    }

    // Timeout reached
    if (elapsedMs >= policy.timeoutMs) {
      return policy.timeoutAction === 'continue' ? 'start' : policy.timeoutAction;
    }

    // Still waiting
    return 'pause';
  }

  /**
   * Get default policies (for documentation/health check).
   */
  getDefaultPolicies(): ProviderPolicy[] {
    return DEFAULT_POLICIES;
  }
}
