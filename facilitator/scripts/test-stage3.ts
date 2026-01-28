/**
 * Stage 3 Integration Test — Bond + Deferred on Calibration
 *
 * Tests:
 *   1. Bond: deposit USDFC → commit payment → release payment
 *   2. Deferred: deposit into escrow → sign voucher → collect
 *   3. Facilitator API: start server, hit /deferred/buyers/:addr
 *
 * Usage:
 *   npx tsx --env-file .env scripts/test-stage3.ts
 */

import { ethers } from 'ethers';

// ─── Config from env ────────────────────────────────────────

const RPC = process.env.LOTUS_ENDPOINT!;
const PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY!;
const TOKEN_ADDR = process.env.TOKEN_ADDRESS!;
const BOND_ADDR = process.env.BOND_CONTRACT_ADDRESS!;
const ESCROW_ADDR = process.env.ESCROW_CONTRACT_ADDRESS!;
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '314159');

if (!PRIVATE_KEY || !TOKEN_ADDR || !BOND_ADDR || !ESCROW_ADDR) {
  console.error('Missing env vars. Make sure .env has:');
  console.error('  FACILITATOR_PRIVATE_KEY, TOKEN_ADDRESS, BOND_CONTRACT_ADDRESS, ESCROW_CONTRACT_ADDRESS');
  process.exit(1);
}

// ─── ABIs ───────────────────────────────────────────────────

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const BOND_ABI = [
  'function depositBond(uint256 amount) external',
  'function withdrawBond(uint256 amount) external',
  'function commitPayment(bytes32 paymentId, address provider, uint256 amount) external',
  'function releasePayment(bytes32 paymentId) external',
  'function bondBalance(address) view returns (uint256)',
  'function totalCommitted(address) view returns (uint256)',
  'function getAvailableBond(address) view returns (uint256)',
  'function getExposure(address) view returns (uint256)',
];

const ESCROW_ABI = [
  'function deposit(uint256 amount) external',
  'function getAccount(address buyer) view returns (uint256 balance, uint256 thawingAmount, uint64 thawEndTime)',
  'function collect((bytes32 id, address buyer, address seller, uint256 valueAggregate, address asset, uint64 timestamp, uint256 nonce, address escrow, uint256 chainId) voucher, bytes signature) external',
  'function settledNonce(bytes32) view returns (uint256)',
  'function collectedValue(bytes32) view returns (uint256)',
];

// ─── Setup ──────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(RPC, { chainId: CHAIN_ID, name: 'calibration' });
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const token = new ethers.Contract(TOKEN_ADDR, ERC20_ABI, wallet);
const bond = new ethers.Contract(BOND_ADDR, BOND_ABI, wallet);
const escrow = new ethers.Contract(ESCROW_ADDR, ESCROW_ABI, wallet);

function fmt(val: bigint): string {
  return ethers.formatEther(val) + ' USDFC';
}

