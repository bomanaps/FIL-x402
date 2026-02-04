'use client';

import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import { useEffect, useState } from 'react';
import { facilitator, type HealthStatus } from '@/lib/facilitator';

export default function Home() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    facilitator
      .getHealth()
      .then(setHealth)
      .catch(() => setError('Facilitator not reachable. Start it with: npm run dev'));
  }, []);

  return (
    <div className="min-h-screen">
      <Navigation />

      <main className="max-w-6xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">
            <span className="text-blue-400">FCR-x402</span> Demo
          </h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            Instant payments on Filecoin using the x402 HTTP payment protocol and Fast Confirmation
            Rule (FCR). Sub-minute finality backed by F3 consensus.
          </p>
        </div>

        {/* Status Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-12">
          <h2 className="text-lg font-semibold mb-4">Facilitator Status</h2>
          {error ? (
            <div className="text-red-400 bg-red-900/20 p-4 rounded-md">{error}</div>
          ) : health ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-zinc-500 text-sm">Status</div>
                <div className="text-green-400 font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                  {health.status}
                </div>
              </div>
              <div>
                <div className="text-zinc-500 text-sm">Chain</div>
                <div className="text-white font-semibold">
                  {health.chain.name} ({health.chain.id})
                </div>
              </div>
              <div>
                <div className="text-zinc-500 text-sm">Pending Settlements</div>
                <div className="text-white font-semibold">{health.settlements.pending}</div>
              </div>
              <div>
                <div className="text-zinc-500 text-sm">Max Per Tx</div>
                <div className="text-white font-semibold">
                  ${(parseInt(health.limits.maxPerTransaction) / 1e18).toFixed(2)}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-zinc-500">Loading...</div>
          )}
        </div>

        {/* Demo Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          <Link
            href="/buyer"
            className="group bg-zinc-900 border border-zinc-800 rounded-lg p-6 hover:border-blue-500 transition-colors"
          >
            <div className="text-3xl mb-4">💳</div>
            <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-400 transition-colors">
              Buyer Demo
            </h3>
            <p className="text-zinc-400 text-sm">
              Connect your wallet, sign an EIP-3009 payment, and watch it settle through FCR levels
              L0→L1→L2→L3.
            </p>
          </Link>

          <Link
            href="/provider"
            className="group bg-zinc-900 border border-zinc-800 rounded-lg p-6 hover:border-green-500 transition-colors"
          >
            <div className="text-3xl mb-4">🏪</div>
            <h3 className="text-xl font-semibold mb-2 group-hover:text-green-400 transition-colors">
              Provider Demo
            </h3>
            <p className="text-zinc-400 text-sm">
              See how a provider receives 402 payments, verifies them via the facilitator, and
              delivers data.
            </p>
          </Link>

          <Link
            href="/dashboard"
            className="group bg-zinc-900 border border-zinc-800 rounded-lg p-6 hover:border-purple-500 transition-colors"
          >
            <div className="text-3xl mb-4">📊</div>
            <h3 className="text-xl font-semibold mb-2 group-hover:text-purple-400 transition-colors">
              Dashboard
            </h3>
            <p className="text-zinc-400 text-sm">
              Monitor FCR status, F3 consensus state, bond exposure, and settlement history in
              real-time.
            </p>
          </Link>
        </div>

        {/* How It Works */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold mb-8 text-center">How x402 Payments Work</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 font-mono text-sm">
            <pre className="text-zinc-400 overflow-x-auto">
              {`
  BUYER                         PROVIDER                      FACILITATOR
    │                               │                               │
    │── GET /api/resource ─────────▶│                               │
    │◀── 402 PaymentRequired ───────│                               │
    │                               │                               │
    │  [signs EIP-3009 off-chain]   │                               │
    │                               │                               │
    │── GET + X-Payment header ────▶│                               │
    │                               │── POST /verify ──────────────▶│
    │                               │◀── { valid: true } ───────────│
    │◀── 200 + Data ────────────────│                               │
    │                               │── POST /settle ──────────────▶│
    │                               │   [commits bond]              │
    │                               │   [submits tx on-chain]       │
    │                               │   [tracks FCR L0 → L3]        │
    │                               │◀── { paymentId, status } ─────│
`}
            </pre>
          </div>
        </div>

        {/* FCR Levels */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-6 text-center">FCR Confirmation Levels</h2>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { level: 'L0', name: 'Submitted', color: 'zinc', desc: 'Transaction broadcast' },
              { level: 'L1', name: 'Included', color: 'yellow', desc: 'In tipset' },
              { level: 'L2', name: 'FCR Safe', color: 'blue', desc: 'F3 PREPARE/COMMIT' },
              { level: 'L3', name: 'Finalized', color: 'green', desc: 'F3 certificate' },
            ].map((l) => (
              <div
                key={l.level}
                className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-center`}
              >
                <div className={`text-2xl font-bold text-${l.color}-400`}>{l.level}</div>
                <div className="text-white font-semibold">{l.name}</div>
                <div className="text-zinc-500 text-sm">{l.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 text-center text-zinc-500 text-sm">
          <p>
            Deployed on Filecoin Calibration Testnet • USDFC Token •{' '}
            <a
              href="https://github.com/coinbase/x402"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              x402 Protocol
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
