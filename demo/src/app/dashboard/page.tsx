'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Navigation } from '@/components/Navigation';
import { CONTRACTS } from '@/lib/config';
import { facilitator, type FCRStatus, type HealthStatus, type BuyerAccount } from '@/lib/facilitator';

const F3_PHASE_NAMES: Record<number, string> = {
  0: 'INITIAL',
  1: 'QUALITY',
  2: 'CONVERGE',
  3: 'PREPARE',
  4: 'COMMIT',
  5: 'DECIDE',
  6: 'TERMINATED',
};

export default function DashboardPage() {
  const { address } = useAccount();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [fcr, setFcr] = useState<FCRStatus | null>(null);
  const [escrow, setEscrow] = useState<BuyerAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Fetch all data
  const fetchData = async () => {
    try {
      const [healthData, fcrData] = await Promise.all([
        facilitator.getHealth(),
        facilitator.getFCRStatus().catch(() => null),
      ]);
      setHealth(healthData);
      setFcr(fcrData);
      setError(null);
      setLastUpdate(new Date());

      if (address) {
        const escrowData = await facilitator.getBuyerAccount(address).catch(() => null);
        setEscrow(escrowData);
      }
    } catch (err) {
      setError('Failed to connect to facilitator');
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [address]);

  return (
    <div className="min-h-screen">
      <Navigation />

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-zinc-400">Real-time facilitator monitoring</p>
          </div>
          {lastUpdate && (
            <div className="text-zinc-500 text-sm">
              Last update: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-6">
            <div className="text-red-400">{error}</div>
            <p className="text-red-300 text-sm mt-1">
              Make sure the facilitator is running: <code>npm run dev</code>
            </p>
          </div>
        )}

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Facilitator Status */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${health ? 'bg-green-400' : 'bg-red-400'}`}></span>
              Facilitator
            </h2>
            {health ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Status</span>
                  <span className="text-green-400 font-semibold">{health.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Chain</span>
                  <span>{health.chain.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Chain ID</span>
                  <span>{health.chain.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Connected</span>
                  <span className={health.chain.connected ? 'text-green-400' : 'text-red-400'}>
                    {health.chain.connected ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-zinc-500">Loading...</div>
            )}
          </div>

          {/* F3/FCR Status */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">F3 Consensus (FCR)</h2>
            {fcr ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Running</span>
                  <span className={fcr.running ? 'text-green-400' : 'text-yellow-400'}>
                    {fcr.running ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Current Level</span>
                  <span className="text-blue-400 font-bold text-lg">{fcr.level}</span>
                </div>
                {fcr.instance !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Instance</span>
                    <span>{fcr.instance}</span>
                  </div>
                )}
                {fcr.round !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Round</span>
                    <span>{fcr.round}</span>
                  </div>
                )}
                {fcr.phase !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Phase</span>
                    <span className="text-purple-400">
                      {F3_PHASE_NAMES[fcr.phase] || fcr.phase}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-zinc-500">
                <p>F3 data not available</p>
                <p className="text-xs mt-2">Requires Lotus node with F3 enabled</p>
              </div>
            )}
          </div>

          {/* Settlements */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Settlements</h2>
            {health ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Pending</span>
                  <span className="text-yellow-400 font-bold text-xl">
                    {health.settlements.pending}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Pending Amount</span>
                  <span>
                    {(parseInt(health.settlements.totalPendingAmount) / 1e18).toFixed(2)} USDFC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Wallets with Pending</span>
                  <span>{health.settlements.walletsWithPending}</span>
                </div>
              </div>
            ) : (
              <div className="text-zinc-500">Loading...</div>
            )}
          </div>

          {/* Risk Limits */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Risk Limits</h2>
            {health ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max Per Transaction</span>
                  <span>${(parseInt(health.limits.maxPerTransaction) / 1e18).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max Pending/Wallet</span>
                  <span>${(parseInt(health.limits.maxPendingPerWallet) / 1e18).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Daily Limit/Wallet</span>
                  <span>${(parseInt(health.limits.dailyLimitPerWallet) / 1e18).toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="text-zinc-500">Loading...</div>
            )}
          </div>

          {/* Contracts */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Deployed Contracts</h2>
            <div className="space-y-3">
              <div>
                <div className="text-zinc-500 text-sm">USDFC Token</div>
                <a
                  href={`https://calibration.filfox.info/en/address/${CONTRACTS.USDFC}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-400 hover:underline break-all"
                >
                  {CONTRACTS.USDFC}
                </a>
              </div>
              <div>
                <div className="text-zinc-500 text-sm">BondedFacilitator</div>
                <a
                  href={`https://calibration.filfox.info/en/address/${CONTRACTS.BONDED_FACILITATOR}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-400 hover:underline break-all"
                >
                  {CONTRACTS.BONDED_FACILITATOR}
                </a>
              </div>
              <div>
                <div className="text-zinc-500 text-sm">DeferredPaymentEscrow</div>
                <a
                  href={`https://calibration.filfox.info/en/address/${CONTRACTS.DEFERRED_ESCROW}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-400 hover:underline break-all"
                >
                  {CONTRACTS.DEFERRED_ESCROW}
                </a>
              </div>
            </div>
          </div>

          {/* Your Escrow Account */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Your Escrow Account</h2>
            {address ? (
              escrow ? (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Balance</span>
                    <span className="text-green-400 font-bold">
                      {(parseInt(escrow.balance) / 1e18).toFixed(2)} USDFC
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Thawing</span>
                    <span>{(parseInt(escrow.thawingAmount) / 1e18).toFixed(2)} USDFC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Vouchers</span>
                    <span>{escrow.voucherCount}</span>
                  </div>
                  {escrow.thawEndTime > 0 && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Thaw Ends</span>
                      <span>{new Date(escrow.thawEndTime * 1000).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-zinc-500">No escrow account found</div>
              )
            ) : (
              <div className="text-zinc-500">Connect wallet to view</div>
            )}
          </div>
        </div>

        {/* FCR Level Explanation */}
        <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">FCR Confirmation Levels</h2>
          <div className="grid md:grid-cols-5 gap-4">
            {[
              { level: 'L0', name: 'Mempool', color: 'zinc', desc: 'Transaction submitted', latency: '0s' },
              { level: 'L1', name: 'Included', color: 'yellow', desc: 'In tipset', latency: '~30s' },
              { level: 'L2', name: 'FCR Safe', color: 'blue', desc: 'F3 PREPARE/COMMIT phase', latency: '~45s' },
              { level: 'L3', name: 'Finalized', color: 'green', desc: 'F3 certificate issued', latency: '~60s' },
              { level: 'LB', name: 'Legacy', color: 'purple', desc: '900 epochs deep', latency: '~7.5h' },
            ].map((l) => (
              <div key={l.level} className="text-center">
                <div className={`text-2xl font-bold text-${l.color}-400 mb-1`}>{l.level}</div>
                <div className="text-white font-semibold text-sm">{l.name}</div>
                <div className="text-zinc-500 text-xs">{l.desc}</div>
                <div className="text-zinc-600 text-xs mt-1">{l.latency}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Architecture */}
        <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Architecture</h2>
          <pre className="font-mono text-xs text-zinc-400 overflow-x-auto">
{`
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FCR-x402 ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐         ┌──────────────┐         ┌──────────────────────┐   │
│   │  BUYER   │────────▶│   PROVIDER   │────────▶│     FACILITATOR      │   │
│   │ (wallet) │         │  (your API)  │         │   (this service)     │   │
│   └──────────┘         └──────────────┘         └──────────────────────┘   │
│        │                      │                           │                │
│        │ EIP-3009             │ POST /verify              │ F3 Monitor     │
│        │ signature            │ POST /settle              │ Bond Contract  │
│        │                      │                           │ Risk Engine    │
│        │                      │                           │                │
│        └──────────────────────┴───────────────────────────┘                │
│                                      │                                      │
│                                      ▼                                      │
│                          ┌──────────────────────┐                          │
│                          │   FILECOIN NETWORK   │                          │
│                          │   (Calibration)      │                          │
│                          │                      │                          │
│                          │  ┌────────────────┐  │                          │
│                          │  │     USDFC      │  │                          │
│                          │  │  EIP-3009 Token│  │                          │
│                          │  └────────────────┘  │                          │
│                          │                      │                          │
│                          │  ┌────────────────┐  │                          │
│                          │  │ BondedFacil.   │  │                          │
│                          │  │ Collateral     │  │                          │
│                          │  └────────────────┘  │                          │
│                          │                      │                          │
│                          │  ┌────────────────┐  │                          │
│                          │  │ DeferredEscrow │  │                          │
│                          │  │ Vouchers       │  │                          │
│                          │  └────────────────┘  │                          │
│                          │                      │                          │
│                          │  ┌────────────────┐  │                          │
│                          │  │ F3 Consensus   │  │                          │
│                          │  │ ~30s finality  │  │                          │
│                          │  └────────────────┘  │                          │
│                          └──────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────────────┘
`}
          </pre>
        </div>
      </main>
    </div>
  );
}
