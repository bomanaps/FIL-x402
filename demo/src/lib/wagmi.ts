import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { CHAIN_CONFIG } from './config';

// Define Filecoin Calibration chain for wagmi
const filecoinCalibration = {
  id: CHAIN_CONFIG.id,
  name: CHAIN_CONFIG.name,
  nativeCurrency: CHAIN_CONFIG.nativeCurrency,
  rpcUrls: CHAIN_CONFIG.rpcUrls,
  blockExplorers: CHAIN_CONFIG.blockExplorers,
  testnet: CHAIN_CONFIG.testnet,
} as const;

export const config = getDefaultConfig({
  appName: 'FCR-x402 Demo',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo-project-id',
  chains: [filecoinCalibration],
  transports: {
    [filecoinCalibration.id]: http(CHAIN_CONFIG.rpcUrls.default.http[0]),
  },
  ssr: true,
});
