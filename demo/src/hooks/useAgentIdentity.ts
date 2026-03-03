'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { decodeEventLog } from 'viem';
import { CONTRACTS } from '@/lib/config';
import { IDENTITY_REGISTRY_ABI } from '@/lib/abis/identityRegistry';

export interface AgentRegistration {
  type: string;
  name: string;
  description: string;
  image?: string;
  services?: Array<{
    name: string;
    endpoint: string;
    version?: string;
  }>;
  x402Support?: boolean;
  active?: boolean;
  capabilities?: string[];
}

function buildRegistrationURI(data: AgentRegistration): string {
  const registration = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: data.name,
    description: data.description,
    image: data.image || '',
    services: data.services || [],
    x402Support: data.x402Support ?? true,
    active: data.active ?? true,
  };

  const json = JSON.stringify(registration);
  const base64 = btoa(json);
  return `data:application/json;base64,${base64}`;
}

export function useAgentIdentity() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  const [registeredAgentId, setRegisteredAgentId] = useState<number | null>(null);

  // Check if user has any Agent IDs by balance
  const { data: balance, isLoading: isLoadingBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACTS.ERC8004_IDENTITY as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Get token URI for the Agent ID (if we have one)
  const { data: tokenURI, isLoading: isLoadingURI, refetch: refetchTokenURI } = useReadContract({
    address: CONTRACTS.ERC8004_IDENTITY as `0x${string}`,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'tokenURI',
    args: registeredAgentId !== null ? [BigInt(registeredAgentId)] : undefined,
    query: {
      enabled: registeredAgentId !== null,
    },
  });

  // Write contract for registration
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError, reset } = useWriteContract();

  // Wait for transaction
  const { isLoading: isConfirming, isSuccess: isConfirmed, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Parse agentId from transaction receipt
  useEffect(() => {
    if (receipt && receipt.logs) {
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: IDENTITY_REGISTRY_ABI,
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName === 'Registered') {
            const args = decoded.args as { agentId: bigint; agentURI: string; owner: string };
            setRegisteredAgentId(Number(args.agentId));
            break;
          }
        } catch {
          // Not our event, skip
        }
      }
    }
  }, [receipt]);

  // Refetch tokenURI when agentId changes
  useEffect(() => {
    if (registeredAgentId !== null) {
      refetchTokenURI();
    }
  }, [registeredAgentId, refetchTokenURI]);

  // Try to find existing agentId by querying past Registered events
  useEffect(() => {
    async function findExistingAgent() {
      if (!address || !publicClient || registeredAgentId !== null) return;
      if (balance === undefined || balance === 0n) return;

      try {
        // Get current block and search last 500k blocks (roughly 2 weeks on Filecoin)
        const currentBlock = await publicClient.getBlockNumber();
        const fromBlock = currentBlock > 500000n ? currentBlock - 500000n : 0n;

        const logs = await publicClient.getLogs({
          address: CONTRACTS.ERC8004_IDENTITY as `0x${string}`,
          event: {
            type: 'event',
            name: 'Registered',
            inputs: [
              { type: 'uint256', name: 'agentId', indexed: true },
              { type: 'string', name: 'agentURI', indexed: false },
              { type: 'address', name: 'owner', indexed: true },
            ],
          },
          args: {
            owner: address,
          },
          fromBlock: fromBlock,
          toBlock: 'latest',
        });

        if (logs.length > 0) {
          const lastLog = logs[logs.length - 1];
          const agentId = lastLog.args.agentId;
          if (agentId !== undefined) {
            setRegisteredAgentId(Number(agentId));
          }
        }
      } catch (err) {
        console.error('Failed to fetch existing agent via events, trying direct query:', err);

        // Fallback: Try to get agentId by iterating through possible IDs
        // This is a workaround - check if address owns token 0, 1, 2, etc.
        try {
          for (let i = 0; i < 100; i++) {
            const owner = await publicClient.readContract({
              address: CONTRACTS.ERC8004_IDENTITY as `0x${string}`,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'ownerOf',
              args: [BigInt(i)],
            });

            if (owner && (owner as string).toLowerCase() === address.toLowerCase()) {
              setRegisteredAgentId(i);
              return;
            }
          }
        } catch (fallbackErr) {
          console.error('Fallback query also failed:', fallbackErr);
        }
      }
    }

    findExistingAgent();
  }, [address, publicClient, balance, registeredAgentId]);

  const register = async (data: AgentRegistration) => {
    if (!address) throw new Error('Wallet not connected');

    const uri = buildRegistrationURI(data);

    writeContract({
      address: CONTRACTS.ERC8004_IDENTITY as `0x${string}`,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [uri],
    });
  };

  const refetch = async () => {
    await refetchBalance();
    if (registeredAgentId !== null) {
      await refetchTokenURI();
    }
  };

  const hasAgentId = (balance !== undefined && balance > 0n) || registeredAgentId !== null;
  const isLoading = isLoadingBalance || isLoadingURI;
  const isRegistering = isWritePending || isConfirming;

  return {
    // Connection state
    isConnected,
    address,

    // Agent state
    hasAgentId,
    agentId: registeredAgentId,
    tokenURI,

    // Loading states
    isLoading,
    isRegistering,
    isConfirmed,

    // Actions
    register,
    refetch,
    reset,

    // Errors
    error: writeError,
    txHash,
  };
}
