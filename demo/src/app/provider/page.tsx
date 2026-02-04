'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Navigation } from '@/components/Navigation';
import { CONTRACTS, CHAIN_CONFIG } from '@/lib/config';
import { facilitator } from '@/lib/facilitator';

interface PaymentLog {
  id: string;
  timestamp: number;
  from: string;
  amount: string;
  status: 'pending' | 'verified' | 'settled' | 'failed';
  paymentId?: string;
  error?: string;
}

export default function ProviderPage() {
  const { address } = useAccount();
  const [logs, setLogs] = useState<PaymentLog[]>([]);
  const [simulatedPayment, setSimulatedPayment] = useState({
    from: '',
    amount: '1',
    signature: '',
    nonce: '',
  });

  // Add log entry
  const addLog = (log: PaymentLog) => {
    setLogs((prev) => [log, ...prev].slice(0, 20));
  };

  // Simulate receiving a payment
  const handleVerifyPayment = async () => {
    if (!address) return;

    const logId = Date.now().toString();
    addLog({
      id: logId,
      timestamp: Date.now(),
      from: simulatedPayment.from || '0xBuyer...',
      amount: simulatedPayment.amount,
      status: 'pending',
    });

    try {
      // Construct payment payload
      const now = Math.floor(Date.now() / 1000);
      const payment = {
        token: CONTRACTS.USDFC,
        from: simulatedPayment.from,
        to: address,
        value: (parseFloat(simulatedPayment.amount) * 1e18).toString(),
        validAfter: now - 60,
        validBefore: now + 3600,
        nonce: simulatedPayment.nonce || '0x' + '0'.repeat(64),
        signature: simulatedPayment.signature || '0x' + '0'.repeat(130),
      };

      const requirements = {
        payTo: address,
        maxAmountRequired: payment.value,
        tokenAddress: CONTRACTS.USDFC,
        chainId: CHAIN_CONFIG.id,
        resource: '/api/data',
        description: 'Provider API access',
      };

      // Verify
      const result = await facilitator.verify(payment, requirements);

      setLogs((prev) =>
        prev.map((l) =>
          l.id === logId
            ? {
                ...l,
                status: result.valid ? 'verified' : 'failed',
                error: result.reason,
              }
            : l
        )
      );

      if (result.valid) {
        // Settle
        const settleResult = await facilitator.settle(payment, requirements);
        setLogs((prev) =>
          prev.map((l) =>
            l.id === logId
              ? {
                  ...l,
                  status: settleResult.success ? 'settled' : 'failed',
                  paymentId: settleResult.paymentId,
                  error: settleResult.error,
                }
              : l
          )
        );
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setLogs((prev) =>
        prev.map((l) =>
          l.id === logId
            ? {
                ...l,
                status: 'failed',
                error: errorMessage,
              }
            : l
        )
      );
    }
  };

  return (
    <div className="min-h-screen">
      <Navigation />

      <main className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Provider Demo</h1>
        <p className="text-zinc-400 mb-8">
          See how a provider receives x402 payments, verifies them, and gets paid.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Provider Info */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Your Provider Endpoint</h2>
            {address ? (
              <div className="space-y-4">
                <div>
                  <div className="text-zinc-500 text-sm mb-1">Payment Address</div>
                  <div className="font-mono text-sm bg-zinc-800 p-2 rounded break-all">
                    {address}
                  </div>
                </div>

                <div>
                  <div className="text-zinc-500 text-sm mb-1">402 Response Example</div>
                  <pre className="font-mono text-xs bg-zinc-800 p-3 rounded overflow-x-auto">
{`{
  "payTo": "${address.slice(0, 10)}...",
  "amount": "1000000000000000000",
  "token": "${CONTRACTS.USDFC.slice(0, 10)}...",
  "chainId": ${CHAIN_CONFIG.id},
  "facilitator": "http://localhost:3402"
}`}
                  </pre>
                </div>

                <div className="bg-green-900/20 border border-green-800 rounded-md p-3">
                  <div className="text-green-400 text-sm font-semibold">Integration Flow</div>
                  <ol className="text-green-300 text-xs mt-2 space-y-1 list-decimal list-inside">
                    <li>Buyer requests resource → Return 402</li>
                    <li>Buyer signs payment → Retries with X-Payment header</li>
                    <li>You call facilitator /verify</li>
                    <li>If valid, deliver data immediately</li>
                    <li>Call /settle to get paid</li>
                  </ol>
                </div>
              </div>
            ) : (
              <p className="text-zinc-500">Connect wallet to see your provider endpoint</p>
            )}
          </div>

          {/* Simulate Payment */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Simulate Incoming Payment</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-zinc-500 text-sm mb-1">Buyer Address</label>
                <input
                  type="text"
                  value={simulatedPayment.from}
                  onChange={(e) =>
                    setSimulatedPayment((p) => ({ ...p, from: e.target.value }))
                  }
                  placeholder="0x..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white font-mono text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-500 text-sm mb-1">Amount (USDFC)</label>
                <input
                  type="number"
                  value={simulatedPayment.amount}
                  onChange={(e) =>
                    setSimulatedPayment((p) => ({ ...p, amount: e.target.value }))
                  }
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-zinc-500 text-sm mb-1">Signature (from buyer)</label>
                <input
                  type="text"
                  value={simulatedPayment.signature}
                  onChange={(e) =>
                    setSimulatedPayment((p) => ({ ...p, signature: e.target.value }))
                  }
                  placeholder="0x..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-white font-mono text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <button
                onClick={handleVerifyPayment}
                disabled={!address || !simulatedPayment.from}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-md transition-colors"
              >
                Verify & Settle
              </button>

              <p className="text-zinc-600 text-xs">
                Note: This simulates receiving a payment. In production, you&apos;d extract the payment
                from the X-Payment header.
              </p>
            </div>
          </div>
        </div>

        {/* Payment Logs */}
        <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Payment Log</h2>
          {logs.length === 0 ? (
            <p className="text-zinc-500 text-sm">No payments received yet</p>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`border rounded-md p-3 ${
                    log.status === 'settled'
                      ? 'border-green-800 bg-green-900/10'
                      : log.status === 'failed'
                      ? 'border-red-800 bg-red-900/10'
                      : 'border-zinc-700 bg-zinc-800/50'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-mono text-sm">
                        {log.from.slice(0, 10)}... → {log.amount} USDFC
                      </div>
                      <div className="text-zinc-500 text-xs">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                    <div
                      className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        log.status === 'settled'
                          ? 'bg-green-600 text-white'
                          : log.status === 'verified'
                          ? 'bg-blue-600 text-white'
                          : log.status === 'failed'
                          ? 'bg-red-600 text-white'
                          : 'bg-yellow-600 text-white'
                      }`}
                    >
                      {log.status}
                    </div>
                  </div>
                  {log.error && <div className="text-red-400 text-xs mt-2">{log.error}</div>}
                  {log.paymentId && (
                    <div className="text-zinc-500 text-xs mt-2 font-mono">
                      Payment ID: {log.paymentId.slice(0, 20)}...
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Code Example */}
        <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Integration Code</h2>
          <pre className="font-mono text-xs bg-zinc-800 p-4 rounded overflow-x-auto text-zinc-300">
{`// Express.js example
app.get('/api/data', async (req, res) => {
  const payment = req.headers['x-payment'];

  if (!payment) {
    return res.status(402).json({
      payTo: '${address || '0xYourWallet'}',
      amount: '1000000000000000000',
      token: '${CONTRACTS.USDFC}',
      chainId: ${CHAIN_CONFIG.id},
      facilitator: 'http://localhost:3402'
    });
  }

  // Verify with facilitator
  const { valid } = await fetch('http://localhost:3402/verify', {
    method: 'POST',
    body: JSON.stringify({
      payment: JSON.parse(payment),
      requirements: { payTo: MY_WALLET, ... }
    })
  }).then(r => r.json());

  if (!valid) {
    return res.status(402).json({ error: 'Invalid payment' });
  }

  // Deliver data immediately
  res.json({ data: 'Your premium content here' });

  // Settle in background
  fetch('http://localhost:3402/settle', { ... });
});`}
          </pre>
        </div>
      </main>
    </div>
  );
}
