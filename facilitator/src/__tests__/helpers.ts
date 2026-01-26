import { ethers } from 'ethers';
import type { PaymentPayload, PaymentRequirements } from '../types/payment.js';

// Test wallet for signing payments
export const TEST_WALLET = ethers.Wallet.createRandom();

// Test provider address
export const TEST_PROVIDER = '0x' + '1'.repeat(40);

// Test token address (mock USDFC)
export const TEST_TOKEN = '0x' + '2'.repeat(40);

// Test chain ID (Calibration)
export const TEST_CHAIN_ID = 314159;

// EIP-712 domain for test token
const DOMAIN = {
  name: 'USD Coin',
  version: '1',
  chainId: TEST_CHAIN_ID,
  verifyingContract: TEST_TOKEN,
};

// EIP-712 types for TransferWithAuthorization
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Generate a random nonce for EIP-3009
 */
export function generateNonce(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

/**
 * Create a signed test payment
 */
export async function createTestPayment(
  options: {
    value?: string;
    validAfter?: number;
    validBefore?: number;
    nonce?: string;
    to?: string;
  } = {}
): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);

  const value = options.value || '1000000'; // 1 USDFC (6 decimals)
  const validAfter = options.validAfter || now - 60;
  const validBefore = options.validBefore || now + 3600; // 1 hour
  const nonce = options.nonce || generateNonce();
  const to = options.to || TEST_PROVIDER;

  const message = {
    from: TEST_WALLET.address,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  // Sign with EIP-712
  const signature = await TEST_WALLET.signTypedData(DOMAIN, TYPES, message);

  return {
    token: TEST_TOKEN,
    from: TEST_WALLET.address,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
    signature,
  };
}

/**
 * Create test payment requirements
 */
export function createTestRequirements(
  options: {
    maxAmountRequired?: string;
    payTo?: string;
  } = {}
): PaymentRequirements {
  return {
    payTo: options.payTo || TEST_PROVIDER,
    maxAmountRequired: options.maxAmountRequired || '1000000',
    tokenAddress: TEST_TOKEN,
    chainId: TEST_CHAIN_ID,
    resource: '/api/test',
    description: 'Test payment',
  };
}

/**
 * Create an expired payment
 */
export async function createExpiredPayment(): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  return createTestPayment({
    validAfter: now - 3600,
    validBefore: now - 60, // Expired 1 minute ago
  });
}

/**
 * Create a payment not yet valid
 */
export async function createFuturePayment(): Promise<PaymentPayload> {
  const now = Math.floor(Date.now() / 1000);
  return createTestPayment({
    validAfter: now + 3600, // Valid in 1 hour
    validBefore: now + 7200,
  });
}

/**
 * Create a payment with invalid signature
 */
export async function createInvalidSignaturePayment(): Promise<PaymentPayload> {
  const payment = await createTestPayment();
  // Corrupt the signature
  return {
    ...payment,
    signature: payment.signature.slice(0, -4) + 'dead',
  };
}

/**
 * Create a payment exceeding risk limits
 */
export async function createOverLimitPayment(): Promise<PaymentPayload> {
  return createTestPayment({
    value: '200000000', // $200 (exceeds $100 limit)
  });
}
