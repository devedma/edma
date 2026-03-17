// ═══════════════════════════════════════════════════════════════════════════════
// EDMA L2 — Settlement Debug Diagnostic
// ═══════════════════════════════════════════════════════════════════════════════
//
// Runs BEFORE demo.js to find the exact revert source.
// Tests each step of evaluateClaim individually.
//
// Usage: npx hardhat run script/debug-settlement.js --network edma_devnet
// ═══════════════════════════════════════════════════════════════════════════════

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const ORDER_ID       = hre.ethers.id("PO-2026-DEMO-001");
const MS_ONBOARD     = hre.ethers.id("ON_BOARD");
const SCHEMA_ONBOARD = hre.ethers.id("SCHEMA_TRADE_ONBOARD_V1");
const CORRIDOR_ID    = hre.ethers.id("BR-EU-PERISHABLES");
const POV_HASH       = hre.ethers.id("EVIDENCE:BL-MAEU123456|CNTR-MSCU1234567|TEMP-OK");
const UNIQUENESS_KEY = hre.ethers.id("BL:MAEU123456|CNTR:MSCU1234567");
const ROLE_TITLE     = hre.ethers.id("TITLE");
const ORG_MAERSK     = hre.ethers.id("ORG:MAERSK:LEI-549300VFKB3UZQHG2Y04");

const PO_TOTAL_VALUE = hre.ethers.parseUnits("300000", 6);

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg) { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }
function hr()      { console.log("─".repeat(70)); }

