/**
 * Test client for FCR-x402 facilitator.
 *
 * Usage:
 *   npx tsx scripts/test-payment.ts
 *
 * Required env vars (or edit the constants below):
 *   PAYER_PRIVATE_KEY   - wallet that holds USDFC and signs the payment
 *   PROVIDER_ADDRESS    - recipient of the payment (any 0x address)
 *   FACILITATOR_URL     - default http://localhost:3402
 */

import { ethers } from 'ethers';

// ─── Configuration ───────────────────────────────────────────────
const FACILITATOR_URL = process.env.FACILITATOR_URL || 'http://localhost:3402';
const PAYER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY || '';
const PROVIDER_ADDRESS =
  process.env.PROVIDER_ADDRESS || '0x000000000000000000000000000000000000dEaD'; // burn address as test recipient

const TOKEN_ADDRESS = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0';
const CHAIN_ID = 314159;
const PAYMENT_AMOUNT = '1000000000000000000'; // 1 USDFC (18 decimals)

// ─── EIP-712 Domain & Types ─────────────────────────────────────
const EIP712_DOMAIN = {
  name: 'USD for Filecoin Community',
  version: '1',
  chainId: CHAIN_ID,
  verifyingContract: TOKEN_ADDRESS,
};

const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

// ─── Helpers ─────────────────────────────────────────────────────
function log(label: string, data: unknown) {
  console.log(`\n── ${label} ──`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${FACILITATOR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const fcrHeaders = {
    'X-FCR-Level': res.headers.get('X-FCR-Level'),
    'X-FCR-Instance': res.headers.get('X-FCR-Instance'),
    'X-FCR-Phase': res.headers.get('X-FCR-Phase'),
  };
  return { status: res.status, json, fcrHeaders };
}

async function get(path: string) {
  const res = await fetch(`${FACILITATOR_URL}${path}`);
  return res.json();
}

// ─── Main Flow ───────────────────────────────────────────────────
async function main() {
  // 1. Validate inputs
  if (!PAYER_PRIVATE_KEY) {
    console.error('ERROR: Set PAYER_PRIVATE_KEY env var (your MetaMask private key)');
    console.error('  MetaMask → Account → ⋮ → Account details → Show private key');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(PAYER_PRIVATE_KEY);
  log('Payer', wallet.address);
  log('Provider', PROVIDER_ADDRESS);
  log('Amount', `${PAYMENT_AMOUNT} (${parseInt(PAYMENT_AMOUNT) / 1e6} USDFC)`);

  // 2. Check facilitator health
  log('Step 1: Health check', '');
  try {
    const health = await get('/health');
    log('Health', health);
  } catch (err) {
    console.error('ERROR: Facilitator not reachable at', FACILITATOR_URL);
    console.error('  Start it first: npm run dev');
    process.exit(1);
  }

  // 3. Check FCR status
  log('Step 2: FCR status', '');
  try {
    const fcrStatus = await get('/fcr/status');
    log('FCR Status', fcrStatus);
  } catch {
    log('FCR Status', 'Not available (may not be connected to Lotus with F3)');
  }

  // 4. Sign EIP-3009 payment
  log('Step 3: Sign EIP-3009 payment', '');
  const now = Math.floor(Date.now() / 1000);
  const nonce = ethers.hexlify(ethers.randomBytes(32));

  const message = {
    from: wallet.address,
    to: PROVIDER_ADDRESS,
    value: PAYMENT_AMOUNT,
    validAfter: now - 60,
    validBefore: now + 3600, // 1 hour
    nonce,
  };

  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    TRANSFER_WITH_AUTH_TYPES,
    message
  );

  const payment = {
    token: TOKEN_ADDRESS,
    from: wallet.address,
    to: PROVIDER_ADDRESS,
    value: PAYMENT_AMOUNT,
    validAfter: message.validAfter,
    validBefore: message.validBefore,
    nonce,
    signature,
  };

  const requirements = {
    payTo: PROVIDER_ADDRESS,
    maxAmountRequired: PAYMENT_AMOUNT,
    tokenAddress: TOKEN_ADDRESS,
    chainId: CHAIN_ID,
    resource: '/test/payment',
    description: 'Test payment via CLI',
  };

  log('Payment payload', payment);

  // 5. Verify
  log('Step 4: Verify payment', '');
  const verifyResult = await post('/verify', { payment, requirements });
  log('Verify response', verifyResult.json);
  log('FCR headers', verifyResult.fcrHeaders);

  if (verifyResult.status !== 200) {
    console.error('\nVerification FAILED. Check the reason above.');
    console.error('Common issues:');
    console.error('  - insufficient_balance: Payer needs USDFC tokens');
    console.error('  - invalid_signature: EIP-712 domain may not match the token contract');
    console.error('  - token_mismatch: TOKEN_ADDRESS differs from requirements');
    process.exit(1);
  }

  console.log('\n✓ Verification PASSED');

  // 6. Settle
  log('Step 5: Settle payment', '');
  const settleResult = await post('/settle', { payment, requirements });
  log('Settle response', settleResult.json);
  log('FCR headers', settleResult.fcrHeaders);

  if (settleResult.status !== 200) {
    console.error('\nSettlement submission FAILED. Check the error above.');
    process.exit(1);
  }

  console.log('\n✓ Settlement SUBMITTED');
  const paymentId = (settleResult.json as { paymentId: string }).paymentId;

  // 7. Poll settlement status and watch FCR progression
  log('Step 6: Tracking confirmation (polling every 5s)', '');
  console.log('  Watching FCR levels: L0 → L1 → L2 → L3');
  console.log('  Press Ctrl+C to stop\n');

  let lastLevel = '';
  for (let i = 0; i < 60; i++) {
    const status = await get(`/settle/${paymentId}`);
    const level = status.fcr?.level || 'unknown';
    const settlementStatus = status.status;

    if (level !== lastLevel) {
      const ts = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(
        `  [${ts}] Settlement: ${settlementStatus} | FCR: ${level}` +
          (status.fcr?.instance !== undefined ? ` | Instance: ${status.fcr.instance}` : '') +
          (status.fcr?.confirmedAt ? ` | Confirmed at: ${new Date(status.fcr.confirmedAt).toISOString()}` : '')
      );
      lastLevel = level;
    }

    // Done conditions
    if (settlementStatus === 'confirmed' || level === 'L3') {
      console.log('\n✓ Payment FINALIZED (L3)');
      log('Final status', status);
      break;
    }

    if (settlementStatus === 'failed') {
      console.error('\n✗ Settlement FAILED');
      log('Final status', status);
      break;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  // 8. Final FCR status
  log('Final FCR status', '');
  try {
    const fcrFinal = await get('/fcr/status');
    log('FCR', fcrFinal);
  } catch {
    // ignore
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
