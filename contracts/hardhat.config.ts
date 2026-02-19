import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config({ path: "../facilitator/.env" });

const PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",  // Filecoin FEVM compatibility
      viaIR: true,          // Required for ERC-8004 contracts (stack too deep)
    },
  },
  networks: {
    hardhat: {
      chainId: 314159,
    },
    calibration: {
      url: process.env.LOTUS_ENDPOINT || "https://api.calibration.node.glif.io/rpc/v1",
      chainId: 314159,
      accounts: [PRIVATE_KEY],
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
