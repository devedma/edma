// ═══════════════════════════════════════════════════════════════════════════════
// EDMA L2 — First Live Settlement Demo
// ═══════════════════════════════════════════════════════════════════════════════
//
// This script executes a complete PoV settlement flow on the live EDMA devnet:
//
//   1. Setup: register attestor, set schema, mint & lock EDSD, configure milestone
//   2. Evaluate: submit attestation → PoV Gate → PASS → gate pass issued
//   3. Settle:  atomic settlement → EMT → OneClaim → EDSD unlock → fee → burn → receipt
//   4. Verify:  check all state changes visible on Blockscout
//
// Usage: npx hardhat run script/demo.js --network edma_devnet
//
// The settlement flow: EDSD.mint → EDSD.lock → evaluateClaim → settleTrancheOnPass
// All visible on Blockscout at http://localhost
// ═══════════════════════════════════════════════════════════════════════════════

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// ─── Test Data: BR-EU Perishables Corridor ───────────────────────────────────
const ORDER_ID       = hre.ethers.id("PO-2026-DEMO-001");
const MS_ONBOARD     = hre.ethers.id("ON_BOARD");
const SCHEMA_ONBOARD = hre.ethers.id("SCHEMA_TRADE_ONBOARD_V1");
const CORRIDOR_ID    = hre.ethers.id("BR-EU-PERISHABLES");
const POV_HASH       = hre.ethers.id("EVIDENCE:BL-MAEU123456|CNTR-MSCU1234567|TEMP-OK");
const UNIQUENESS_KEY = hre.ethers.id("BL:MAEU123456|CNTR:MSCU1234567");
const ROLE_TITLE     = hre.ethers.id("TITLE");
const ORG_MAERSK     = hre.ethers.id("ORG:MAERSK:LEI-549300VFKB3UZQHG2Y04");

const PO_TOTAL_VALUE = hre.ethers.parseUnits("300000", 6); // $300,000 EDSD (6 decimals)
const ONBOARD_WEIGHT = 3000; // 30% = 90,000 EDSD

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hr(char = "─", len = 70) { console.log(char.repeat(len)); }
function section(title) { console.log(`\n${"═".repeat(70)}\n  ${title}\n${"═".repeat(70)}`); }

async function signAttestation(signer, orderId, milestoneId, povHash, povGateAddress) {
  const domain = {
    name: "EDMA PoV Gate",
    version: "1",
    chainId: 741,
    verifyingContract: povGateAddress,
  };
  const types = {
    Attestation: [
      { name: "orderId", type: "bytes32" },
      { name: "milestoneId", type: "bytes32" },
      { name: "povHash", type: "bytes32" },
    ],
  };
  return signer.signTypedData(domain, types, { orderId, milestoneId, povHash });
}