async function main() {
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  const attestor = signers[1];
  const supplier = signers[2];

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  EDMA L2 — Settlement Debug Diagnostic");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ─── Load addresses ────────────────────────────────────────────────────────
  const addrPath = path.join(__dirname, "..", "..", "..", "deployments", "devnet", "addresses.json");
  if (!fs.existsSync(addrPath)) {
    fail("No addresses.json found");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(addrPath, "utf8")).contracts;

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Verify all contracts have code at their expected addresses
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("TEST 1: Contract code existence at all 12 addresses");
  hr();

  let allExist = true;
  for (const [name, addr] of Object.entries(addresses)) {
    const code = await hre.ethers.provider.getCode(addr);
    if (code === "0x" || code.length <= 2) {
      fail(`${name} @ ${addr} — NO CODE (address is wrong!)`);
      allExist = false;
    } else {
      pass(`${name} @ ${addr} — ${code.length} bytes`);
    }
  }

  if (!allExist) {
    console.log("\n⛔ Some contracts have no code. The addresses.json is wrong.");
    console.log("   Fix: re-run Deploy.s.js and save the ACTUAL addresses printed.\n");
    console.log("   Quick fix — run this on your Mac:");
    console.log("   npx hardhat run script/Deploy.s.js --network edma_devnet 2>&1 | grep '→'");
    console.log("   Then update deployments/devnet/addresses.json with those addresses.\n");
    // Don't exit — continue to show which specific address is broken
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Verify deployer nonce (helps confirm address derivation)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\nTEST 2: Deployer nonce");
  hr();
  const nonce = await hre.ethers.provider.getTransactionCount(deployer.address);
  info(`Current deployer nonce: ${nonce}`);
  info(`Deploy.s.js deploys 12 contracts (nonces N..N+11) then 7 wiring TXs (N+12..N+18)`);
  info(`If ran twice: first at nonces 0-18, second at nonces 19-37`);

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Verify contract wiring (permissions)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\nTEST 3: Contract wiring (who points where)");
  hr();

  try {
    const povGate = await hre.ethers.getContractAt("PoVGate", addresses.PoVGate);
    const oneClaim = await hre.ethers.getContractAt("OneClaimLedger", addresses.OneClaimLedger);
    const attestorReg = await hre.ethers.getContractAt("AttestorRegistry", addresses.AttestorRegistry);
    const edsd = await hre.ethers.getContractAt("EDSD", addresses.EDSD);
    const feeRouter = await hre.ethers.getContractAt("FeeRouter", addresses.FeeRouter);
    const sc = await hre.ethers.getContractAt("SettlementController", addresses.SettlementController);

    // Check PoVGate's immutables
    const gateOneClaim = await povGate.oneClaim();
    const gateAttReg = await povGate.attestorRegistry();
    const gateSC = await povGate.settlementController();

    if (gateOneClaim.toLowerCase() === addresses.OneClaimLedger.toLowerCase()) {
      pass(`PoVGate.oneClaim → ${gateOneClaim}`);
    } else {
      fail(`PoVGate.oneClaim → ${gateOneClaim} (expected ${addresses.OneClaimLedger})`);
    }

    if (gateAttReg.toLowerCase() === addresses.AttestorRegistry.toLowerCase()) {
      pass(`PoVGate.attestorRegistry → ${gateAttReg}`);
    } else {
      fail(`PoVGate.attestorRegistry → ${gateAttReg} (expected ${addresses.AttestorRegistry})`);
      info("THIS IS THE BUG — PoVGate was deployed with wrong AttestorRegistry address");
      info(`PoVGate calls attestorRegistry.isActive() which goes to ${gateAttReg}`);
      info("Fix addresses.json AttestorRegistry to match this address.");
    }

    if (gateSC.toLowerCase() === addresses.SettlementController.toLowerCase()) {
      pass(`PoVGate.settlementController → ${gateSC}`);
    } else {
      fail(`PoVGate.settlementController → ${gateSC} (expected ${addresses.SettlementController})`);
    }

    // Check OneClaim wiring
    const ocPoVGate = await oneClaim.povGate();
    const ocSC = await oneClaim.settlementController();

    if (ocPoVGate.toLowerCase() === addresses.PoVGate.toLowerCase()) {
      pass(`OneClaim.povGate → ${ocPoVGate}`);
    } else {
      fail(`OneClaim.povGate → ${ocPoVGate} (expected ${addresses.PoVGate})`);
    }

    if (ocSC.toLowerCase() === addresses.SettlementController.toLowerCase()) {
      pass(`OneClaim.settlementController → ${ocSC}`);
    } else {
      fail(`OneClaim.settlementController → ${ocSC} (expected ${addresses.SettlementController})`);
    }

    // Check AttestorRegistry wiring
    const arPoVGate = await attestorReg.povGate();
    if (arPoVGate.toLowerCase() === addresses.PoVGate.toLowerCase()) {
      pass(`AttestorRegistry.povGate → ${arPoVGate}`);
    } else {
      fail(`AttestorRegistry.povGate → ${arPoVGate} (expected ${addresses.PoVGate})`);
    }

    // Check SettlementController immutables
    const scPoVGate = await sc.povGate();
    const scOneClaim = await sc.oneClaim();
    const scEdsd = await sc.edsd();
    const scFeeRouter = await sc.feeRouter();
    const scBurner = await sc.edmBurner();

    for (const [label, actual, expected] of [
      ["SC.povGate", scPoVGate, addresses.PoVGate],
      ["SC.oneClaim", scOneClaim, addresses.OneClaimLedger],
      ["SC.edsd", scEdsd, addresses.EDSD],
      ["SC.feeRouter", scFeeRouter, addresses.FeeRouter],
      ["SC.edmBurner", scBurner, addresses.EDMBurner],
    ]) {
      if (actual.toLowerCase() === expected.toLowerCase()) {
        pass(`${label} → ${actual}`);
      } else {
        fail(`${label} → ${actual} (expected ${expected})`);
      }
    }

    // Check EDSD authorization
    const scAuthorized = await edsd.authorizedControllers(addresses.SettlementController);
    if (scAuthorized) {
      pass(`EDSD.authorizedControllers[SC] = true`);
    } else {
      fail(`EDSD.authorizedControllers[SC] = false — SC can't unlock/mint EDSD!`);
    }

    // Check FeeRouter.settlementController
    const frSC = await feeRouter.settlementController();
    if (frSC.toLowerCase() === addresses.SettlementController.toLowerCase()) {
      pass(`FeeRouter.settlementController → ${frSC}`);
    } else {
      fail(`FeeRouter.settlementController → ${frSC} (expected ${addresses.SettlementController})`);
    }

  } catch (e) {
    fail(`Wiring check failed: ${e.message}`);
    info("This likely means an address has no code — see TEST 1 results");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Verify EIP-712 domain separator matches
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\nTEST 4: EIP-712 Domain Separator");
  hr();

  try {
    const povGate = await hre.ethers.getContractAt("PoVGate", addresses.PoVGate);

    // Read on-chain domain separator
    const onChainDS = await povGate.DOMAIN_SEPARATOR();
    info(`On-chain DOMAIN_SEPARATOR: ${onChainDS}`);

    // Compute what JS would use
    const DOMAIN_TYPEHASH = hre.ethers.keccak256(
      hre.ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    );
    const jsDS = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
          DOMAIN_TYPEHASH,
          hre.ethers.keccak256(hre.ethers.toUtf8Bytes("EDMA PoV Gate")),
          hre.ethers.keccak256(hre.ethers.toUtf8Bytes("1")),
          741,
          addresses.PoVGate,
        ]
      )
    );
    info(`JS-computed DOMAIN_SEPARATOR:  ${jsDS}`);

    if (onChainDS === jsDS) {
      pass("Domain separators match ✓");
    } else {
      fail("Domain separator MISMATCH — EIP-712 signatures will always fail");
      // Try with actual chain ID from provider
      const network = await hre.ethers.provider.getNetwork();
      info(`Actual chain ID from provider: ${network.chainId}`);
      const jsDSActual = hre.ethers.keccak256(
        hre.ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "bytes32", "bytes32", "uint256", "address"],
          [
            DOMAIN_TYPEHASH,
            hre.ethers.keccak256(hre.ethers.toUtf8Bytes("EDMA PoV Gate")),
            hre.ethers.keccak256(hre.ethers.toUtf8Bytes("1")),
            network.chainId,
            addresses.PoVGate,
          ]
        )
      );
      info(`DS with actual chainId ${network.chainId}: ${jsDSActual}`);
      if (onChainDS === jsDSActual) {
        pass("Match with actual chain ID — fix demo.js to use this chainId");
      }
    }
  } catch (e) {
    fail(`Domain separator check failed: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: Verify signature recovery (the most likely failure)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\nTEST 5: EIP-712 Signature Verification");
  hr();

  try {
    const povGate = await hre.ethers.getContractAt("PoVGate", addresses.PoVGate);

    // Read on-chain values
    const ATTESTATION_TYPEHASH = await povGate.ATTESTATION_TYPEHASH();
    const DOMAIN_SEPARATOR = await povGate.DOMAIN_SEPARATOR();

    info(`ATTESTATION_TYPEHASH: ${ATTESTATION_TYPEHASH}`);

    // Sign with ethers signTypedData
    const domain = {
      name: "EDMA PoV Gate",
      version: "1",
      chainId: 741,
      verifyingContract: addresses.PoVGate,
    };
    const types = {
      Attestation: [
        { name: "orderId", type: "bytes32" },
        { name: "milestoneId", type: "bytes32" },
        { name: "povHash", type: "bytes32" },
      ],
    };
    const value = { orderId: ORDER_ID, milestoneId: MS_ONBOARD, povHash: POV_HASH };

    const signature = await attestor.signTypedData(domain, types, value);
    info(`Signature: ${signature.slice(0, 22)}...`);
    info(`Signer: ${attestor.address}`);

    // Verify locally first
    const localRecovered = hre.ethers.verifyTypedData(domain, types, value, signature);
    if (localRecovered.toLowerCase() === attestor.address.toLowerCase()) {
      pass(`Local verify: recovered ${localRecovered} matches attestor`);
    } else {
      fail(`Local verify: recovered ${localRecovered} does NOT match ${attestor.address}`);
    }

    // Now compute what the contract computes
    const structHash = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "bytes32"],
        [ATTESTATION_TYPEHASH, ORDER_ID, MS_ONBOARD, POV_HASH]
      )
    );
    info(`structHash: ${structHash}`);

    const digest = hre.ethers.keccak256(
      hre.ethers.solidityPacked(
        ["string", "bytes32", "bytes32"],
        ["\x19\x01", DOMAIN_SEPARATOR, structHash]
      )
    );
    info(`digest (toTypedDataHash): ${digest}`);

    // Recover from the digest manually
    const manualRecovered = hre.ethers.recoverAddress(digest, signature);
    if (manualRecovered.toLowerCase() === attestor.address.toLowerCase()) {
      pass(`Manual ECDSA.recover: ${manualRecovered} matches attestor`);
    } else {
      fail(`Manual ECDSA.recover: ${manualRecovered} does NOT match attestor`);
      info("The contract will see this mismatch and return FAIL_SIG");
      info("But ECDSA.recover itself should NOT revert — it returns a wrong address");
      info("So the silent revert is NOT from signature mismatch");
    }

    // Also try with actual chain ID from the network
    const network = await hre.ethers.provider.getNetwork();
    if (Number(network.chainId) !== 741) {
      info(`\nRe-trying with actual chain ID: ${network.chainId}`);
      const domain2 = { ...domain, chainId: Number(network.chainId) };
      const sig2 = await attestor.signTypedData(domain2, types, value);
      const rec2 = hre.ethers.verifyTypedData(domain2, types, value, sig2);
      info(`Recovered with chainId ${network.chainId}: ${rec2}`);
    }

  } catch (e) {
    fail(`Signature check failed: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: Run setup + evaluateClaim step-by-step (find exact revert point)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\nTEST 6: Step-by-step evaluateClaim (isolate revert)");
  hr();

  try {
    const povGate = await hre.ethers.getContractAt("PoVGate", addresses.PoVGate);
    const attestorReg = await hre.ethers.getContractAt("AttestorRegistry", addresses.AttestorRegistry);
    const edsd = await hre.ethers.getContractAt("EDSD", addresses.EDSD);
    const sc = await hre.ethers.getContractAt("SettlementController", addresses.SettlementController);
    const oneClaim = await hre.ethers.getContractAt("OneClaimLedger", addresses.OneClaimLedger);

    // 6a. Authorize deployer on EDSD
    const isAuth = await edsd.authorizedControllers(deployer.address);
    if (!isAuth) {
      const tx = await edsd.setAuthorized(deployer.address, true);
      await tx.wait();
      pass("EDSD: authorized deployer");
    } else {
      pass("EDSD: deployer already authorized");
    }

    // 6b. Register attestor
    const isActive = await attestorReg.isActive(attestor.address);
    if (!isActive) {
      const tx = await attestorReg.registerAttestor(attestor.address, ORG_MAERSK, [ROLE_TITLE]);
      await tx.wait();
      pass("AttestorRegistry: registered attestor");
    } else {
      pass("AttestorRegistry: attestor already active");
    }

    // Verify attestor queries work
    const active = await attestorReg.isActive(attestor.address);
    const hasRole = await attestorReg.hasRole(attestor.address, ROLE_TITLE);
    const orgId = await attestorReg.getOrgId(attestor.address);
    info(`  isActive: ${active}`);
    info(`  hasRole(TITLE): ${hasRole}`);
    info(`  orgId: ${orgId.slice(0, 18)}...`);

    // 6c. Set schema
    const schemaData = await povGate.schemas(SCHEMA_ONBOARD);
    if (!schemaData.active) {
      const tx = await povGate.setSchema(SCHEMA_ONBOARD, [ROLE_TITLE], 1, 86400, false);
      await tx.wait();
      pass("PoVGate: schema set");
    } else {
      pass("PoVGate: schema already active");
    }

    // 6d. Mint + lock EDSD
    const buyerBal = await edsd.balanceOf(deployer.address);
    if (buyerBal < PO_TOTAL_VALUE) {
      const tx = await edsd.mint(deployer.address, PO_TOTAL_VALUE);
      await tx.wait();
      pass("EDSD: minted 300K");
    } else {
      pass("EDSD: buyer already funded");
    }

    // Configure milestone
    const msConfig = await sc.milestones(ORDER_ID, MS_ONBOARD);
    if (!msConfig.configured) {
      const tx = await sc.configureMilestone(
        ORDER_ID, MS_ONBOARD, 3000, supplier.address, CORRIDOR_ID, PO_TOTAL_VALUE
      );
      await tx.wait();
      pass("SC: milestone configured");
    } else {
      pass("SC: milestone already configured");
    }

    // Lock EDSD
    const lockedAmt = await edsd.getLockedAmount(ORDER_ID, MS_ONBOARD, supplier.address);
    const tranche = hre.ethers.parseUnits("90000", 6);
    if (lockedAmt < tranche) {
      const tx = await edsd.lock(ORDER_ID, MS_ONBOARD, supplier.address, tranche);
      await tx.wait();
      pass("EDSD: locked 90K");
    } else {
      pass("EDSD: already locked");
    }

    // 6e. OneClaim availability
    const available = await oneClaim.isAvailable(UNIQUENESS_KEY);
    info(`OneClaim.isAvailable: ${available}`);
    if (!available) {
      fail("OneClaim key already used — need a fresh uniqueness key");
      info("Fix: change UNIQUENESS_KEY in the script to a new value");
    }

    // 6f. Sign attestation
    const domain = {
      name: "EDMA PoV Gate",
      version: "1",
      chainId: 741,
      verifyingContract: addresses.PoVGate,
    };
    const types = {
      Attestation: [
        { name: "orderId", type: "bytes32" },
        { name: "milestoneId", type: "bytes32" },
        { name: "povHash", type: "bytes32" },
      ],
    };
    const signature = await attestor.signTypedData(domain, types, {
      orderId: ORDER_ID, milestoneId: MS_ONBOARD, povHash: POV_HASH,
    });
    pass(`Signed attestation`);

    const attestation = {
      attestor: attestor.address,
      role: ROLE_TITLE,
      evidenceHash: POV_HASH,
      timestamp: Math.floor(Date.now() / 1000),
      signature: signature,
    };

    // 6g. Try evaluateClaim DIRECTLY (not via DemoSettler)
    console.log("\n  Attempting evaluateClaim directly (not via DemoSettler)...");
    try {
      // Use staticCall first to simulate without sending TX
      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH,
        [attestation], UNIQUENESS_KEY
      );
      if (result.pass) {
        pass(`evaluateClaim staticCall → PASS (gatePassId: ${result.gatePassId.slice(0, 18)}...)`);
      } else {
        fail(`evaluateClaim staticCall → FAIL: ${result.reason}`);
        info("The gate evaluated but returned a failure — NOT a revert");
        info(`Outcome: ${result.outcome}`);
      }
    } catch (e) {
      fail(`evaluateClaim staticCall REVERTED`);
      info(`Error message: ${e.message?.slice(0, 200)}`);
      if (e.data) info(`Revert data: ${e.data}`);
      if (e.reason) info(`Reason: ${e.reason}`);

      // Try to decode custom error
      if (e.data && e.data.length > 2) {
        const selector = e.data.slice(0, 10);
        info(`Error selector: ${selector}`);

        // Known OZ custom error selectors
        const knownErrors = {
          "0xf645eedf": "ECDSAInvalidSignature()",
          "0xd78bce0c": "ECDSAInvalidSignatureLength(uint256)",
          "0xe3d70c89": "ECDSAInvalidSignatureS(bytes32)",
        };
        if (knownErrors[selector]) {
          fail(`OpenZeppelin error: ${knownErrors[selector]}`);
          info("The EIP-712 signature doesn't match what the contract expects");
          info("Check: domain separator, struct hash, chain ID");
        }
      }
    }

    // 6h. Try DemoSettler path (for comparison)
    console.log("\n  Attempting evaluateClaim via DemoSettler...");
    try {
      const DemoSettler = await hre.ethers.getContractFactory("DemoSettler");
      const settler = await DemoSettler.deploy();
      await settler.waitForDeployment();
      pass(`DemoSettler deployed: ${await settler.getAddress()}`);

      // Need fresh uniqueness key for this attempt
      const freshKey = hre.ethers.id("DEBUG-TEST-" + Date.now());
      const freshSig = await attestor.signTypedData(domain, types, {
        orderId: ORDER_ID, milestoneId: MS_ONBOARD, povHash: POV_HASH,
      });
      const freshAtt = {
        attestor: attestor.address,
        role: ROLE_TITLE,
        evidenceHash: POV_HASH,
        timestamp: Math.floor(Date.now() / 1000),
        signature: freshSig,
      };

      const result = await settler.evaluateAndSettle.staticCall(
        addresses.PoVGate, addresses.SettlementController,
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH,
        [freshAtt], freshKey
      );
      pass(`DemoSettler.evaluateAndSettle staticCall → receiptId: ${result.receiptId.slice(0, 18)}...`);
    } catch (e) {
      fail(`DemoSettler.evaluateAndSettle REVERTED`);
      info(`Error: ${e.message?.slice(0, 300)}`);
      if (e.data) info(`Revert data: ${e.data}`);
    }

  } catch (e) {
    fail(`Setup/evaluation failed: ${e.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Diagnostic complete. Read results above to find the bug.");
  console.log("═══════════════════════════════════════════════════════════════\n");
}

main().catch((error) => {
  console.error("Diagnostic crashed:", error);
  process.exitCode = 1;
});
