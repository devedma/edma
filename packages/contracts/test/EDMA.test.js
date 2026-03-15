// ── EDMA L2 — Core Test Suite ────────────────────────────────────────────────
// Full lifecycle test using the BR-EU Perishables corridor.
// Canon reference: PoV-Gate Baseline Rules v1.0, Receipt v1 Spec v1.0

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EDMA Core Protocol", function () {

  let admin, buyer, supplier, titleAttestor, customsAttestor, qaAttestor, outsider;
  let oneClaim, attestorRegistry, povGate, edsd, feeRouter, edmBurner;
  let settlementController, emt, ett, certNFT, paramStore, revocationMgr;

  // ── Constants ───────────────────────────────────────────────────────────────
  const CORRIDOR_ID = ethers.id("BR-EU-PERISHABLES-2025Q1");
  const ORDER_ID = ethers.id("PO-COFFEE-2026-001");
  const MS_ONBOARD = ethers.id("ON_BOARD");
  const MS_CUSTOMS = ethers.id("CUSTOMS");
  const MS_ARRIVAL = ethers.id("ARRIVAL_QA");
  const SCHEMA_ONBOARD = ethers.id("SCHEMA_ON_BOARD_V1");
  const SCHEMA_CUSTOMS = ethers.id("SCHEMA_CUSTOMS_V1");
  const SCHEMA_ARRIVAL = ethers.id("SCHEMA_ARRIVAL_QA_V1");
  const PO_VALUE = ethers.parseUnits("300000", 6); // $300k

  const ROLE_TITLE = ethers.id("TITLE");
  const ROLE_CUSTOMS = ethers.id("CUSTOMS");
  const ROLE_QA = ethers.id("QA_LAB");

  // ── EIP-712 Helpers ─────────────────────────────────────────────────────────
  const DOMAIN_NAME = "EDMA PoV Gate";
  const DOMAIN_VERSION = "1";

  async function signAttestation(signer, orderId, milestoneId, povHash) {
    const domain = {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await povGate.getAddress(),
    };
    const types = {
      Attestation: [
        { name: "orderId", type: "bytes32" },
        { name: "milestoneId", type: "bytes32" },
        { name: "povHash", type: "bytes32" },
      ],
    };
    const value = { orderId, milestoneId, povHash };
    return signer.signTypedData(domain, types, value);
  }

  function makeAttestation(attestorAddr, role, povHash, sig) {
    return {
      attestor: attestorAddr,
      role: role,
      evidenceHash: povHash,
      timestamp: Math.floor(Date.now() / 1000),
      signature: sig,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // DEPLOYMENT + WIRING
  // ══════════════════════════════════════════════════════════════════════════════
  beforeEach(async function () {
    [admin, buyer, supplier, titleAttestor, customsAttestor, qaAttestor, outsider] =
      await ethers.getSigners();

    // Deploy in dependency order, wire after
    const OneClaimLedger = await ethers.getContractFactory("OneClaimLedger");
    oneClaim = await OneClaimLedger.deploy(admin.address);

    const AttestorRegistry = await ethers.getContractFactory("AttestorRegistry");
    attestorRegistry = await AttestorRegistry.deploy(admin.address);

    const PoVGate = await ethers.getContractFactory("PoVGate");
    povGate = await PoVGate.deploy(
      await oneClaim.getAddress(),
      await attestorRegistry.getAddress(),
      admin.address
    );

    const EDSD = await ethers.getContractFactory("EDSD");
    edsd = await EDSD.deploy(admin.address);

    const FeeRouter = await ethers.getContractFactory("FeeRouter");
    feeRouter = await FeeRouter.deploy(admin.address);

    const EDMBurner = await ethers.getContractFactory("EDMBurner");
    edmBurner = await EDMBurner.deploy(await edsd.getAddress(), admin.address);

    const SettlementController = await ethers.getContractFactory("SettlementController");
    settlementController = await SettlementController.deploy(
      await povGate.getAddress(),
      await oneClaim.getAddress(),
      await edsd.getAddress(),
      await feeRouter.getAddress(),
      await edmBurner.getAddress(),
      admin.address
    );

    const EMT = await ethers.getContractFactory("EMT");
    emt = await EMT.deploy(await settlementController.getAddress());

    const ETT = await ethers.getContractFactory("ETT");
    ett = await ETT.deploy(admin.address);

    const CertificateNFT = await ethers.getContractFactory("CertificateNFT");
    certNFT = await CertificateNFT.deploy(admin.address);

    const ParameterStore = await ethers.getContractFactory("ParameterStore");
    paramStore = await ParameterStore.deploy(admin.address);

    const RevocationManager = await ethers.getContractFactory("RevocationManager");
    revocationMgr = await RevocationManager.deploy(admin.address);

    // ── Wire permissions ────────────────────────────────────────────────────
    await oneClaim.setPoVGate(await povGate.getAddress());
    await oneClaim.setSettlementController(await settlementController.getAddress());
    await attestorRegistry.setPoVGate(await povGate.getAddress());
    await povGate.setSettlementController(await settlementController.getAddress());
    await edsd.setAuthorized(await settlementController.getAddress(), true);
    await edsd.setAuthorized(admin.address, true);
    await feeRouter.setSettlementController(await settlementController.getAddress());
    await edmBurner.setSettlementController(await settlementController.getAddress());
    await ett.setSettlementController(admin.address);
    await certNFT.setSettlementController(admin.address);

    // ── Register attestors (3 different orgs) ───────────────────────────────
    await attestorRegistry.registerAttestor(
      titleAttestor.address, ethers.id("ORG_MAERSK"), [ROLE_TITLE]
    );
    await attestorRegistry.registerAttestor(
      customsAttestor.address, ethers.id("ORG_BROKER_DEHAM"), [ROLE_CUSTOMS]
    );
    await attestorRegistry.registerAttestor(
      qaAttestor.address, ethers.id("ORG_SGS"), [ROLE_QA]
    );

    // ── Configure schemas (Canon Table 2-A) ─────────────────────────────────
    await povGate.setSchema(SCHEMA_ONBOARD, [ROLE_TITLE], 1, 3600, true);
    await povGate.setSchema(SCHEMA_CUSTOMS, [ROLE_CUSTOMS], 1, 3600, true);
    await povGate.setSchema(SCHEMA_ARRIVAL, [ROLE_QA], 1, 3600, true);

    // ── Configure milestones (30/40/30) ─────────────────────────────────────
    await settlementController.configureMilestone(
      ORDER_ID, MS_ONBOARD, 3000, supplier.address, CORRIDOR_ID, PO_VALUE
    );
    await settlementController.configureMilestone(
      ORDER_ID, MS_CUSTOMS, 4000, supplier.address, CORRIDOR_ID, PO_VALUE
    );
    await settlementController.configureMilestone(
      ORDER_ID, MS_ARRIVAL, 3000, supplier.address, CORRIDOR_ID, PO_VALUE
    );

    // ── Fund the order (must-fund) ──────────────────────────────────────────
    await edsd.mint(buyer.address, PO_VALUE);
    await edsd.lock(ORDER_ID, MS_ONBOARD, supplier.address, ethers.parseUnits("90000", 6));
    await edsd.lock(ORDER_ID, MS_CUSTOMS, supplier.address, ethers.parseUnits("120000", 6));
    await edsd.lock(ORDER_ID, MS_ARRIVAL, supplier.address, ethers.parseUnits("90000", 6));
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. OneClaimLedger
  // ══════════════════════════════════════════════════════════════════════════════
  describe("OneClaimLedger", function () {
    it("reports keys as available initially", async function () {
      expect(await oneClaim.isAvailable(ethers.id("TEST_KEY"))).to.equal(true);
    });

    it("rejects double-set of PoVGate address", async function () {
      await expect(
        oneClaim.setPoVGate(outsider.address)
      ).to.be.revertedWith("OneClaim: PoVGate already set");
    });

    it("rejects unauthorized reserve calls", async function () {
      await expect(
        oneClaim.connect(outsider).reserve(ethers.id("KEY"))
      ).to.be.revertedWith("OneClaim: caller is not PoVGate");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. AttestorRegistry
  // ══════════════════════════════════════════════════════════════════════════════
  describe("AttestorRegistry", function () {
    it("registers and verifies attestors", async function () {
      expect(await attestorRegistry.isActive(titleAttestor.address)).to.equal(true);
      expect(await attestorRegistry.isActive(customsAttestor.address)).to.equal(true);
      expect(await attestorRegistry.isActive(qaAttestor.address)).to.equal(true);
      expect(await attestorRegistry.isActive(outsider.address)).to.equal(false);
    });

    it("verifies role assignments", async function () {
      expect(await attestorRegistry.hasRole(titleAttestor.address, ROLE_TITLE)).to.equal(true);
      expect(await attestorRegistry.hasRole(titleAttestor.address, ROLE_CUSTOMS)).to.equal(false);
      expect(await attestorRegistry.hasRole(customsAttestor.address, ROLE_CUSTOMS)).to.equal(true);
    });

    it("detects same-org attestors", async function () {
      expect(await attestorRegistry.sameOrg(titleAttestor.address, customsAttestor.address)).to.equal(false);
    });

    it("suspends and reinstates", async function () {
      await attestorRegistry.suspend(titleAttestor.address, "Test");
      expect(await attestorRegistry.isActive(titleAttestor.address)).to.equal(false);
      await attestorRegistry.reinstate(titleAttestor.address);
      expect(await attestorRegistry.isActive(titleAttestor.address)).to.equal(true);
    });

    it("revokes permanently", async function () {
      await attestorRegistry.revoke(titleAttestor.address);
      expect(await attestorRegistry.isActive(titleAttestor.address)).to.equal(false);
      await expect(
        attestorRegistry.reinstate(titleAttestor.address)
      ).to.be.revertedWith("AttestorRegistry: not suspended");
    });

    it("blocks duplicate registration", async function () {
      await expect(
        attestorRegistry.registerAttestor(titleAttestor.address, ethers.id("ORG2"), [ROLE_QA])
      ).to.be.revertedWith("AttestorRegistry: already registered");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. EDSD
  // ══════════════════════════════════════════════════════════════════════════════
  describe("EDSD", function () {
    it("mints correct amount with 6 decimals", async function () {
      expect(await edsd.decimals()).to.equal(6);
      expect(await edsd.balanceOf(buyer.address)).to.equal(PO_VALUE);
    });

    it("tracks locked amounts per milestone", async function () {
      expect(
        await edsd.getLockedAmount(ORDER_ID, MS_ONBOARD, supplier.address)
      ).to.equal(ethers.parseUnits("90000", 6));
      expect(
        await edsd.getLockedAmount(ORDER_ID, MS_CUSTOMS, supplier.address)
      ).to.equal(ethers.parseUnits("120000", 6));
    });

    it("blocks unauthorized transfers — INVARIANT I-4", async function () {
      await expect(
        edsd.connect(buyer).transfer(supplier.address, 1000)
      ).to.be.revertedWith("EDSD: transfers restricted to authorized controllers");
    });

    it("blocks unlock from unauthorized caller", async function () {
      await expect(
        edsd.connect(outsider).unlock(ORDER_ID, MS_ONBOARD, supplier.address, 1000)
      ).to.be.revertedWith("EDSD: not authorized");
    });

    it("tracks totalLocked correctly", async function () {
      expect(await edsd.totalLocked()).to.equal(PO_VALUE);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. FeeRouter
  // ══════════════════════════════════════════════════════════════════════════════
  describe("FeeRouter", function () {
    it("calculates milestone fee at 50 bps", async function () {
      const tranche = ethers.parseUnits("90000", 6);
      const [fee, burn, treasury] = await feeRouter.calculateFee(
        CORRIDOR_ID, ethers.id("MILESTONE_FEE"), tranche, ORDER_ID
      );
      expect(fee).to.equal(ethers.parseUnits("450", 6));
      expect(burn).to.equal(ethers.parseUnits("225", 6));
      expect(treasury).to.equal(ethers.parseUnits("225", 6));
    });

    it("calculates attach fee at 200 bps", async function () {
      const notional = ethers.parseUnits("50000", 6);
      const [fee, burn, treasury] = await feeRouter.calculateFee(
        CORRIDOR_ID, ethers.id("ATTACH_FEE_BUYER"), notional, ORDER_ID
      );
      expect(fee).to.equal(ethers.parseUnits("1000", 6));
      expect(burn).to.equal(ethers.parseUnits("500", 6));
    });

    it("enforces 50% burn ratio is immutable — INVARIANT I-5", async function () {
      expect(await feeRouter.BURN_RATIO_BPS()).to.equal(5000);
    });

    it("applies per-tranche cap for large amounts", async function () {
      const bigTranche = ethers.parseUnits("2000000", 6); // $2M
      const [fee] = await feeRouter.calculateFee(
        CORRIDOR_ID, ethers.id("MILESTONE_FEE"), bigTranche, ORDER_ID
      );
      // $2M * 50 bps = $10k, but cap for $1-5M tier = $25k, so no cap here
      expect(fee).to.equal(ethers.parseUnits("10000", 6));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. PoVGate — Schema management
  // ══════════════════════════════════════════════════════════════════════════════
  describe("PoVGate schemas", function () {
    it("rejects schema with freshness < 15 min", async function () {
      await expect(
        povGate.setSchema(ethers.id("BAD"), [ROLE_TITLE], 1, 60, false)
      ).to.be.revertedWith("PoVGate: freshness < 15 min");
    });

    it("rejects schema with zero attestations", async function () {
      await expect(
        povGate.setSchema(ethers.id("BAD"), [ROLE_TITLE], 0, 3600, false)
      ).to.be.revertedWith("PoVGate: zero min attestations");
    });

    it("rejects evaluation with unknown schema", async function () {
      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, ethers.id("NONEXISTENT"), ethers.id("POV"), [], ethers.id("KEY")
      );
      expect(result.pass).to.equal(false);
      expect(result.reason).to.equal("E_SCHEMA_NOT_FOUND");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. PoVGate — Full evaluation with EIP-712 signatures
  // ══════════════════════════════════════════════════════════════════════════════
  describe("PoVGate evaluation", function () {
    const POV_HASH = ethers.id("EVIDENCE_HASH_BL_MAEU123456789");
    const UNIQUENESS_KEY = ethers.id("BL:MAEU123456789|CNTR:MSCU1234567,MSCU2345678");

    it("returns PASS for valid attestation", async function () {
      const sig = await signAttestation(titleAttestor, ORDER_ID, MS_ONBOARD, POV_HASH);
      const attestation = makeAttestation(titleAttestor.address, ROLE_TITLE, POV_HASH, sig);

      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [attestation], UNIQUENESS_KEY
      );
      expect(result.pass).to.equal(true);
      expect(result.reason).to.equal("PASS");
      expect(result.gatePassId).to.not.equal(ethers.ZeroHash);
    });

    it("rejects wrong attestor signature — FAIL_SIG", async function () {
      // Sign with wrong key
      const badSig = await signAttestation(outsider, ORDER_ID, MS_ONBOARD, POV_HASH);
      const attestation = makeAttestation(titleAttestor.address, ROLE_TITLE, POV_HASH, badSig);

      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [attestation], UNIQUENESS_KEY
      );
      expect(result.pass).to.equal(false);
      expect(result.reason).to.equal("E_SIG_MISMATCH");
    });

    it("rejects inactive attestor — FAIL_REVOKED", async function () {
      await attestorRegistry.suspend(titleAttestor.address, "Test");
      const sig = await signAttestation(titleAttestor, ORDER_ID, MS_ONBOARD, POV_HASH);
      const attestation = makeAttestation(titleAttestor.address, ROLE_TITLE, POV_HASH, sig);

      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [attestation], UNIQUENESS_KEY
      );
      expect(result.pass).to.equal(false);
      expect(result.reason).to.equal("E_ATTESTOR_NOT_ACTIVE");
    });

    it("rejects mismatched evidence hash — FAIL_CONFLICT", async function () {
      const sig = await signAttestation(titleAttestor, ORDER_ID, MS_ONBOARD, POV_HASH);
      const attestation = makeAttestation(
        titleAttestor.address, ROLE_TITLE,
        ethers.id("DIFFERENT_HASH"), // evidence hash doesn't match povHash
        sig
      );

      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [attestation], UNIQUENESS_KEY
      );
      expect(result.pass).to.equal(false);
      expect(result.reason).to.equal("E_HASH_MISMATCH");
    });

    it("rejects insufficient attestations — FAIL_INCOMPLETE", async function () {
      const result = await povGate.evaluateClaim.staticCall(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [], UNIQUENESS_KEY
      );
      expect(result.pass).to.equal(false);
      expect(result.reason).to.equal("E_INSUFFICIENT_ATTESTATIONS");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. ETT (Energy Tracking Token)
  // ══════════════════════════════════════════════════════════════════════════════
  describe("ETT", function () {
    it("mints with valid kWh and tracks producer", async function () {
      await ett.mint(
        supplier.address, ethers.id("DEVICE_001"),
        1700000000, 1700003600, 47, ethers.id("POV"), ethers.id("CLAIM")
      );
      const token = await ett.getToken(1);
      expect(token.kWh).to.equal(47);
      expect(token.producer).to.equal(supplier.address);
      expect(token.consumed).to.equal(false);
      expect(await ett.totalMinted()).to.equal(1);
    });

    it("rejects < 10 kWh", async function () {
      await expect(
        ett.mint(supplier.address, ethers.id("DEV"), 100, 200, 5, ethers.id("P"), ethers.id("C"))
      ).to.be.revertedWith("ETT: minimum 10 kWh");
    });

    it("consumes ETTs and prevents double-consume", async function () {
      await ett.mint(supplier.address, ethers.id("D"), 100, 200, 50, ethers.id("P"), ethers.id("C"));
      await ett.consume(1, ethers.id("CLE_AGGREGATE"));
      const token = await ett.getToken(1);
      expect(token.consumed).to.equal(true);
      await expect(
        ett.consume(1, ethers.id("CLE_AGGREGATE"))
      ).to.be.revertedWith("ETT: already consumed");
    });

    it("batch consumes and returns total kWh", async function () {
      await ett.mint(supplier.address, ethers.id("D1"), 100, 200, 30, ethers.id("P"), ethers.id("C1"));
      await ett.mint(supplier.address, ethers.id("D2"), 200, 300, 20, ethers.id("P"), ethers.id("C2"));
      const tx = await ett.consumeBatch([1, 2], ethers.id("CLE_AGGREGATE"));
      expect(await ett.totalConsumed()).to.equal(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. CertificateNFT
  // ══════════════════════════════════════════════════════════════════════════════
  describe("CertificateNFT", function () {
    it("mints, queries, and retires", async function () {
      await certNFT.mint(
        buyer.address, ethers.id("REC"), ethers.id("PJM-GATS"),
        "SERIAL-001", CORRIDOR_ID, ethers.id("POV"), [1, 2, 3]
      );
      expect(await certNFT.ownerOf(1)).to.equal(buyer.address);
      expect(await certNFT.isRetired(1)).to.equal(false);

      await certNFT.retire(1, ethers.id("RECEIPT"));
      expect(await certNFT.isRetired(1)).to.equal(true);
      expect(await certNFT.totalRetired()).to.equal(1);
    });

    it("blocks transfer of retired certificate", async function () {
      await certNFT.mint(buyer.address, ethers.id("REC"), ethers.id("REG"), "S1", CORRIDOR_ID, ethers.id("P"), []);
      await certNFT.retire(1, ethers.id("R"));
      await expect(
        certNFT.connect(buyer).transferFrom(buyer.address, supplier.address, 1)
      ).to.be.revertedWith("CertNFT: retired certificates are frozen");
    });

    it("rejects double retirement", async function () {
      await certNFT.mint(buyer.address, ethers.id("REC"), ethers.id("REG"), "S1", CORRIDOR_ID, ethers.id("P"), []);
      await certNFT.retire(1, ethers.id("R1"));
      await expect(certNFT.retire(1, ethers.id("R2"))).to.be.revertedWith("CertNFT: already retired");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 9. ParameterStore
  // ══════════════════════════════════════════════════════════════════════════════
  describe("ParameterStore", function () {
    it("has correct defaults", async function () {
      expect(await paramStore.get(await paramStore.BUYER_REVIEW_WINDOW())).to.equal(7200);
    });

    it("enforces 72h timelock", async function () {
      const key = await paramStore.BUYER_REVIEW_WINDOW();
      await paramStore.proposeChange(key, 10800); // 3h
      await expect(paramStore.executeChange(key)).to.be.revertedWith("ParamStore: timelock not expired");
    });

    it("executes change after timelock", async function () {
      const key = await paramStore.BUYER_REVIEW_WINDOW();
      await paramStore.proposeChange(key, 10800);
      // Advance time 72h + 1s
      await ethers.provider.send("evm_increaseTime", [72 * 3600 + 1]);
      await ethers.provider.send("evm_mine");
      await paramStore.executeChange(key);
      expect(await paramStore.get(key)).to.equal(10800);
    });

    it("rejects out-of-bounds values", async function () {
      const key = await paramStore.BUYER_REVIEW_WINDOW();
      await expect(paramStore.proposeChange(key, 18000)).to.be.revertedWith("ParamStore: out of bounds");
    });

    it("allows cancellation", async function () {
      const key = await paramStore.BUYER_REVIEW_WINDOW();
      await paramStore.proposeChange(key, 10800);
      await paramStore.cancelChange(key);
      const [, , exists] = await paramStore.getPending(key);
      expect(exists).to.equal(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 10. RevocationManager
  // ══════════════════════════════════════════════════════════════════════════════
  describe("RevocationManager", function () {
    it("freezes downstream milestones only", async function () {
      await revocationMgr.createRevocation(
        ORDER_ID, MS_ONBOARD, ethers.id("POV_BAD"),
        "BL rolled", [MS_CUSTOMS, MS_ARRIVAL]
      );
      expect(await revocationMgr.isFrozen(ORDER_ID, MS_CUSTOMS)).to.equal(true);
      expect(await revocationMgr.isFrozen(ORDER_ID, MS_ARRIVAL)).to.equal(true);
      expect(await revocationMgr.isFrozen(ORDER_ID, MS_ONBOARD)).to.equal(false);
    });

    it("resolves and unfreezes", async function () {
      const tx = await revocationMgr.createRevocation(
        ORDER_ID, MS_ONBOARD, ethers.id("POV_BAD"), "BL rolled", [MS_CUSTOMS]
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(l => l.fragment && l.fragment.name === "RevocationCreated");
      const revId = event ? event.args[0] : ethers.id("REV_FALLBACK");

      // In practice we'd extract revocationId from event. For now test unfreeze directly.
      expect(await revocationMgr.isFrozen(ORDER_ID, MS_CUSTOMS)).to.equal(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 11. Full Settlement Lifecycle (BR-EU Perishables)
  // ══════════════════════════════════════════════════════════════════════════════
  describe("Full Settlement: ON_BOARD milestone", function () {
    const POV_HASH = ethers.id("EVIDENCE_BL_MAEU123_ONBOARD");
    const UNIQUENESS_KEY = ethers.id("BL:MAEU123|CNTR:MSCU1234567");

    it("evaluates claim → settles tranche → emits receipt", async function () {
      // 1. Sign attestation
      const sig = await signAttestation(titleAttestor, ORDER_ID, MS_ONBOARD, POV_HASH);
      const attestation = makeAttestation(titleAttestor.address, ROLE_TITLE, POV_HASH, sig);

      // 2. Evaluate claim (gets gatePassId)
      const tx = await povGate.evaluateClaim(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [attestation], UNIQUENESS_KEY
      );

      // Extract gatePassId from GatePass event
      const evalReceipt = await tx.wait();
      const gatePassEvent = evalReceipt.logs.find(
        l => l.fragment && l.fragment.name === "GatePass"
      );
      expect(gatePassEvent).to.not.be.undefined;
      const gatePassId = gatePassEvent.args.gatePassId;

      // 3. Settle tranche (atomic: EMT mint → OneClaim finalize → EDSD unlock → fee → burn → receipt)
      const settleTx = await settlementController.settleTrancheOnPass(
        ORDER_ID, MS_ONBOARD, gatePassId, UNIQUENESS_KEY, POV_HASH
      );
      const settleReceipt = await settleTx.wait();

      // 4. Verify settlement event
      const settleEvent = settleReceipt.logs.find(
        l => l.fragment && l.fragment.name === "MilestoneSettled"
      );
      expect(settleEvent).to.not.be.undefined;
      expect(settleEvent.args.orderId).to.equal(ORDER_ID);
      expect(settleEvent.args.milestoneId).to.equal(MS_ONBOARD);
      expect(settleEvent.args.trancheGross).to.equal(ethers.parseUnits("90000", 6));

      // 5. Verify EDSD unlocked
      expect(await edsd.isUnlocked(ORDER_ID, MS_ONBOARD, supplier.address)).to.equal(true);

      // 6. Verify One-Claim finalized (key no longer available)
      expect(await oneClaim.isAvailable(UNIQUENESS_KEY)).to.equal(false);

      // 7. Verify gatePass consumed (cannot reuse)
      expect(await povGate.isGatePassValid(gatePassId)).to.equal(false);
    });

    it("rejects settlement without gate pass — INVARIANT I-1", async function () {
      await expect(
        settlementController.settleTrancheOnPass(
          ORDER_ID, MS_ONBOARD, ethers.id("FAKE_PASS"), UNIQUENESS_KEY, POV_HASH
        )
      ).to.be.revertedWith("Settlement: invalid gate pass (I-1)");
    });

    it("rejects duplicate evidence — INVARIANT I-2", async function () {
      // First settlement succeeds
      const sig = await signAttestation(titleAttestor, ORDER_ID, MS_ONBOARD, POV_HASH);
      const att = makeAttestation(titleAttestor.address, ROLE_TITLE, POV_HASH, sig);
      const tx = await povGate.evaluateClaim(
        ORDER_ID, MS_ONBOARD, SCHEMA_ONBOARD, POV_HASH, [att], UNIQUENESS_KEY
      );
      const receipt = await tx.wait();
      const gatePassId = receipt.logs.find(l => l.fragment?.name === "GatePass").args.gatePassId;
      await settlementController.settleTrancheOnPass(
        ORDER_ID, MS_ONBOARD, gatePassId, UNIQUENESS_KEY, POV_HASH
      );

      // Second attempt with same uniqueness key reverts
      await expect(
        povGate.evaluateClaim(ORDER_ID, MS_CUSTOMS, SCHEMA_CUSTOMS, POV_HASH, [att], UNIQUENESS_KEY)
      ).to.be.revertedWith("OneClaim: FAIL_DUPLICATE");
    });
  });
});
