import { ethers } from 'ethers';
import type { Config } from '../types/config.js';

// ERC-8004 Contract ABIs (minimal interfaces for our use case)
const IDENTITY_REGISTRY_ABI = [
  'function register() external returns (uint256 agentId)',
  'function register(string memory agentURI) external returns (uint256 agentId)',
  'function getMetadata(uint256 agentId, string memory metadataKey) external view returns (bytes memory)',
  'function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue) external',
  'function getAgentWallet(uint256 agentId) external view returns (address)',
  'function setAgentURI(uint256 agentId, string calldata newURI) external',
  'function tokenURI(uint256 tokenId) external view returns (string memory)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function balanceOf(address owner) external view returns (uint256)',
  'function getVersion() external pure returns (string memory)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

const REPUTATION_REGISTRY_ABI = [
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string calldata tag1, string calldata tag2, string calldata endpoint, string calldata feedbackURI, bytes32 feedbackHash) external',
  'function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2) external view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  'function getClients(uint256 agentId) external view returns (address[] memory)',
  'function getLastIndex(uint256 agentId, address clientAddress) external view returns (uint64)',
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) external view returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)',
  'function getIdentityRegistry() external view returns (address)',
  'function getVersion() external pure returns (string memory)',
];

const VALIDATION_REGISTRY_ABI = [
  'function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external',
  'function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate)',
  'function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag) external view returns (uint64 count, uint8 avgResponse)',
  'function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory)',
  'function getIdentityRegistry() external view returns (address)',
  'function getVersion() external pure returns (string memory)',
];

export interface ERC8004Config {
  enabled: boolean;
  identityRegistry?: string;
  reputationRegistry?: string;
  validationRegistry?: string;
  agentId?: number;
}

export interface AgentMetadata {
  name: string;
  description: string;
  version: string;
  type: string;
  capabilities: string[];
  endpoint: string;
  chain: {
    id: number;
    name: string;
  };
  contracts: {
    bond?: string;
    escrow?: string;
  };
  limits: {
    maxPerTransaction: number;
    maxPendingPerWallet: number;
    dailyLimitPerWallet: number;
  };
  erc8004: {
    agentId?: number;
    identityRegistry: string;
    reputationRegistry: string;
    validationRegistry: string;
  };
}

export interface ReputationSummary {
  count: number;
  averageValue: number;
  valueDecimals: number;
}

export class ERC8004Service {
  private config: Config;
  private erc8004Config: ERC8004Config;
  private provider: ethers.JsonRpcProvider;
  private signer?: ethers.Wallet;

  private identityRegistry?: ethers.Contract;
  private reputationRegistry?: ethers.Contract;
  private validationRegistry?: ethers.Contract;

  constructor(
    config: Config,
    erc8004Config: ERC8004Config,
    provider: ethers.JsonRpcProvider
  ) {
    this.config = config;
    this.erc8004Config = erc8004Config;
    this.provider = provider;

    if (config.facilitator.privateKey) {
      this.signer = new ethers.Wallet(config.facilitator.privateKey, provider);
    }

    // Initialize contract instances
    if (erc8004Config.identityRegistry) {
      this.identityRegistry = new ethers.Contract(
        erc8004Config.identityRegistry,
        IDENTITY_REGISTRY_ABI,
        this.signer || provider
      );
    }

    if (erc8004Config.reputationRegistry) {
      this.reputationRegistry = new ethers.Contract(
        erc8004Config.reputationRegistry,
        REPUTATION_REGISTRY_ABI,
        this.signer || provider
      );
    }

    if (erc8004Config.validationRegistry) {
      this.validationRegistry = new ethers.Contract(
        erc8004Config.validationRegistry,
        VALIDATION_REGISTRY_ABI,
        this.signer || provider
      );
    }
  }

  /**
   * Check if service is properly configured
   */
  isEnabled(): boolean {
    return this.erc8004Config.enabled && !!this.identityRegistry;
  }

  /**
   * Get the configured agent ID
   */
  getAgentId(): number | undefined {
    return this.erc8004Config.agentId;
  }

  /**
   * Register a new agent (returns agentId)
   */
  async registerAgent(agentURI?: string): Promise<number> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    if (!this.signer) {
      throw new Error('Signer not configured');
    }

    console.log('Registering agent on ERC-8004 Identity Registry...');

    let tx: ethers.ContractTransactionResponse;
    if (agentURI) {
      tx = await this.identityRegistry['register(string)'](agentURI);
    } else {
      tx = await this.identityRegistry['register()']();
    }

