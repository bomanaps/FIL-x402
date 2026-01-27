import { ethers } from 'ethers';
import type { PaymentPayload } from '../types/payment.js';
import type { Config } from '../types/config.js';

// EIP-712 domain for transferWithAuthorization
// Based on EIP-3009 specification
interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

// EIP-3009 TransferWithAuthorization type
const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'
  )
);

export class SignatureService {
  private domainSeparator: string;

  constructor(config: Config, tokenName: string = 'USD Coin', tokenVersion: string = '1') {
    // Compute EIP-712 domain separator
    const domain: EIP712Domain = {
      name: tokenName,
      version: tokenVersion,
      chainId: config.chain.id,
      verifyingContract: config.token.address,
    };

    this.domainSeparator = this.computeDomainSeparator(domain);
  }

  /**
   * Compute EIP-712 domain separator
   */
  private computeDomainSeparator(domain: EIP712Domain): string {
    const EIP712_DOMAIN_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'
      )
    );

    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
        [
          EIP712_DOMAIN_TYPEHASH,
          ethers.keccak256(ethers.toUtf8Bytes(domain.name)),
          ethers.keccak256(ethers.toUtf8Bytes(domain.version)),
          domain.chainId,
          domain.verifyingContract,
        ]
      )
    );
  }

  /**
   * Compute the struct hash for TransferWithAuthorization
   */
  private computeStructHash(payment: PaymentPayload): string {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
        [
          TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
          payment.from,
          payment.to,
          payment.value,
          payment.validAfter,
          payment.validBefore,
          payment.nonce,
        ]
      )
    );
  }

  /**
   * Compute the EIP-712 digest to be signed
   */
  computeDigest(payment: PaymentPayload): string {
    const structHash = this.computeStructHash(payment);

    // EIP-712: "\x19\x01" ++ domainSeparator ++ structHash
    return ethers.keccak256(
      ethers.concat([
        ethers.toUtf8Bytes('\x19\x01'),
        this.domainSeparator,
        structHash,
      ])
    );
  }

  /**
   * Verify the EIP-712 signature on a payment payload
   * Returns the recovered signer address, or null if invalid
   */
  verifySignature(payment: PaymentPayload): string | null {
    try {
      const digest = this.computeDigest(payment);

      // Split signature into r, s, v components
      const signature = payment.signature;

      // ethers.recoverAddress expects the signature in the right format
      const recoveredAddress = ethers.recoverAddress(digest, signature);

      return recoveredAddress;
    } catch (error) {
      console.error('Signature verification failed:', error);
      return null;
    }
  }

  /**
   * Verify that the signature is valid AND matches the claimed 'from' address
   */
  isValidPaymentSignature(payment: PaymentPayload): boolean {
    const recoveredAddress = this.verifySignature(payment);

    if (!recoveredAddress) {
      return false;
    }

    // Compare addresses (case-insensitive)
    return recoveredAddress.toLowerCase() === payment.from.toLowerCase();
  }

  /**
   * Validate that the payment is within its validity window
   */
  isWithinValidityWindow(payment: PaymentPayload): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now >= payment.validAfter && now < payment.validBefore;
  }

  /**
   * Check if a payment will expire soon (within threshold seconds)
   */
  isExpiringSoon(payment: PaymentPayload, thresholdSeconds: number = 60): boolean {
    const now = Math.floor(Date.now() / 1000);
    return payment.validBefore - now < thresholdSeconds;
  }

  /**
   * Generate a unique payment ID from the payment payload
   */
  generatePaymentId(payment: PaymentPayload): string {
    // Use keccak256 of signature as unique identifier
    return ethers.keccak256(payment.signature);
  }
}
