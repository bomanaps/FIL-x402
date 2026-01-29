import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const USDFC_ADDRESS = process.env.TOKEN_ADDRESS || "0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0";

  console.log("Deploying contracts to Calibration testnet...");
  console.log("USDFC token address:", USDFC_ADDRESS);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer tFIL balance:", ethers.formatEther(balance));

  // Deploy BondedFacilitator
  console.log("\n--- Deploying BondedFacilitator ---");
  const BondedFacilitator = await ethers.getContractFactory("BondedFacilitator");
  const bond = await BondedFacilitator.deploy(USDFC_ADDRESS);
  await bond.waitForDeployment();
  const bondAddress = await bond.getAddress();
  console.log("BondedFacilitator deployed at:", bondAddress);

  // Deploy DeferredPaymentEscrow
  console.log("\n--- Deploying DeferredPaymentEscrow ---");
  const DeferredPaymentEscrow = await ethers.getContractFactory("DeferredPaymentEscrow");
  const escrow = await DeferredPaymentEscrow.deploy(USDFC_ADDRESS);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("DeferredPaymentEscrow deployed at:", escrowAddress);

  // Save addresses
  const addresses = {
    network: "calibration",
    chainId: 314159,
    token: USDFC_ADDRESS,
    bondedFacilitator: bondAddress,
    deferredPaymentEscrow: escrowAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved to:", outPath);

  console.log("\n=== Deployment Summary ===");
  console.log("BondedFacilitator:       ", bondAddress);
  console.log("DeferredPaymentEscrow:   ", escrowAddress);
  console.log("USDFC Token:             ", USDFC_ADDRESS);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
