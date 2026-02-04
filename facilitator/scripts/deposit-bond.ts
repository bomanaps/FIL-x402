/**
 * Deposit USDFC bond into BondedFacilitator contract
 *
 * Usage:
 *   npx tsx --env-file .env scripts/deposit-bond.ts [amount]
 *
 * Example:
 *   npx tsx --env-file .env scripts/deposit-bond.ts 100
 */

import { ethers } from 'ethers';

const RPC = process.env.LOTUS_ENDPOINT!;
const PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY!;
const TOKEN_ADDR = process.env.TOKEN_ADDRESS!;
const BOND_ADDR = process.env.BOND_CONTRACT_ADDRESS!;
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '314159');

if (!PRIVATE_KEY || !TOKEN_ADDR || !BOND_ADDR) {
  console.error('Missing env vars. Check .env has:');
  console.error('  FACILITATOR_PRIVATE_KEY, TOKEN_ADDRESS, BOND_CONTRACT_ADDRESS');
  process.exit(1);
}

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const BOND_ABI = [
  'function depositBond(uint256 amount) external',
  'function bondBalance(address) view returns (uint256)',
  'function getAvailableBond(address) view returns (uint256)',
];

async function main() {
  const amount = process.argv[2] || '100';
  const depositAmount = ethers.parseEther(amount);

  console.log('═══════════════════════════════════════');
  console.log('  DEPOSIT BOND');
  console.log('═══════════════════════════════════════\n');

  const provider = new ethers.JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'calibration' });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(TOKEN_ADDR, ERC20_ABI, wallet);
  const bond = new ethers.Contract(BOND_ADDR, BOND_ABI, wallet);

  console.log(`Wallet:  ${wallet.address}`);
  console.log(`Token:   ${TOKEN_ADDR}`);
  console.log(`Bond:    ${BOND_ADDR}`);
  console.log(`Amount:  ${amount} USDFC\n`);

  // Check USDFC balance
  const balance = await token.balanceOf(wallet.address);
  console.log(`USDFC Balance: ${ethers.formatEther(balance)} USDFC`);

  if (balance < depositAmount) {
    console.error(`\n❌ Insufficient balance. Need ${amount} USDFC.`);
    console.error(`   Get USDFC from: https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc`);
    process.exit(1);
  }

  // Check current bond
  const currentBond = await bond.bondBalance(wallet.address);
  const availableBond = await bond.getAvailableBond(wallet.address);
  console.log(`Current Bond:  ${ethers.formatEther(currentBond)} USDFC`);
  console.log(`Available:     ${ethers.formatEther(availableBond)} USDFC\n`);

  // Approve if needed
  const allowance = await token.allowance(wallet.address, BOND_ADDR);
  if (allowance < depositAmount) {
    console.log('Approving bond contract...');
    const approveTx = await token.approve(BOND_ADDR, ethers.parseEther('1000000'));
    console.log(`  Tx: ${approveTx.hash}`);
    await approveTx.wait();
    console.log('  ✓ Approved\n');
  }

  // Deposit bond
  console.log(`Depositing ${amount} USDFC as bond...`);
  const depositTx = await bond.depositBond(depositAmount);
  console.log(`  Tx: ${depositTx.hash}`);
  await depositTx.wait();
  console.log('  ✓ Deposited\n');

  // Check new bond
  const newBond = await bond.bondBalance(wallet.address);
  const newAvailable = await bond.getAvailableBond(wallet.address);
  console.log(`New Bond:      ${ethers.formatEther(newBond)} USDFC`);
  console.log(`New Available: ${ethers.formatEther(newAvailable)} USDFC`);

  console.log('\n✅ Bond deposited! You can now process payments.\n');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
