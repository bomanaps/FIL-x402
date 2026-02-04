// API client for the FCR-x402 facilitator service

import { FACILITATOR_URL } from './config';

export interface PaymentPayload {
  token: string;
  from: string;
  to: string;
  value: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
}

export interface PaymentRequirements {
  payTo: string;
  maxAmountRequired: string;
  tokenAddress: string;
  chainId: number;
  resource?: string;
  description?: string;
}

export interface VerifyResponse {
  valid: boolean;
  riskScore: number;
  reason?: string;
  walletBalance?: string;
  pendingAmount?: string;
}

export interface SettleResponse {
  success: boolean;
  paymentId: string;
  transactionCid?: string;
  error?: string;
}

export interface SettlementStatus {
  paymentId: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'retry';
  transactionCid?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  error?: string | null;
  fcr?: {
    level: string;
    instance?: number;
    phase?: number;
    confirmedAt?: number;
  };
}

export interface FCRStatus {
  running: boolean;
  instance?: number;
  round?: number;
  phase?: number;
  phaseName?: string;
  level: string;
  timestamp: number;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  chain: {
    id: number;
    name: string;
    connected: boolean;
  };
  settlements: {
    pending: number;
    totalPendingAmount: string;
    walletsWithPending: number;
  };
  limits: {
    maxPerTransaction: string;
    maxPendingPerWallet: string;
    dailyLimitPerWallet: string;
  };
}

export interface BuyerAccount {
  buyer: string;
  balance: string;
  thawingAmount: string;
  thawEndTime: number;
  voucherCount: number;
  vouchers: Array<{
    id: string;
    seller: string;
    valueAggregate: string;
    nonce: number;
    settled: boolean;
    settledTxHash?: string;
  }>;
}

class FacilitatorAPI {
  private baseUrl: string;

  constructor(baseUrl: string = FACILITATOR_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    const data = await res.json();
    return data as T;
  }

  // Core x402 endpoints
  async verify(payment: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('/verify', {
      method: 'POST',
      body: JSON.stringify({ payment, requirements }),
    });
  }

  async settle(payment: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return this.request<SettleResponse>('/settle', {
      method: 'POST',
      body: JSON.stringify({ payment, requirements }),
    });
  }

  async getSettlement(paymentId: string): Promise<SettlementStatus> {
    return this.request<SettlementStatus>(`/settle/${paymentId}`);
  }

  // FCR endpoints
  async getFCRStatus(): Promise<FCRStatus> {
    return this.request<FCRStatus>('/fcr/status');
  }

  async getFCRLevels(): Promise<Record<string, { condition: string; latency: string; security: string }>> {
    return this.request('/fcr/levels');
  }

  // Health endpoint
  async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>('/health');
  }

  // Deferred/Escrow endpoints
  async getBuyerAccount(address: string): Promise<BuyerAccount> {
    return this.request<BuyerAccount>(`/deferred/buyers/${address}`);
  }

  async storeVoucher(voucher: {
    id: string;
    buyer: string;
    seller: string;
    valueAggregate: string;
    asset: string;
    timestamp: number;
    nonce: number;
    escrow: string;
    chainId: number;
    signature: string;
  }): Promise<{ success: boolean; voucherId: string }> {
    return this.request('/deferred/vouchers', {
      method: 'POST',
      body: JSON.stringify(voucher),
    });
  }

  async settleVoucher(
    voucherId: string,
    buyer: string,
    seller: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    return this.request(`/deferred/vouchers/${voucherId}/settle`, {
      method: 'POST',
      body: JSON.stringify({ buyer, seller }),
    });
  }

  // Root endpoint
  async getInfo(): Promise<{
    name: string;
    version: string;
    chain: string;
    fcrEnabled: boolean;
    bondEnabled: boolean;
    deferredEnabled: boolean;
  }> {
    return this.request('/');
  }
}

export const facilitator = new FacilitatorAPI();
