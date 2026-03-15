// ── EDMA L2 — Deployment Script ─────────────────────────────────────────────
// Deploys all core contracts in dependency order.
// Usage: npx hardhat run script/Deploy.s.js --network <network>

const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying EDMA L2 contracts with account:", deployer.address);
  console.log("Network:", hre.network.name, "| Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("─".repeat(60));

  // ── 1. Deploy OneClaim ─────────────────────────────────────────────────
  console.log("1/12 Deploying OneClaimLedger...");
  const OneClaim = await hre.ethers.getContractFactory("OneClaimLedger");
  const oneClaim = await OneClaim.deploy(deployer.address);
  await oneClaim.waitForDeployment();
  console.log("  → OneClaimLedger:", await oneClaim.getAddress());

  // ── 2. Deploy AttestorRegistry ──────────────────────────────────────────
  console.log("2/12 Deploying AttestorRegistry...");
  const AttestorRegistry = await hre.ethers.getContractFactory("AttestorRegistry");
  const attestorRegistry = await AttestorRegistry.deploy(deployer.address);
  await attestorRegistry.waitForDeployment();
  console.log("  → AttestorRegistry:", await attestorRegistry.getAddress());

  // ── 3. Deploy PoVGate ─────────────────────────────────────────────────
  console.log("3/12 Deploying PoVGate...");
  const PoVGate = await hre.ethers.getContractFactory("PoVGate");
  const povGate = await PoVGate.deploy(
    await oneClaim.getAddress(),
    await attestorRegistry.getAddress(),
    deployer.address
  );
  await povGate.waitForDeployment();
  console.log("  → PoVGate:", await povGate.getAddress());

  // ── 4. Deploy EDSD ────────────────────────────────────────────────────
  console.log("4/12 Deploying EDSD...");
  const EDSD = await hre.ethers.getContractFactory("EDSD");
  const edsd = await EDSD.deploy(deployer.address);
  await edsd.waitForDeployment();
  console.log("  → EDSD:", await edsd.getAddress());

  // ── 5. Deploy FeeRouter ───────────────────────────────────────────────
  console.log("5/12 Deploying FeeRouter...");
  const FeeRouter = await hre.ethers.getContractFactory("FeeRouter");
  const feeRouter = await FeeRouter.deploy(deployer.address);
  await feeRouter.waitForDeployment();
  console.log("  → FeeRouter:", await feeRouter.getAddress());

  // ── 6. Deploy EDMBurner ───────────────────────────────────────────────
  console.log("6/12 Deploying EDMBurner...");
  const EDMBurner = await hre.ethers.getContractFactory("EDMBurner");
  const edmBurner = await EDMBurner.deploy(await edsd.getAddress(), deployer.address);
  await edmBurner.waitForDeployment();
  console.log("  → EDMBurner:", await edmBurner.getAddress());

  // ── 7. Deploy SettlementController ────────────────────────────────────
  console.log("7/12 Deploying SettlementController...");
  const SC = await hre.ethers.getContractFactory("SettlementController");
  const sc = await SC.deploy(
    await povGate.getAddress(),
    await oneClaim.getAddress(),
    await edsd.getAddress(),
    await feeRouter.getAddress(),
    await edmBurner.getAddress(),
    deployer.address
  );
  await sc.waitForDeployment();
  console.log("  → SettlementController:", await sc.getAddress());

  // ── 8. Deploy EMT ────────────────────────────────────────────────────
  console.log("8/12 Deploying EMT...");
  const EMT = await hre.ethers.getContractFactory("EMT");
  const emt = await EMT.deploy(await sc.getAddress());
  await emt.waitForDeployment();
  console.log("  → EMT:", await emt.getAddress());

  // ── 9. Deploy ETT ────────────────────────────────────────────────────
  console.log("9/12 Deploying ETT...");
  const ETT = await hre.ethers.getContractFactory("ETT");
  const ett = await ETT.deploy(deployer.address);
  await ett.waitForDeployment();
  console.log("  → ETT:", await ett.getAddress());

  // ── 10. Deploy CertificateNFT ─────────────────────────────────────────
  console.log("10/12 Deploying CertificateNFT...");
  const CertNFT = await hre.ethers.getContractFactory("CertificateNFT");
  const certNFT = await CertNFT.deploy(deployer.address);
  await certNFT.waitForDeployment();
  console.log("  → CertificateNFT:", await certNFT.getAddress());

  // ── 11. Deploy ParameterStore ─────────────────────────────────────────
  console.log("11/12 Deploying ParameterStore...");
  const ParamStore = await hre.ethers.getContractFactory("ParameterStore");
  const paramStore = await ParamStore.deploy(deployer.address);
  await paramStore.waitForDeployment();
  console.log("  → ParameterStore:", await paramStore.getAddress());

  // ── 12. Deploy RevocationManager ──────────────────────────────────────
  console.log("12/12 Deploying RevocationManager...");
  const RevMgr = await hre.ethers.getContractFactory("RevocationManager");
  const revMgr = await RevMgr.deploy(deployer.address);
  await revMgr.waitForDeployment();
  console.log("  → RevocationManager:", await revMgr.getAddress());

  // ── Wire Up Permissions ───────────────────────────────────────────────
  console.log("\n─ Wiring permissions ─");
  await oneClaim.setPoVGate(await povGate.getAddress());
  console.log("  ✓ OneClaim → PoVGate");
  await oneClaim.setSettlementController(await sc.getAddress());
  console.log("  ✓ OneClaim → SettlementController");
  await attestorRegistry.setPoVGate(await povGate.getAddress());
  console.log("  ✓ AttestorRegistry → PoVGate");
  await povGate.setSettlementController(await sc.getAddress());
  console.log("  ✓ PoVGate → SettlementController");
  await edsd.setAuthorized(await sc.getAddress(), true);
  console.log("  ✓ EDSD → SettlementController authorized");
  await feeRouter.setSettlementController(await sc.getAddress());
  console.log("  ✓ FeeRouter → SettlementController");
  await edmBurner.setSettlementController(await sc.getAddress());
  console.log("  ✓ EDMBurner → SettlementController");

  // ── Summary ───────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  EDMA L2 — All contracts deployed and wired");
  console.log("══════════════════════════════════════════════════════════");
  console.log(JSON.stringify({
    OneClaimLedger: await oneClaim.getAddress(),
    AttestorRegistry: await attestorRegistry.getAddress(),
    PoVGate: await povGate.getAddress(),
    EDSD: await edsd.getAddress(),
    FeeRouter: await feeRouter.getAddress(),
    EDMBurner: await edmBurner.getAddress(),
    SettlementController: await sc.getAddress(),
    EMT: await emt.getAddress(),
    ETT: await ett.getAddress(),
    CertificateNFT: await certNFT.getAddress(),
    ParameterStore: await paramStore.getAddress(),
    RevocationManager: await revMgr.getAddress(),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
