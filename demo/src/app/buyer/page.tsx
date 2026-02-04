'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignTypedData, useBalance } from 'wagmi';
import { parseEther, formatEther, keccak256, toHex } from 'viem';
import { Navigation } from '@/components/Navigation';
import {
  CONTRACTS,
  CHAIN_CONFIG,
  EIP712_DOMAIN,
  TRANSFER_WITH_AUTH_TYPES,
  TOKEN_CONFIG,
} from '@/lib/config';
import { facilitator, type SettlementStatus } from '@/lib/facilitator';

type PaymentStep = 'idle' | 'signing' | 'verifying' | 'settling' | 'tracking' | 'complete' | 'error';

interface PaymentState {
  step: PaymentStep;
  signature?: string;
  paymentId?: string;
  txHash?: string;
  fcrLevel?: string;
  error?: string;
}

export default function BuyerPage() {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: balance } = useBalance({
    address,
    token: CONTRACTS.USDFC as `0x${string}`,
  });

  const [amount, setAmount] = useState('1');
  const [recipient, setRecipient] = useState('0x000000000000000000000000000000000000dEaD');
  const [payment, setPayment] = useState<PaymentState>({ step: 'idle' });
  const [settlementStatus, setSettlementStatus] = useState<SettlementStatus | null>(null);

  // Generate random nonce
  const generateNonce = () => {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return toHex(randomBytes);
  };

  // Poll for settlement status
  const pollSettlement = useCallback(async (paymentId: string) => {
    try {
      const status = await facilitator.getSettlement(paymentId);
      setSettlementStatus(status);

      const fcrLevel = status.fcr?.level || 'L0';

      setPayment((prev) => ({
        ...prev,
        fcrLevel,
        txHash: status.transactionCid,
      }));

      // Mark complete when confirmed (but keep polling for FCR)
      if (status.status === 'confirmed') {
        setPayment((prev) => ({ ...prev, step: 'complete' }));
      }

      if (status.status === 'failed') {
        setPayment((prev) => ({ ...prev, step: 'error', error: status.error || 'Settlement failed' }));
        return;
      }

      // Stop polling only when we reach L3 (fully finalized)
      if (fcrLevel === 'L3') {
        return;
      }

      // Continue polling for FCR progression
      setTimeout(() => pollSettlement(paymentId), 2000);
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, []);

  // Main payment flow
  const handlePayment = async () => {
    if (!address || !isConnected) return;

    try {
      // Step 1: Sign
      setPayment({ step: 'signing' });

      const now = Math.floor(Date.now() / 1000);
      const nonce = generateNonce();
      const value = parseEther(amount);

      const message = {
        from: address,
        to: recipient as `0x${string}`,
        value,
        validAfter: BigInt(now - 60),
        validBefore: BigInt(now + 3600),
        nonce: nonce as `0x${string}`,
      };

      const signature = await signTypedDataAsync({
        domain: {
          name: EIP712_DOMAIN.name,
          version: EIP712_DOMAIN.version,
          chainId: BigInt(EIP712_DOMAIN.chainId),
          verifyingContract: EIP712_DOMAIN.verifyingContract as `0x${string}`,
        },
        types: TRANSFER_WITH_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
      });

      setPayment({ step: 'verifying', signature });

      // Step 2: Verify
      const paymentPayload = {
        token: CONTRACTS.USDFC,
        from: address,
        to: recipient,
        value: value.toString(),
        validAfter: now - 60,
        validBefore: now + 3600,
        nonce,
        signature,
      };

      const requirements = {
        payTo: recipient,
        maxAmountRequired: value.toString(),
        tokenAddress: CONTRACTS.USDFC,
        chainId: CHAIN_CONFIG.id,
        resource: '/demo/payment',
        description: 'FCR-x402 Demo Payment',
      };

      const verifyResult = await facilitator.verify(paymentPayload, requirements);

      if (!verifyResult.valid) {
        setPayment({ step: 'error', error: verifyResult.reason || 'Verification failed' });
        return;
      }

      // Step 3: Settle
      setPayment((prev) => ({ ...prev, step: 'settling' }));

      const settleResult = await facilitator.settle(paymentPayload, requirements);

      if (!settleResult.success) {
        setPayment({ step: 'error', error: settleResult.error || 'Settlement failed' });
        return;
      }

      // Step 4: Track
      setPayment({
        step: 'tracking',
        signature,
        paymentId: settleResult.paymentId,
        txHash: settleResult.transactionCid,
        fcrLevel: 'L0',
      });

      pollSettlement(settleResult.paymentId);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setPayment({ step: 'error', error: errorMessage });
    }
  };

  const reset = () => {
    setPayment({ step: 'idle' });
    setSettlementStatus(null);
  };

  const stepColors: Record<PaymentStep, string> = {
    idle: 'zinc',
    signing: 'yellow',
    verifying: 'yellow',
    settling: 'blue',
    tracking: 'blue',
    complete: 'green',
    error: 'red',
  };

  return (
    <div className="min-h-screen">
      <Navigation />

      <main className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Buyer Demo</h1>
        <p className="text-zinc-400 mb-8">
          Sign an EIP-3009 payment and watch it settle through FCR confirmation levels.
        </p>

        {/* Wallet Status */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Wallet</h2>
          {isConnected ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-500">Address</span>
                <span className="font-mono text-sm">{address?.slice(0, 10)}...{address?.slice(-8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">USDFC Balance</span>
                <span className="font-semibold">
                  {balance ? formatEther(balance.value) : '0'} USDFC
                </span>
              </div>
            </div>
          ) : (
            <p className="text-zinc-500">Connect your wallet to continue</p>
          )}
        </div>

        {/* Payment Form */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Payment</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-zinc-500 text-sm mb-1">Amount (USDFC)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-4 py-2 text-white focus:border-blue-500 focus:outline-none"
                disabled={payment.step !== 'idle'}
              />
            </div>
            <div>
              <label className="block text-zinc-500 text-sm mb-1">Recipient</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-4 py-2 text-white font-mono text-sm focus:border-blue-500 focus:outline-none"
                disabled={payment.step !== 'idle'}
              />
            </div>

            {payment.step === 'idle' && (
              <button
                onClick={handlePayment}
                disabled={!isConnected || !amount || parseFloat(amount) <= 0}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-md transition-colors"
              >
                Sign & Pay {amount} USDFC
              </button>
            )}

            {payment.step === 'error' && (
              <button
                onClick={reset}
                className="w-full bg-zinc-700 hover:bg-zinc-600 text-white font-semibold py-3 rounded-md transition-colors"
              >
                Try Again
              </button>
            )}

            {payment.step === 'complete' && (
              <button
                onClick={reset}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-md transition-colors"
              >
                New Payment
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        {payment.step !== 'idle' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Progress</h2>

            {/* Steps */}
            <div className="space-y-3 mb-6">
              {[
                { key: 'signing', label: 'Sign Payment', desc: 'EIP-712 signature in wallet' },
                { key: 'verifying', label: 'Verify Payment', desc: 'Check signature, balance, nonce' },
                { key: 'settling', label: 'Submit Settlement', desc: 'Commit bond, submit on-chain' },
                { key: 'tracking', label: 'Track Confirmation', desc: 'Monitor FCR L0→L3' },
              ].map((s, i) => {
                const steps: PaymentStep[] = ['signing', 'verifying', 'settling', 'tracking', 'complete'];
                const currentIdx = steps.indexOf(payment.step);
                const stepIdx = steps.indexOf(s.key as PaymentStep);
                const isComplete = stepIdx < currentIdx || payment.step === 'complete';
                const isCurrent = stepIdx === currentIdx;

                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        isComplete
                          ? 'bg-green-600 text-white'
                          : isCurrent
                          ? 'bg-blue-600 text-white animate-pulse'
                          : 'bg-zinc-700 text-zinc-500'
                      }`}
                    >
                      {isComplete ? '✓' : i + 1}
                    </div>
                    <div>
                      <div className={isComplete || isCurrent ? 'text-white' : 'text-zinc-500'}>
                        {s.label}
                      </div>
                      <div className="text-zinc-600 text-sm">{s.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FCR Levels */}
            {(payment.step === 'tracking' || payment.step === 'complete') && (
              <div className="border-t border-zinc-800 pt-4">
                <div className="text-zinc-500 text-sm mb-3">FCR Confirmation</div>
                <div className="flex gap-2">
                  {['L0', 'L1', 'L2', 'L3'].map((level) => {
                    const levels = ['L0', 'L1', 'L2', 'L3'];
                    const currentIdx = levels.indexOf(payment.fcrLevel || 'L0');
                    const levelIdx = levels.indexOf(level);
                    const isComplete = levelIdx <= currentIdx;

                    return (
                      <div
                        key={level}
                        className={`flex-1 py-2 text-center rounded-md font-semibold transition-colors ${
                          isComplete
                            ? level === 'L3'
                              ? 'bg-green-600 text-white'
                              : 'bg-blue-600 text-white'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {level}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Transaction Info */}
            {payment.txHash && (
              <div className="border-t border-zinc-800 pt-4 mt-4">
                <div className="text-zinc-500 text-sm mb-1">Transaction</div>
                <a
                  href={`https://calibration.filfox.info/en/tx/${payment.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-blue-400 hover:underline break-all"
                >
                  {payment.txHash}
                </a>
              </div>
            )}

            {/* Error */}
            {payment.step === 'error' && (
              <div className="bg-red-900/20 border border-red-800 rounded-md p-4 mt-4">
                <div className="text-red-400 font-semibold">Error</div>
                <div className="text-red-300 text-sm">{payment.error}</div>
              </div>
            )}

            {/* Success */}
            {payment.step === 'complete' && (
              <div className="bg-green-900/20 border border-green-800 rounded-md p-4 mt-4">
                <div className="text-green-400 font-semibold">Payment Complete!</div>
                <div className="text-green-300 text-sm">
                  {amount} USDFC sent to {recipient.slice(0, 10)}...
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settlement Details */}
        {settlementStatus && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Settlement Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Payment ID</span>
                <span className="font-mono">{settlementStatus.paymentId.slice(0, 16)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Status</span>
                <span className={`font-semibold ${
                  settlementStatus.status === 'confirmed' ? 'text-green-400' : 'text-yellow-400'
                }`}>
                  {settlementStatus.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Attempts</span>
                <span>{settlementStatus.attempts}</span>
              </div>
              {settlementStatus.fcr && (
                <>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">FCR Level</span>
                    <span className="text-blue-400 font-semibold">{settlementStatus.fcr.level}</span>
                  </div>
                  {settlementStatus.fcr.instance !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">F3 Instance</span>
                      <span>{settlementStatus.fcr.instance}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
