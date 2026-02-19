'use client';

import { useState, useEffect } from 'react';
import { Navigation } from '@/components/Navigation';
import { CONTRACTS } from '@/lib/config';
import { facilitator, type AgentMetadata, type AgentStatus } from '@/lib/facilitator';

export default function AgentPage() {
  const [metadata, setMetadata] = useState<AgentMetadata | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = async () => {
    try {
      const [metadataData, statusData] = await Promise.all([
        facilitator.getAgentMetadata().catch(() => null),
        facilitator.getAgentStatus().catch(() => null),
      ]);
      setMetadata(metadataData);
      setStatus(statusData);
      setError(null);
      setLastUpdate(new Date());
    } catch (err) {
      setError('Failed to connect to facilitator');
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen">
      <Navigation />

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">ERC-8004 Agent Identity</h1>
            <p className="text-zinc-400">On-chain agent registration and reputation</p>
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
          {/* Registration Status */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${status?.registered ? 'bg-green-400' : 'bg-yellow-400'}`}></span>
              Registration Status
            </h2>
            {status ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">ERC-8004 Enabled</span>
                  <span className={status.enabled ? 'text-green-400' : 'text-red-400'}>
                    {status.enabled ? 'Yes' : 'No'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Registered</span>
                  <span className={status.registered ? 'text-green-400' : 'text-yellow-400'}>
                    {status.registered ? 'Yes' : 'No'}
                  </span>
                </div>
                {status.agentId !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Agent ID</span>
                    <span className="text-blue-400 font-bold text-xl">#{status.agentId}</span>
                  </div>
                )}
                {status.message && (
                  <div className="text-zinc-400 text-sm mt-2">{status.message}</div>
                )}
              </div>
            ) : (
              <div className="text-zinc-500">Loading...</div>
            )}
          </div>

          {/* Reputation Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Reputation</h2>
            {status?.reputation ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Feedback Count</span>
                  <span className="text-purple-400 font-bold text-xl">{status.reputation.count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Average Score</span>
                  <span className={`font-bold text-xl ${
                    status.reputation.averageValue > 0 ? 'text-green-400' :
                    status.reputation.averageValue < 0 ? 'text-red-400' : 'text-zinc-400'
                  }`}>
                    {status.reputation.averageValue > 0 ? '+' : ''}{status.reputation.averageValue}
                  </span>
                </div>
                {status.reputation.count === 0 && (
                  <div className="text-zinc-500 text-sm">No feedback yet</div>
                )}
              </div>
            ) : (
              <div className="text-zinc-500">
                {status?.registered ? 'Loading...' : 'Not registered'}
              </div>
            )}
          </div>

          {/* Validation Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Validation</h2>
            {status?.validation ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Validations</span>
                  <span className="text-cyan-400 font-bold text-xl">{status.validation.count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Average Response</span>
                  <span className="text-cyan-400 font-bold">{status.validation.avgResponse}/100</span>
                </div>
                {status.validation.count === 0 && (
                  <div className="text-zinc-500 text-sm">No validations yet</div>
                )}
              </div>
            ) : (
              <div className="text-zinc-500">
                {status?.registered ? 'Loading...' : 'Not registered'}
              </div>
            )}
          </div>

          {/* Agent Metadata */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 md:col-span-2">
            <h2 className="text-lg font-semibold mb-4">Agent Metadata</h2>
            {metadata ? (
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-zinc-500 text-sm">Name</div>
                    <div className="font-semibold">{metadata.name}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-sm">Type</div>
                    <div className="text-blue-400">{metadata.type}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-sm">Version</div>
                    <div>{metadata.version}</div>
                  </div>
                  <div>
                    <div className="text-zinc-500 text-sm">Chain</div>
                    <div>{metadata.chain.name} ({metadata.chain.id})</div>
                  </div>
                </div>
                <div>
                  <div className="text-zinc-500 text-sm mb-1">Description</div>
                  <div className="text-zinc-300 text-sm">{metadata.description}</div>
                </div>
                <div>
                  <div className="text-zinc-500 text-sm mb-2">Capabilities</div>
                  <div className="flex flex-wrap gap-2">
                    {metadata.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="px-2 py-1 bg-blue-900/30 border border-blue-800 rounded text-blue-400 text-xs"
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-zinc-500">Loading...</div>
            )}
          </div>

          {/* Risk Limits */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Risk Limits</h2>
            {metadata ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max/Transaction</span>
                  <span>${metadata.limits.maxPerTransaction}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max Pending</span>
                  <span>${metadata.limits.maxPendingPerWallet}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Daily Limit</span>
                  <span>${metadata.limits.dailyLimitPerWallet}</span>
                </div>
              </div>
            ) : (
              <div className="text-zinc-500">Loading...</div>
            )}
          </div>
        </div>

        {/* ERC-8004 Registry Contracts */}
        <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">ERC-8004 Registry Contracts</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div>
              <div className="text-zinc-500 text-sm mb-1">Identity Registry</div>
              <a
                href={`https://calibration.filfox.info/en/address/${CONTRACTS.ERC8004_IDENTITY}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-blue-400 hover:underline break-all"
              >
                {CONTRACTS.ERC8004_IDENTITY}
              </a>
              {status?.registryVersions?.identity && (
                <div className="text-zinc-600 text-xs mt-1">v{status.registryVersions.identity}</div>
              )}
            </div>
            <div>
              <div className="text-zinc-500 text-sm mb-1">Reputation Registry</div>
              <a
                href={`https://calibration.filfox.info/en/address/${CONTRACTS.ERC8004_REPUTATION}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-blue-400 hover:underline break-all"
              >
                {CONTRACTS.ERC8004_REPUTATION}
              </a>
              {status?.registryVersions?.reputation && (
                <div className="text-zinc-600 text-xs mt-1">v{status.registryVersions.reputation}</div>
              )}
            </div>
            <div>
              <div className="text-zinc-500 text-sm mb-1">Validation Registry</div>
              <a
                href={`https://calibration.filfox.info/en/address/${CONTRACTS.ERC8004_VALIDATION}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-blue-400 hover:underline break-all"
              >
                {CONTRACTS.ERC8004_VALIDATION}
              </a>
              {status?.registryVersions?.validation && (
                <div className="text-zinc-600 text-xs mt-1">v{status.registryVersions.validation}</div>
              )}
            </div>
          </div>
        </div>

        {/* What is ERC-8004 */}
        <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">What is ERC-8004?</h2>
          <div className="text-zinc-400 space-y-3 text-sm">
            <p>
              <strong className="text-white">ERC-8004</strong> is a standard for trustless agent discovery and reputation
              in decentralized systems. It provides three registries:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>
                <strong className="text-blue-400">Identity Registry</strong> - Agents register with metadata,
                capabilities, and endpoints. Each agent receives a unique NFT (Agent ID).
              </li>
              <li>
                <strong className="text-purple-400">Reputation Registry</strong> - Clients can give feedback
                to agents. Feedback is on-chain and immutable.
              </li>
              <li>
                <strong className="text-cyan-400">Validation Registry</strong> - Third-party validators can
                validate agents (e.g., security audits, compliance checks).
              </li>
            </ul>
            <p className="mt-4">
              This facilitator is registered as <strong className="text-green-400">Agent #{status?.agentId ?? '?'}</strong> on
              Filecoin Calibration, enabling trustless discovery and reputation tracking.
            </p>
          </div>
        </div>

        {/* Raw Metadata JSON */}
        {metadata && (
          <div className="mt-8 bg-zinc-900 border border-zinc-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Raw Agent Metadata</h2>
            <pre className="font-mono text-xs text-zinc-400 overflow-x-auto bg-zinc-950 p-4 rounded">
              {JSON.stringify(metadata, null, 2)}
            </pre>
            <div className="mt-3 text-zinc-500 text-xs">
              This JSON is served at{' '}
              <a
                href="http://localhost:3402/agent/agent-metadata"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                /agent/agent-metadata
              </a>
              {' '}and{' '}
              <a
                href="http://localhost:3402/.well-known/erc8004-agent.json"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                /.well-known/erc8004-agent.json
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