    console.log(`Transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error('Transaction failed');
    }

    // Parse Registered event to get agentId
    const registeredEvent = receipt.logs.find((log) => {
      try {
        const parsed = this.identityRegistry!.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        return parsed?.name === 'Registered';
      } catch {
        return false;
      }
    });

    if (!registeredEvent) {
      throw new Error('Registered event not found');
    }

    const parsed = this.identityRegistry.interface.parseLog({
      topics: registeredEvent.topics as string[],
      data: registeredEvent.data,
    });

    const agentId = Number(parsed!.args.agentId);
    console.log(`Agent registered successfully! Agent ID: ${agentId}`);

    return agentId;
  }

  /**
   * Get agent token URI
   */
  async getAgentURI(agentId: number): Promise<string> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    return this.identityRegistry.tokenURI(agentId);
  }

  /**
   * Set agent token URI
   */
  async setAgentURI(agentId: number, newURI: string): Promise<string> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    if (!this.signer) {
      throw new Error('Signer not configured');
    }

    const tx = await this.identityRegistry.setAgentURI(agentId, newURI);
    await tx.wait();
    return tx.hash;
  }

  /**
   * Get agent wallet address
   */
  async getAgentWallet(agentId: number): Promise<string> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    return this.identityRegistry.getAgentWallet(agentId);
  }

  /**
   * Get agent owner
   */
  async getAgentOwner(agentId: number): Promise<string> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    return this.identityRegistry.ownerOf(agentId);
  }

  /**
   * Check if an address owns any agents
   */
  async getAgentCount(owner: string): Promise<number> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    const balance = await this.identityRegistry.balanceOf(owner);
    return Number(balance);
  }

  /**
   * Get metadata for an agent
   */
  async getMetadata(agentId: number, key: string): Promise<string> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    const data = await this.identityRegistry.getMetadata(agentId, key);
    return ethers.toUtf8String(data);
  }

  /**
   * Set metadata for an agent
   */
  async setMetadata(agentId: number, key: string, value: string): Promise<string> {
    if (!this.identityRegistry) {
      throw new Error('Identity registry not configured');
    }
    if (!this.signer) {
      throw new Error('Signer not configured');
    }

    const tx = await this.identityRegistry.setMetadata(
      agentId,
      key,
      ethers.toUtf8Bytes(value)
    );
    await tx.wait();
    return tx.hash;
  }

  /**
   * Get reputation summary for an agent
   */
  async getReputationSummary(
    agentId: number,
    tag1: string = '',
    tag2: string = ''
  ): Promise<ReputationSummary> {
    if (!this.reputationRegistry) {
      throw new Error('Reputation registry not configured');
    }

    // Get all clients first
    const clients = await this.reputationRegistry.getClients(agentId);

    if (clients.length === 0) {
      return { count: 0, averageValue: 0, valueDecimals: 0 };
    }

    const [count, summaryValue, valueDecimals] = await this.reputationRegistry.getSummary(
      agentId,
      clients,
      tag1,
      tag2
    );

    return {
      count: Number(count),
      averageValue: Number(summaryValue),
      valueDecimals: Number(valueDecimals),
    };
  }

  /**
   * Get validation summary for an agent
   */
  async getValidationSummary(
    agentId: number,
    tag: string = ''
  ): Promise<{ count: number; avgResponse: number }> {
    if (!this.validationRegistry) {
      throw new Error('Validation registry not configured');
    }

    const [count, avgResponse] = await this.validationRegistry.getSummary(
      agentId,
      [], // all validators
      tag
    );

    return {
      count: Number(count),
      avgResponse: Number(avgResponse),
    };
  }

  /**
   * Get registry versions
   */
  async getVersions(): Promise<{
    identity?: string;
    reputation?: string;
    validation?: string;
  }> {
    const versions: { identity?: string; reputation?: string; validation?: string } = {};

    if (this.identityRegistry) {
      versions.identity = await this.identityRegistry.getVersion();
    }
    if (this.reputationRegistry) {
      versions.reputation = await this.reputationRegistry.getVersion();
    }
    if (this.validationRegistry) {
      versions.validation = await this.validationRegistry.getVersion();
    }

    return versions;
  }

  /**
   * Generate agent metadata JSON for serving at /agent-metadata
   */
  getAgentMetadata(): AgentMetadata {
    return {
      name: 'FCR-x402 Facilitator',
      description: 'Instant payment facilitator for Filecoin using x402 protocol with F3 fast finality',
      version: '0.3.0',
      type: 'payment-facilitator',
      capabilities: [
        'instant-payments',
        'deferred-payments',
        'bond-guarantees',
        'f3-fast-finality',
        'usdfc-token',
      ],
      endpoint: `http://${this.config.server.host}:${this.config.server.port}`,
      chain: {
        id: this.config.chain.id,
        name: this.config.chain.name,
      },
      contracts: {
        bond: process.env.BOND_CONTRACT_ADDRESS,
        escrow: process.env.ESCROW_CONTRACT_ADDRESS,
      },
      limits: {
        maxPerTransaction: this.config.risk.maxPerTransaction,
        maxPendingPerWallet: this.config.risk.maxPendingPerWallet,
        dailyLimitPerWallet: this.config.risk.dailyLimitPerWallet,
      },
      erc8004: {
        agentId: this.erc8004Config.agentId,
        identityRegistry: this.erc8004Config.identityRegistry || '',
        reputationRegistry: this.erc8004Config.reputationRegistry || '',
        validationRegistry: this.erc8004Config.validationRegistry || '',
      },
    };
  }
}
