'use client';

import { useState } from 'react';
import { useAgentIdentity, type AgentRegistration } from '@/hooks/useAgentIdentity';

interface Props {
  onSuccess?: () => void;
}

export function AgentRegistrationForm({ onSuccess }: Props) {
  const { register, isRegistering, isConfirmed, error, txHash } = useAgentIdentity();

  const [formData, setFormData] = useState<AgentRegistration>({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: '',
    description: '',
    image: '',
    x402Support: true,
    active: true,
  });

  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError('Agent name is required');
      return;
    }

    if (!formData.description.trim()) {
      setFormError('Description is required');
      return;
    }

    try {
      await register(formData);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  if (isConfirmed) {
    onSuccess?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Agent Name *
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="My AI Agent"
          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          disabled={isRegistering}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Description *
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Describe what your agent does..."
          rows={3}
          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
          disabled={isRegistering}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-2">
          Image URL (optional)
        </label>
        <input
          type="url"
          value={formData.image}
          onChange={(e) => setFormData({ ...formData, image: e.target.value })}
          placeholder="https://example.com/agent-logo.png"
          className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          disabled={isRegistering}
        />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.x402Support}
            onChange={(e) => setFormData({ ...formData, x402Support: e.target.checked })}
            className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
            disabled={isRegistering}
          />
          <span className="text-sm text-zinc-300">Supports x402 payments</span>
        </label>
      </div>

      {(formError || error) && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4">
          <p className="text-red-400 text-sm">{formError || error?.message}</p>
        </div>
      )}

      {txHash && !isConfirmed && (
        <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4">
          <p className="text-blue-400 text-sm">
            Transaction submitted. Waiting for confirmation...
          </p>
          <a
            href={`https://calibration.filfox.info/en/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 text-xs hover:underline mt-1 block"
          >
            View on explorer
          </a>
        </div>
      )}

      {isConfirmed && (
        <div className="bg-green-900/20 border border-green-800 rounded-lg p-4">
          <p className="text-green-400 text-sm">
            Registration successful! Your Agent ID has been minted.
          </p>
        </div>
      )}

      <button
        type="submit"
        disabled={isRegistering}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
      >
        {isRegistering ? 'Registering...' : 'Register Agent Identity'}
      </button>

      <p className="text-zinc-500 text-xs text-center">
        Registration requires a transaction on Filecoin Calibration. You will need tFIL for gas.
      </p>
    </form>
  );
}