function logTx(label, receipt) {
  console.log(`  ✓ ${label}`);
  console.log(`    TX: ${receipt.hash}`);
  console.log(`    Block: ${receipt.blockNumber} | Gas: ${receipt.gasUsed.toString()}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const signers = await hre.ethers.getSigners();
  const deployer  = signers[0]; // Admin + buyer
  const attestor  = signers[1]; // Title attestor (Maersk)
  const supplier  = signers[2]; // Goods supplier

  console.log("\n");
  section("EDMA L2 — First Live Settlement Demo");
  console.log(`  Chain ID:  741`);
  console.log(`  Network:   ${hre.network.name}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Attestor:  ${attestor.address}`);
  console.log(`  Supplier:  ${supplier.address}`);
  console.log(`  Block:     ${await hre.ethers.provider.getBlockNumber()}`);

  // ─── Phase 1: Discover contract addresses ──────────────────────────────────
  section("Phase 1: Discover Contracts");

  // Load addresses from file, or auto-discover from SettlementController
  let addresses;
  const addrPath = path.join(__dirname, "..", "..", "..", "deployments", "devnet", "addresses.json");

  if (fs.existsSync(addrPath)) {
    addresses = JSON.parse(fs.readFileSync(addrPath, "utf8")).contracts;
    console.log("  Loaded addresses from deployments/devnet/addresses.json");
  } else {
    console.error("  ✗ No addresses.json found. Run Deploy.s.js first.");
    process.exit(1);
  }

  // Attach to deployed contracts
  const sc              = await hre.ethers.getContractAt("SettlementController", addresses.SettlementController);
  const povGate         = await hre.ethers.getContractAt("PoVGate", addresses.PoVGate);
  const edsd            = await hre.ethers.getContractAt("EDSD", addresses.EDSD);
  const oneClaim        = await hre.ethers.getContractAt("OneClaimLedger", addresses.OneClaimLedger);
  const attestorReg     = await hre.ethers.getContractAt("AttestorRegistry", addresses.AttestorRegistry);
  const feeRouter       = await hre.ethers.getContractAt("FeeRouter", addresses.FeeRouter);

  // Verify contracts are alive
  const scAdmin = await sc.admin();
  console.log(`  SettlementController: ${addresses.SettlementController} (admin: ${scAdmin})`);
  console.log(`  PoVGate:              ${addresses.PoVGate}`);
  console.log(`  EDSD:                 ${addresses.EDSD}`);
  console.log(`  OneClaimLedger:       ${addresses.OneClaimLedger}`);
  console.log(`  AttestorRegistry:     ${addresses.AttestorRegistry}`);
  console.log(`  FeeRouter:            ${addresses.FeeRouter}`);

  // ─── Phase 2: Setup (register attestor, schema, fund order) ────────────────
  section("Phase 2: Setup — Register Attestor, Schema, Fund Order");

  // 2a. Authorize deployer on EDSD (so we can mint directly for the demo)
  const isAuth = await edsd.authorizedControllers(deployer.address);
  if (!isAuth) {
    const tx = await edsd.setAuthorized(deployer.address, true);
    logTx("EDSD: authorized deployer for minting", await tx.wait());
  } else {
    console.log("  ✓ Deployer already authorized on EDSD");
  }

  // 2b. Register attestor (Account 1 as Title Agent / Maersk)
  const isActive = await attestorReg.isActive(attestor.address);
  if (!isActive) {
    const tx = await attestorReg.registerAttestor(
      attestor.address,
      ORG_MAERSK,
      [ROLE_TITLE]
    );
    logTx("AttestorRegistry: registered Title attestor (Maersk)", await tx.wait());
  } else {
    console.log("  ✓ Attestor already registered and active");
  }

  // 2c. Set PoV schema for ON_BOARD milestone
  const schemaData = await povGate.schemas(SCHEMA_ONBOARD);
  if (!schemaData.active) {
    const tx = await povGate.setSchema(
      SCHEMA_ONBOARD,
      [ROLE_TITLE],           // Required: Title Agent attestation
      1,                      // Min 1 attestation
      86400,                  // 24h freshness window
      false                   // Funding check done by SC, not gate
    );
    logTx("PoVGate: set ON_BOARD schema (1 TITLE attestation required)", await tx.wait());
  } else {
    console.log("  ✓ ON_BOARD schema already active");
  }

  // 2d. Mint EDSD to buyer (deployer)
  const buyerBalance = await edsd.balanceOf(deployer.address);
  if (buyerBalance < PO_TOTAL_VALUE) {
    const tx = await edsd.mint(deployer.address, PO_TOTAL_VALUE);
    logTx(`EDSD: minted $300,000 to buyer (${deployer.address})`, await tx.wait());
  } else {
    console.log(`  ✓ Buyer already has ${hre.ethers.formatUnits(buyerBalance, 6)} EDSD`);
  }

  // 2e. Configure milestone on SettlementController
  const msConfig = await sc.milestones(ORDER_ID, MS_ONBOARD);
  if (!msConfig.configured) {
    const tx = await sc.configureMilestone(
      ORDER_ID,
      MS_ONBOARD,
      ONBOARD_WEIGHT,        // 30% of PO value
      supplier.address,
      CORRIDOR_ID,
      PO_TOTAL_VALUE
    );
    logTx("SettlementController: configured ON_BOARD milestone (30% = $90,000)", await tx.wait());
  } else {
    console.log("  ✓ ON_BOARD milestone already configured");
  }

  // 2f. Lock EDSD for the ON_BOARD milestone
  const trancheAmount = hre.ethers.parseUnits("90000", 6); // 30% of 300K
  const lockedAmt = await edsd.getLockedAmount(ORDER_ID, MS_ONBOARD, supplier.address);
  if (lockedAmt < trancheAmount) {
    const tx = await edsd.lock(ORDER_ID, MS_ONBOARD, supplier.address, trancheAmount);
    logTx("EDSD: locked $90,000 for ON_BOARD milestone", await tx.wait());
  } else {
    console.log(`  ✓ EDSD already locked: ${hre.ethers.formatUnits(lockedAmt, 6)} EDSD`);
  }

  hr();
  console.log("  Setup complete. Totals:");
  console.log(`    EDSD supply:  ${hre.ethers.formatUnits(await edsd.totalSupply(), 6)} EDSD`);
  console.log(`    EDSD locked:  ${hre.ethers.formatUnits(await edsd.totalLocked(), 6)} EDSD`);
  console.log(`    Order value:  ${hre.ethers.formatUnits(await sc.orderTotalValue(ORDER_ID), 6)} EDSD`);

  // ─── Phase 3: Deploy atomic DemoSettler ────────────────────────────────────
  section("Phase 3: Deploy Atomic Settler");

  const DemoSettler = await hre.ethers.getContractFactory("DemoSettler");
  const settler = await DemoSettler.deploy();
  await settler.waitForDeployment();
  const settlerAddr = await settler.getAddress();
  console.log(`  ✓ DemoSettler deployed: ${settlerAddr}`);
  console.log(`    (wraps evaluateClaim + settleTrancheOnPass in one TX)`);

  // ─── Phase 4: Execute Settlement ───────────────────────────────────────────
  section("Phase 4: Execute Settlement — ON_BOARD Milestone");

  // 4a. Create EIP-712 attestation
  console.log("\n  Step 1: Attestor signs evidence (EIP-712)...");
  const signature = await signAttestation(
    attestor, ORDER_ID, MS_ONBOARD, POV_HASH,
    addresses.PoVGate
  );
  console.log(`    Attestor:  ${attestor.address}`);
  console.log(`    Role:      TITLE`);
  console.log(`    Evidence:  ${POV_HASH.slice(0, 18)}...`);
  console.log(`    Signature: ${signature.slice(0, 22)}...`);

  // 4b. Build attestation struct
  const attestation = {
    attestor: attestor.address,
    role: ROLE_TITLE,
    evidenceHash: POV_HASH,
    timestamp: Math.floor(Date.now() / 1000),
    signature: signature,
  };

  // 4b2. Check OneClaim availability (might be consumed from earlier run)
  let uniquenessKey = UNIQUENESS_KEY;
  const isAvailable = await oneClaim.isAvailable(uniquenessKey);
  if (!isAvailable) {
    console.log("    ⚠ Original uniqueness key already consumed — using fresh key");
    uniquenessKey = hre.ethers.id("DEMO-" + Date.now());
  } else {
    console.log("    ✓ Uniqueness key available");
  }

  // 4c. Pre-flight check (staticCall simulates the full flow without sending TX)
  console.log("\n  Step 2: Pre-flight check (staticCall)...");
  try {
    const simResult = await settler.evaluateAndSettle.staticCall(
      addresses.PoVGate,
      addresses.SettlementController,
      ORDER_ID,
      MS_ONBOARD,
      SCHEMA_ONBOARD,
      POV_HASH,
      [attestation],
      uniquenessKey
    );
    console.log(`    ✓ Pre-flight PASS — receiptId: ${simResult.receiptId.slice(0, 18)}...`);
  } catch (prefErr) {
    console.error(`    ✗ Pre-flight FAILED: ${prefErr.reason || prefErr.message?.slice(0, 200)}`);
    if (prefErr.data) console.error(`    Revert data: ${prefErr.data}`);
    console.error("    Settlement would fail. Fix the error above first.");
    process.exit(1);
  }

  // 4d. Estimate gas manually and add 50% buffer (OP Stack can underestimate)
  console.log("\n  Step 3: Estimating gas...");
  let gasEstimate;
  try {
    gasEstimate = await settler.evaluateAndSettle.estimateGas(
      addresses.PoVGate,
      addresses.SettlementController,
      ORDER_ID,
      MS_ONBOARD,
      SCHEMA_ONBOARD,
      POV_HASH,
      [attestation],
      uniquenessKey
    );
    console.log(`    Estimated: ${gasEstimate.toString()}`);
  } catch (estErr) {
    console.log(`    Estimate failed, using 3M default: ${estErr.message?.slice(0, 100)}`);
    gasEstimate = 3000000n;
  }
  const gasLimit = gasEstimate * 3n / 2n; // 50% buffer over estimate
  console.log(`    Gas limit (with 50%% buffer): ${gasLimit.toString()}`);

  // 4e. Execute atomic evaluate + settle (real transaction)
  console.log("\n  Step 4: Sending settlement transaction...");

  const settleTx = await settler.evaluateAndSettle(
    addresses.PoVGate,
    addresses.SettlementController,
    ORDER_ID,
    MS_ONBOARD,
    SCHEMA_ONBOARD,
    POV_HASH,
    [attestation],
    uniquenessKey,
    { gasLimit }
  );

  const settleReceipt = await settleTx.wait();

  console.log(`\n  ✓ SETTLEMENT COMPLETE`);
  console.log(`    TX Hash:    ${settleReceipt.hash}`);
  console.log(`    Block:      ${settleReceipt.blockNumber}`);
  console.log(`    Gas Used:   ${settleReceipt.gasUsed.toString()}`);
  console.log(`    Events:     ${settleReceipt.logs.length}`);

  // 4d. Parse events
  hr();
  console.log("  Decoded Events:");

  for (const log of settleReceipt.logs) {
    try {
      // Try each contract's interface to decode
      let parsed = null;
      const contracts = [
        { name: "PoVGate", contract: povGate },
        { name: "SettlementController", contract: sc },
        { name: "EDSD", contract: edsd },
        { name: "OneClaimLedger", contract: oneClaim },
        { name: "DemoSettler", contract: settler },
      ];

      for (const { name, contract } of contracts) {
        try {
          parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed) {
            console.log(`\n    📋 ${name}.${parsed.name}`);
            for (const [key, val] of Object.entries(parsed.args)) {
              if (isNaN(key)) { // Skip numeric indices
                const display = typeof val === "bigint"
                  ? `${val.toString()} (${hre.ethers.formatUnits(val, 6)} EDSD)`
                  : typeof val === "string" && val.startsWith("0x") && val.length === 66
                    ? `${val.slice(0, 18)}...`
                    : val.toString();
                console.log(`       ${key}: ${display}`);
              }
            }
            break;
          }
        } catch { /* not this contract */ }
      }

      if (!parsed) {
        console.log(`\n    📋 [Unknown event] topic0: ${log.topics[0]?.slice(0, 18)}...`);
      }
    } catch { /* skip unparseable */ }
  }

  // ─── Phase 5: Verify State ─────────────────────────────────────────────────
  section("Phase 5: Verify Settlement State");

  // 5a. EDSD unlocked?
  const unlocked = await edsd.isUnlocked(ORDER_ID, MS_ONBOARD, supplier.address);
  console.log(`  EDSD unlocked for ON_BOARD:  ${unlocked ? "✓ YES" : "✗ NO"}`);

  // 5b. OneClaim finalized?
  const available = await oneClaim.isAvailable(uniquenessKey);
  console.log(`  OneClaim available:          ${available ? "✗ STILL AVAILABLE (BAD)" : "✓ FINALIZED"}`);

  // 5c. EDSD balances
  const finalBuyerBal = await edsd.balanceOf(deployer.address);
  const finalLocked   = await edsd.totalLocked();
  const finalBurned   = await edsd.totalBurned();
  console.log(`  EDSD buyer balance:          ${hre.ethers.formatUnits(finalBuyerBal, 6)} EDSD`);
  console.log(`  EDSD total locked:           ${hre.ethers.formatUnits(finalLocked, 6)} EDSD`);
  console.log(`  EDSD total burned:           ${hre.ethers.formatUnits(finalBurned, 6)} EDSD`);

  // 5d. EMT count
  const emtCount = await sc.emtCount();
  console.log(`  EMTs minted:                 ${emtCount.toString()}`);

  // 5e. Receipt count
  const receiptCount = await sc.receiptCount();
  console.log(`  Receipts emitted:            ${receiptCount.toString()}`);

  // ─── Summary ───────────────────────────────────────────────────────────────
  section("Settlement Demo Complete");
  console.log(`
  What happened in ONE transaction:

    1. PoV Gate evaluated the claim
       → Verified EIP-712 signature from Maersk (TITLE role)
       → Checked schema completeness (1 attestation, TITLE required)
       → Reserved uniqueness key on OneClaimLedger
       → Issued single-use gate pass

    2. SettlementController settled the tranche
       → Validated gate pass (I-1: No EMT without PASS)
       → Minted EMT (Event/Milestone Token)
       → Finalized OneClaimLedger (I-2: One-Claim)
       → Unlocked $90,000 EDSD (I-4: Locked→Unlocked only on proof)
       → Calculated fee: 0.50% = $450 (I-5: 50% burns)
       → Emitted on-chain Receipt

  View on Blockscout: http://localhost/tx/${settleReceipt.hash}

  All events decoded and visible in explorer.
  Next: Run the same flow for CUSTOMS, ARRIVAL_QA, and DELIVERY milestones.
`);

  // ─── Save TX hashes for reference ──────────────────────────────────────────
  const demoLog = {
    timestamp: new Date().toISOString(),
    network: hre.network.name,
    chainId: 741,
    settlementTx: settleReceipt.hash,
    settlementBlock: settleReceipt.blockNumber,
    gasUsed: settleReceipt.gasUsed.toString(),
    eventCount: settleReceipt.logs.length,
    order: {
      orderId: ORDER_ID,
      milestone: "ON_BOARD",
      trancheGross: "90000.000000",
      supplier: supplier.address,
      corridor: "BR-EU-PERISHABLES",
    },
    contracts: addresses,
    demoSettler: settlerAddr,
  };

  const logPath = path.join(__dirname, "..", "..", "..", "deployments", "devnet", "demo-log.json");
  fs.writeFileSync(logPath, JSON.stringify(demoLog, null, 2));
  console.log(`  Demo log saved: deployments/devnet/demo-log.json\n`);
}

main().catch((error) => {
  console.error("\n  ✗ Demo failed:", error.message || error);
  if (error.data) console.error("  Revert data:", error.data);
  process.exitCode = 1;
});