async function waitTx(tx: any, label: string): Promise<any> {
  console.log(`  ⏳ ${label} — tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  ✅ ${label} — confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

// ─── Test 1: Bond Flow ──────────────────────────────────────

async function testBondFlow() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 1: BOND FLOW');
  console.log('═══════════════════════════════════════\n');

  const depositAmount = ethers.parseEther('10'); // 10 USDFC
  const commitAmount = ethers.parseEther('5');   // 5 USDFC

  // Check USDFC balance
  const bal = await token.balanceOf(wallet.address);
  console.log(`Wallet balance: ${fmt(bal)}`);
  if (bal < depositAmount) {
    console.error('Not enough USDFC. Need at least 10.');
    return false;
  }

  // Step 1: Approve bond contract
  console.log('\n1. Approve bond contract...');
  const allowance = await token.allowance(wallet.address, BOND_ADDR);
  if (allowance < depositAmount) {
    const tx = await token.approve(BOND_ADDR, ethers.parseEther('1000'));
    await waitTx(tx, 'approve');
  } else {
    console.log('  Already approved');
  }

  // Step 2: Deposit bond
  console.log('\n2. Deposit bond (10 USDFC)...');
  const tx1 = await bond.depositBond(depositAmount);
  await waitTx(tx1, 'depositBond');

  const bondBal = await bond.bondBalance(wallet.address);
  console.log(`  Bond balance: ${fmt(bondBal)}`);

  // Step 3: Commit payment
  console.log('\n3. Commit payment (5 USDFC)...');
  const paymentId = ethers.id('test-payment-' + Date.now());
  const tx2 = await bond.commitPayment(paymentId, wallet.address, commitAmount);
  await waitTx(tx2, 'commitPayment');

  const exposure = await bond.getExposure(wallet.address);
  const available = await bond.getAvailableBond(wallet.address);
  console.log(`  Exposure: ${fmt(exposure)}`);
  console.log(`  Available: ${fmt(available)}`);

  // Step 4: Release payment (simulates successful settlement)
  console.log('\n4. Release payment...');
  const tx3 = await bond.releasePayment(paymentId);
  await waitTx(tx3, 'releasePayment');

  const exposureAfter = await bond.getExposure(wallet.address);
  console.log(`  Exposure after release: ${fmt(exposureAfter)}`);

  // Step 5: Withdraw bond
  console.log('\n5. Withdraw bond (10 USDFC)...');
  const tx4 = await bond.withdrawBond(depositAmount);
  await waitTx(tx4, 'withdrawBond');

  const finalBondBal = await bond.bondBalance(wallet.address);
  console.log(`  Final bond balance: ${fmt(finalBondBal)}`);

  console.log('\n✅ BOND FLOW PASSED\n');
  return true;
}

// ─── Test 2: Deferred/Escrow Flow ───────────────────────────

async function testDeferredFlow() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 2: DEFERRED/ESCROW FLOW');
  console.log('═══════════════════════════════════════\n');

  const depositAmount = ethers.parseEther('10'); // 10 USDFC

  // Step 1: Approve escrow
  console.log('1. Approve escrow contract...');
  const allowance = await token.allowance(wallet.address, ESCROW_ADDR);
  if (allowance < depositAmount) {
    const tx = await token.approve(ESCROW_ADDR, ethers.parseEther('1000'));
    await waitTx(tx, 'approve');
  } else {
    console.log('  Already approved');
  }

  // Step 2: Deposit into escrow
  console.log('\n2. Deposit into escrow (10 USDFC)...');
  const tx1 = await escrow.deposit(depositAmount);
  await waitTx(tx1, 'deposit');

  const acct = await escrow.getAccount(wallet.address);
  console.log(`  Escrow balance: ${fmt(acct[0])}`);

  // Step 3: Sign a voucher (EIP-712)
  console.log('\n3. Sign voucher (3 USDFC to self)...');
  const voucherId = ethers.id('voucher-test-' + Date.now());
  const voucherAmount = ethers.parseEther('3');
  const now = Math.floor(Date.now() / 1000);

  const domain = {
    name: 'DeferredPaymentEscrow',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: ESCROW_ADDR,
  };

  const types = {
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
  };

  const voucherData = {
    id: voucherId,
    buyer: wallet.address,
    seller: wallet.address, // sending to self for test
    valueAggregate: voucherAmount,
    asset: TOKEN_ADDR,
    timestamp: now,
    nonce: 1,
    escrow: ESCROW_ADDR,
    chainId: CHAIN_ID,
  };

  const signature = await wallet.signTypedData(domain, types, voucherData);
  console.log(`  Voucher signed: ${signature.slice(0, 20)}...`);

  // Step 4: Collect voucher on-chain
  console.log('\n4. Collect voucher on-chain...');
  const tx2 = await escrow.collect(voucherData, signature);
  await waitTx(tx2, 'collect');

  const acctAfter = await escrow.getAccount(wallet.address);
  console.log(`  Escrow balance after collect: ${fmt(acctAfter[0])}`);

  const collectedVal = await escrow.collectedValue(voucherId);
  console.log(`  Collected value for voucher: ${fmt(collectedVal)}`);

  console.log('\n✅ DEFERRED FLOW PASSED\n');
  return true;
}

// ─── Test 3: Facilitator API Check ──────────────────────────

async function testFacilitatorAPI() {
  console.log('\n═══════════════════════════════════════');
  console.log('  TEST 3: FACILITATOR API');
  console.log('═══════════════════════════════════════\n');

  const baseUrl = `http://localhost:${process.env.PORT || 3402}`;

  try {
    // Check root
    console.log('1. GET / ...');
    const root = await fetch(baseUrl);
    const rootData = await root.json();
    console.log(`  Version: ${rootData.version}`);
    console.log(`  Bond enabled: ${rootData.bondEnabled}`);
    console.log(`  Deferred enabled: ${rootData.deferredEnabled}`);

    // Check deferred buyer endpoint
    console.log('\n2. GET /deferred/buyers/:address ...');
    const buyerRes = await fetch(`${baseUrl}/deferred/buyers/${wallet.address}`);
    const buyerData = await buyerRes.json();
    console.log(`  Balance: ${buyerData.balance}`);
    console.log(`  Thawing: ${buyerData.thawingAmount}`);
    console.log(`  Vouchers: ${buyerData.voucherCount}`);

    console.log('\n✅ FACILITATOR API PASSED\n');
    return true;
  } catch (error) {
    console.log('  ⚠️  Facilitator not running. Start it with: npm run dev');
    console.log(`  Error: ${error}`);
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║  STAGE 3 INTEGRATION TEST             ║');
  console.log('║  Calibration Testnet                   ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(`\nWallet:  ${wallet.address}`);
  console.log(`Token:   ${TOKEN_ADDR}`);
  console.log(`Bond:    ${BOND_ADDR}`);
  console.log(`Escrow:  ${ESCROW_ADDR}`);
  console.log(`RPC:     ${RPC}`);

  let passed = 0;
  let failed = 0;

  // Test 1: Bond
  try {
    if (await testBondFlow()) passed++; else failed++;
  } catch (error) {
    console.error('❌ BOND FLOW FAILED:', error);
    failed++;
  }

  // Test 2: Deferred
  try {
    if (await testDeferredFlow()) passed++; else failed++;
  } catch (error) {
    console.error('❌ DEFERRED FLOW FAILED:', error);
    failed++;
  }

  // Test 3: API (only if server is running)
  try {
    if (await testFacilitatorAPI()) passed++; else failed++;
  } catch (error) {
    console.log('⚠️  API test skipped (server not running)');
  }

  console.log('\n╔═══════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed             ║`);
  console.log('╚═══════════════════════════════════════╝\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
