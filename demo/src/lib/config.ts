// Chain and contract configuration for Filecoin Calibration testnet

export const CHAIN_CONFIG = {
  id: 314159,
  name: 'Filecoin Calibration',
  nativeCurrency: {
    name: 'testnet filecoin',
    symbol: 'tFIL',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://api.calibration.node.glif.io/rpc/v1'] },
    public: { http: ['https://api.calibration.node.glif.io/rpc/v1'] },
  },
  blockExplorers: {
    default: { name: 'Filfox', url: 'https://calibration.filfox.info' },
  },
  testnet: true,
} as const;

export const CONTRACTS = {
  // USDFC Token on Calibration
  USDFC: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
  // Deployed Stage 3 contracts
  BONDED_FACILITATOR: '0x0C79179E91246998A7F3b372de69ba2a112a37ed',
  DEFERRED_ESCROW: '0x3EE8f61b928295492886C6509D591da132531ef3',
  // ERC-8004 Agent Identity Registries (Stage 5)
  ERC8004_IDENTITY: '0x8A30335A7eff4450671E6aE412Fc786001ce149c',
  ERC8004_REPUTATION: '0x0510a352722D504767A86B961a493BBB3208a9a5',
  ERC8004_VALIDATION: '0x151EC586050d500e423f352A8EE6d781F7c7bE9E',
} as const;

export const TOKEN_CONFIG = {
  address: CONTRACTS.USDFC,
  decimals: 18,
  symbol: 'USDFC',
  name: 'USD for Filecoin Community',
} as const;

// Facilitator API endpoint
export const FACILITATOR_URL = process.env.NEXT_PUBLIC_FACILITATOR_URL || 'http://localhost:3402';

// EIP-712 domain for USDFC TransferWithAuthorization
export const EIP712_DOMAIN = {
  name: 'USD for Filecoin Community',
  version: '1',
  chainId: CHAIN_CONFIG.id,
  verifyingContract: CONTRACTS.USDFC,
} as const;

// EIP-712 types for TransferWithAuthorization (EIP-3009)
export const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

// EIP-712 domain for DeferredPaymentEscrow vouchers
export const ESCROW_DOMAIN = {
  name: 'DeferredPaymentEscrow',
  version: '1',
  chainId: CHAIN_CONFIG.id,
  verifyingContract: CONTRACTS.DEFERRED_ESCROW,
} as const;

// EIP-712 types for Voucher
export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'id', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'seller', type: 'address' },
    { name: 'valueAggregate', type: 'uint256' },
    { name: 'asset', type: 'address' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
    { name: 'escrow', type: 'address' },
    { name: 'chainId', type: 'uint256' },
  ],
} as const;
