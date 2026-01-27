import type { Config } from '../types/config.js';
import { ethers } from 'ethers';

// ERC20 ABI for balance and authorization checks
// NOTE: USDFC uses the v,r,s variant of transferWithAuthorization (EIP-3009 original)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
];

export class LotusService {
  private provider: ethers.JsonRpcProvider;
  private tokenContract: ethers.Contract;
  private config: Config;

  constructor(config: Config) {
    this.config = config;

    // Create provider with Lotus endpoint
    // Lotus exposes EVM JSON-RPC at /rpc/v1
    this.provider = new ethers.JsonRpcProvider(
      config.lotus.endpoint,
      {
        chainId: config.chain.id,
        name: config.chain.name,
      }
    );

    // Add authorization header if token provided
    if (config.lotus.token) {
      this.provider._getConnection().setHeader(
        'Authorization',
        `Bearer ${config.lotus.token}`
      );
    }

    // Initialize token contract
    this.tokenContract = new ethers.Contract(
      config.token.address,
      ERC20_ABI,
      this.provider
    );
  }

  /**
   * Get the balance of an address in the token
   */
  async getBalance(address: string): Promise<bigint> {
    try {
      const balance = await this.tokenContract.balanceOf(address);
      return balance;
    } catch (error) {
      throw new Error(`Failed to get balance for ${address}: ${error}`);
    }
  }

  /**
   * Check if a nonce has been used for EIP-3009 authorization
   */
  async isNonceUsed(authorizer: string, nonce: string): Promise<boolean> {
    try {
      // authorizationState returns true if nonce has been used
      const used = await this.tokenContract.authorizationState(authorizer, nonce);
      return used;
    } catch (error) {
      // If method doesn't exist, assume nonce tracking via different mechanism
      console.warn(`authorizationState check failed: ${error}`);
      return false;
    }
  }

  /**
   * Submit a transferWithAuthorization transaction
   * Returns the transaction hash/CID
   */
  async submitTransferWithAuthorization(
    from: string,
    to: string,
    value: string,
    validAfter: number,
    validBefore: number,
    nonce: string,
    signature: string,
    signerPrivateKey?: string
  ): Promise<string> {
    // Need a signer to submit the transaction
    if (!signerPrivateKey && !this.config.facilitator.privateKey) {
      throw new Error('No signer private key configured');
    }

    const wallet = new ethers.Wallet(
      signerPrivateKey || this.config.facilitator.privateKey!,
      this.provider
    );

    const tokenWithSigner = this.tokenContract.connect(wallet) as ethers.Contract;

    try {
      // Split signature into v, r, s (EIP-3009 original format)
      const sig = ethers.Signature.from(signature);

      const tx = await tokenWithSigner.transferWithAuthorization(
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
        sig.v,
        sig.r,
        sig.s
      );

      // Return the transaction hash immediately (don't wait for confirmation)
      return tx.hash;
    } catch (error) {
      throw new Error(`Failed to submit transaction: ${error}`);
    }
  }

  /**
   * Wait for a transaction to be included in a block
   */
  async waitForTransaction(
    txHash: string,
    confirmations: number = 1
  ): Promise<ethers.TransactionReceipt | null> {
    try {
      const receipt = await this.provider.waitForTransaction(txHash, confirmations);
      return receipt;
    } catch (error) {
      throw new Error(`Failed waiting for transaction ${txHash}: ${error}`);
    }
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice || 0n;
  }

  /**
   * Check if the service is connected and working
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
}
