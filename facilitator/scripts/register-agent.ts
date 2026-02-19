#!/usr/bin/env npx tsx
/**
 * Register Facilitator as ERC-8004 Agent
 *
 * This script registers the facilitator on the ERC-8004 Identity Registry.
 * Run once after deploying ERC-8004 contracts.
 *
 * Usage:
 *   npx tsx scripts/register-agent.ts
 *
 * After successful registration, add the returned agent ID to .env:
 *   ERC8004_AGENT_ID=<returned_id>
 */

import { ethers } from 'ethers';

// Environment variables are loaded via tsx --env-file .env

const IDENTITY_REGISTRY_ABI = [
  'function register(string memory agentURI) external returns (uint256 agentId)',
  'function register() external returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function tokenURI(uint256 tokenId) external view returns (string memory)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

async function main() {
  console.log('='.repeat(60));
  console.log('ERC-8004 Agent Registration');
  console.log('='.repeat(60));

  // Validate environment
  const requiredEnvVars = [
    'LOTUS_ENDPOINT',
    'FACILITATOR_PRIVATE_KEY',
    'ERC8004_IDENTITY_REGISTRY',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  const endpoint = process.env.LOTUS_ENDPOINT!;
  const privateKey = process.env.FACILITATOR_PRIVATE_KEY!;
  const identityRegistry = process.env.ERC8004_IDENTITY_REGISTRY!;
  const chainId = parseInt(process.env.CHAIN_ID || '314159');

  // Generate agent URI (points to our /agent/agent-metadata endpoint)
  const port = process.env.PORT || '3402';
  const host = process.env.HOST || 'localhost';
  const agentURI = process.env.AGENT_METADATA_URI || `http://${host}:${port}/agent/agent-metadata`;

  console.log(`\nConfiguration:`);
  console.log(`  RPC Endpoint: ${endpoint}`);
  console.log(`  Chain ID: ${chainId}`);
  console.log(`  Identity Registry: ${identityRegistry}`);
  console.log(`  Agent URI: ${agentURI}`);

  // Connect to network
  const provider = new ethers.JsonRpcProvider(endpoint, {
    chainId,
    name: chainId === 314159 ? 'calibration' : 'filecoin',
  });

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`\n  Wallet: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance: ${ethers.formatEther(balance)} FIL`);

  if (balance === 0n) {
    console.error('\nError: Wallet has no balance. Fund it with tFIL first.');
    process.exit(1);
  }

  // Check if already registered
  const contract = new ethers.Contract(identityRegistry, IDENTITY_REGISTRY_ABI, wallet);

  const existingBalance = await contract.balanceOf(wallet.address);
  if (existingBalance > 0n) {
    console.log(`\nWarning: This wallet already owns ${existingBalance} agent(s).`);
    console.log('You may already be registered. Check your existing agent IDs.');

    // Try to find existing agent ID by checking recent events
    const filter = contract.filters.Registered(null, null, wallet.address);
    try {
      const events = await contract.queryFilter(filter, -10000); // Last 10000 blocks
      if (events.length > 0) {
        const latestEvent = events[events.length - 1];
        const agentId = (latestEvent as any).args?.agentId;
        if (agentId !== undefined) {
          console.log(`\nExisting Agent ID found: ${agentId}`);
          console.log(`\nAdd to your .env file:`);
          console.log(`ERC8004_AGENT_ID=${agentId}`);
          process.exit(0);
        }
      }
    } catch (e) {
      // Event query might not be supported, continue with registration
    }

    const proceed = process.argv.includes('--force');
    if (!proceed) {
      console.log('\nTo register a new agent anyway, run with --force flag.');
      process.exit(0);
    }
  }

  // Register agent
  console.log('\nRegistering agent...');
  console.log('Note: Filecoin has ~30s block times. This may take 1-2 minutes.\n');

  try {
    const tx = await contract['register(string)'](agentURI);
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log('Waiting for confirmation...');

    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      console.error('Transaction failed!');
      process.exit(1);
    }

    // Parse Registered event
    let agentId: number | undefined;
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed?.name === 'Registered') {
          agentId = Number(parsed.args.agentId);
          break;
        }
      } catch {
        // Not our event
      }
    }

    if (agentId === undefined) {
      console.error('Could not find Registered event in transaction logs');
      process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('REGISTRATION SUCCESSFUL');
    console.log('='.repeat(60));
    console.log(`Agent ID: ${agentId}`);
    console.log(`Owner: ${wallet.address}`);
    console.log(`Agent URI: ${agentURI}`);
    console.log(`Transaction: ${tx.hash}`);
    console.log('');
    console.log('Add to your .env file:');
    console.log(`ERC8004_AGENT_ID=${agentId}`);
    console.log('');
    console.log('Then restart the facilitator to enable ERC-8004 features.');

  } catch (error: any) {
    console.error('\nRegistration failed:', error.message || error);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
