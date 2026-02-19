import { ethers } from "hardhat";
import * as fs from "fs";

/**
 * Deploy ERC-8004 Registries to Filecoin Calibration
 *
 * Uses the official ERC-8004 deployment pattern:
 * 1. Deploy HardhatMinimalUUPS as initial implementation
 * 2. Deploy proxy with MinimalUUPS (sets owner, version=1)
 * 3. Upgrade to real implementation
 * 4. Call reinitialize (version=2)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(60));
  console.log("ERC-8004 Registry Deployment - Filecoin Calibration");
  console.log("=".repeat(60));
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} tFIL`);
  console.log("");
  console.log("Note: Filecoin has ~30s block times. Each step may take 1-2 minutes.");
  console.log("");

  // Get contract factories
  const MinimalUUPS = await ethers.getContractFactory("HardhatMinimalUUPS");
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistryUpgradeable");
  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistryUpgradeable");
  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistryUpgradeable");
  const ERC1967Proxy = await ethers.getContractFactory("contracts/erc8004/contracts/ERC1967Proxy.sol:ERC1967Proxy");

  // ============================================================
  // 1. Deploy Identity Registry
  // ============================================================
  console.log("1. Deploying IdentityRegistry...");

  // 1a. Deploy MinimalUUPS implementation
  console.log("   a) Deploying MinimalUUPS implementation...");
  const minimalIdentity = await MinimalUUPS.deploy();
  await minimalIdentity.waitForDeployment();
  const minimalIdentityAddr = await minimalIdentity.getAddress();
  console.log(`      MinimalUUPS impl: ${minimalIdentityAddr}`);

  // 1b. Deploy proxy with MinimalUUPS + initialize
  console.log("   b) Deploying proxy + initializing...");
  const initDataIdentity = MinimalUUPS.interface.encodeFunctionData("initialize", [ethers.ZeroAddress]);
  const identityProxy = await ERC1967Proxy.deploy(minimalIdentityAddr, initDataIdentity);
  await identityProxy.waitForDeployment();
  const identityAddr = await identityProxy.getAddress();
  console.log(`      Proxy: ${identityAddr}`);

  // 1c. Deploy real IdentityRegistry implementation
  console.log("   c) Deploying IdentityRegistry implementation...");
  const identityImpl = await IdentityRegistry.deploy();
  await identityImpl.waitForDeployment();
  const identityImplAddr = await identityImpl.getAddress();
  console.log(`      IdentityRegistry impl: ${identityImplAddr}`);

  // 1d. Upgrade proxy to real implementation
  console.log("   d) Upgrading proxy to IdentityRegistry...");
  const minimalAtProxy = MinimalUUPS.attach(identityAddr) as any;
  const upgradeTx1 = await minimalAtProxy.upgradeToAndCall(identityImplAddr, "0x");
  await upgradeTx1.wait();
  console.log("      ✓ Upgraded");

  // 1e. Initialize IdentityRegistry (reinitializer(2))
  console.log("   e) Initializing IdentityRegistry...");
  const identity = IdentityRegistry.attach(identityAddr) as any;
  const initTx1 = await identity.initialize();
  await initTx1.wait();
  console.log("      ✓ Initialized (version 2)");
  console.log(`   IdentityRegistry: ${identityAddr}`);

  // ============================================================
  // 2. Deploy Reputation Registry
  // ============================================================
  console.log("\n2. Deploying ReputationRegistry...");

  // 2a. Deploy MinimalUUPS implementation
  console.log("   a) Deploying MinimalUUPS implementation...");
  const minimalReputation = await MinimalUUPS.deploy();
  await minimalReputation.waitForDeployment();
  const minimalReputationAddr = await minimalReputation.getAddress();
  console.log(`      MinimalUUPS impl: ${minimalReputationAddr}`);

  // 2b. Deploy proxy with MinimalUUPS + initialize (with identity registry)
  console.log("   b) Deploying proxy + initializing...");
  const initDataReputation = MinimalUUPS.interface.encodeFunctionData("initialize", [identityAddr]);
  const reputationProxy = await ERC1967Proxy.deploy(minimalReputationAddr, initDataReputation);
  await reputationProxy.waitForDeployment();
  const reputationAddr = await reputationProxy.getAddress();
  console.log(`      Proxy: ${reputationAddr}`);

  // 2c. Deploy real ReputationRegistry implementation
  console.log("   c) Deploying ReputationRegistry implementation...");
  const reputationImpl = await ReputationRegistry.deploy();
  await reputationImpl.waitForDeployment();
  const reputationImplAddr = await reputationImpl.getAddress();
  console.log(`      ReputationRegistry impl: ${reputationImplAddr}`);

  // 2d. Upgrade proxy to real implementation
  console.log("   d) Upgrading proxy to ReputationRegistry...");
  const minimalAtReputationProxy = MinimalUUPS.attach(reputationAddr) as any;
  const upgradeTx2 = await minimalAtReputationProxy.upgradeToAndCall(reputationImplAddr, "0x");
  await upgradeTx2.wait();
  console.log("      ✓ Upgraded");

  // 2e. Initialize ReputationRegistry (reinitializer(2))
  console.log("   e) Initializing ReputationRegistry...");
  const reputation = ReputationRegistry.attach(reputationAddr) as any;
  const initTx2 = await reputation.initialize(identityAddr);
  await initTx2.wait();
  console.log("      ✓ Initialized with IdentityRegistry");
  console.log(`   ReputationRegistry: ${reputationAddr}`);

  // ============================================================
  // 3. Deploy Validation Registry
  // ============================================================
  console.log("\n3. Deploying ValidationRegistry...");

  // 3a. Deploy MinimalUUPS implementation
  console.log("   a) Deploying MinimalUUPS implementation...");
  const minimalValidation = await MinimalUUPS.deploy();
  await minimalValidation.waitForDeployment();
  const minimalValidationAddr = await minimalValidation.getAddress();
  console.log(`      MinimalUUPS impl: ${minimalValidationAddr}`);

  // 3b. Deploy proxy with MinimalUUPS + initialize (with identity registry)
  console.log("   b) Deploying proxy + initializing...");
  const initDataValidation = MinimalUUPS.interface.encodeFunctionData("initialize", [identityAddr]);
  const validationProxy = await ERC1967Proxy.deploy(minimalValidationAddr, initDataValidation);
  await validationProxy.waitForDeployment();
  const validationAddr = await validationProxy.getAddress();
  console.log(`      Proxy: ${validationAddr}`);

  // 3c. Deploy real ValidationRegistry implementation
  console.log("   c) Deploying ValidationRegistry implementation...");
  const validationImpl = await ValidationRegistry.deploy();
  await validationImpl.waitForDeployment();
  const validationImplAddr = await validationImpl.getAddress();
  console.log(`      ValidationRegistry impl: ${validationImplAddr}`);

  // 3d. Upgrade proxy to real implementation
  console.log("   d) Upgrading proxy to ValidationRegistry...");
  const minimalAtValidationProxy = MinimalUUPS.attach(validationAddr) as any;
  const upgradeTx3 = await minimalAtValidationProxy.upgradeToAndCall(validationImplAddr, "0x");
  await upgradeTx3.wait();
  console.log("      ✓ Upgraded");

  // 3e. Initialize ValidationRegistry (reinitializer(2))
  console.log("   e) Initializing ValidationRegistry...");
  const validation = ValidationRegistry.attach(validationAddr) as any;
  const initTx3 = await validation.initialize(identityAddr);
  await initTx3.wait();
  console.log("      ✓ Initialized with IdentityRegistry");
  console.log(`   ValidationRegistry: ${validationAddr}`);

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log(`IdentityRegistry:   ${identityAddr}`);
  console.log(`ReputationRegistry: ${reputationAddr}`);
  console.log(`ValidationRegistry: ${validationAddr}`);
  console.log("");

  // Save addresses
  const addresses = {
    network: "calibration",
    chainId: 314159,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      IdentityRegistry: identityAddr,
      ReputationRegistry: reputationAddr,
      ValidationRegistry: validationAddr,
    },
    implementations: {
      IdentityRegistry: identityImplAddr,
      ReputationRegistry: reputationImplAddr,
      ValidationRegistry: validationImplAddr,
    }
  };

  const addressesPath = "./deployed-erc8004-addresses.json";
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log(`Addresses saved to: ${addressesPath}`);

  // Environment variables for facilitator
  console.log("\n--- Add to facilitator/.env ---");
  console.log(`ERC8004_IDENTITY_REGISTRY=${identityAddr}`);
  console.log(`ERC8004_REPUTATION_REGISTRY=${reputationAddr}`);
  console.log(`ERC8004_VALIDATION_REGISTRY=${validationAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
