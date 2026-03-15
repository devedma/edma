// ── EdmaClient — Main SDK entry point ────────────────────────────────────────
// Connects to EDMA L2 contracts and provides high-level methods for:
// - Evaluating claims (PoV Gate)
// - Settling milestones (atomic: Gate → EMT → EDSD → Fee → Burn → Receipt)
// - Querying state (One-Claim, EDSD locks, attestor status)
// - Listening to events (for webhook dispatch to edma-ops)

import { ethers } from "ethers";
import type {
  ContractAddresses, Attestation, GateResult,
  SettlementResult, MilestoneConfig
} from "./types";

// ABI fragments — minimal interfaces for SDK calls
const POV_GATE_ABI = [
  "function evaluateClaim(bytes32 orderId, bytes32 milestoneId, bytes32 schemaId, bytes32 povHash, tuple(address attestor, bytes32 role, bytes32 evidenceHash, uint256 timestamp, bytes signature)[] attestations, bytes32 uniquenessKey) external returns (tuple(bool pass, bytes32 gatePassId, bytes32 claimId, uint8 outcome, string reason))",
  "function isGatePassValid(bytes32 gatePassId) external view returns (bool)",
  "event GatePass(bytes32 indexed orderId, bytes32 indexed milestoneId, bytes32 gatePassId, bytes32 povHash, bytes32 claimId)",
  "event GateFail(bytes32 indexed orderId, bytes32 indexed milestoneId, uint8 outcome, string reason)",
];

const SETTLEMENT_ABI = [
  "function settleTrancheOnPass(bytes32 orderId, bytes32 milestoneId, bytes32 gatePassId, bytes32 uniquenessKey, bytes32 povHash) external returns (bytes32 receiptId)",
  "function configureMilestone(bytes32 orderId, bytes32 milestoneId, uint256 weightBps, address supplier, bytes32 corridorId, uint256 poTotalValue) external",
  "event MilestoneSettled(bytes32 indexed orderId, bytes32 indexed milestoneId, bytes32 receiptId, bytes32 burnHash, uint256 trancheGross, uint256 platformFee, uint256 burnAmount, uint256 netToBeneficiary)",
  "event ReceiptEmitted(bytes32 indexed receiptId, bytes32 orderId, bytes32 corridorId, bytes32 milestoneId, bytes32 povHash, bytes32 burnHash)",
];

const EDSD_ABI = [
  "function mint(address to, uint256 amount) external",
  "function lock(bytes32 orderId, bytes32 milestoneId, address supplier, uint256 amount) external",
  "function getLockedAmount(bytes32 orderId, bytes32 milestoneId, address supplier) external view returns (uint256)",
  "function isUnlocked(bytes32 orderId, bytes32 milestoneId, address supplier) external view returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function totalLocked() external view returns (uint256)",
];

const ONE_CLAIM_ABI = [
  "function isAvailable(bytes32 uniquenessKey) external view returns (bool)",
  "function getClaim(bytes32 uniquenessKey) external view returns (tuple(uint8 status, bytes32 claimId, bytes32 orderId, uint256 blockReserved))",
  "event ClaimFinalized(bytes32 indexed uniquenessKey, bytes32 claimId, bytes32 orderId)",
];

const ATTESTOR_REGISTRY_ABI = [
  "function isActive(address keyAddress) external view returns (bool)",
  "function hasRole(address keyAddress, bytes32 role) external view returns (bool)",
  "function getAttestor(address keyAddress) external view returns (tuple(address keyAddress, bytes32 orgIdHash, bytes32[] roles, uint8 status, uint256 bondAmount, uint256 passCount, uint256 failCount, uint256 reversalCount, uint256 totalLatencyMs, uint256 registeredAt))",
];

export class EdmaClient {
  readonly provider: ethers.Provider;
  readonly signer: ethers.Signer;
  readonly addresses: ContractAddresses;

  // Contract instances
  readonly povGate: ethers.Contract;
  readonly settlement: ethers.Contract;
  readonly edsd: ethers.Contract;
  readonly oneClaim: ethers.Contract;
  readonly attestorRegistry: ethers.Contract;

  constructor(
    provider: ethers.Provider,
    signer: ethers.Signer,
    addresses: ContractAddresses
  ) {
    this.provider = provider;
    this.signer = signer;
    this.addresses = addresses;

    this.povGate = new ethers.Contract(addresses.povGate, POV_GATE_ABI, signer);
    this.settlement = new ethers.Contract(addresses.settlementController, SETTLEMENT_ABI, signer);
    this.edsd = new ethers.Contract(addresses.edsd, EDSD_ABI, signer);
    this.oneClaim = new ethers.Contract(addresses.oneClaimLedger, ONE_CLAIM_ABI, signer);
    this.attestorRegistry = new ethers.Contract(addresses.attestorRegistry, ATTESTOR_REGISTRY_ABI, signer);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Settlement: evaluate + settle in two calls (same block via batch)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full settlement flow:
   * 1. Evaluate claim at PoV Gate
   * 2. If PASS, settle the tranche (atomic: EMT → OneClaim → EDSD → Fee → Burn → Receipt)
   *
   * This is the primary method edma-ops calls when a shipment milestone is ready.
   */
  async evaluateAndSettle(
    orderId: string,
    milestoneId: string,
    schemaId: string,
    povHash: string,
    attestations: Attestation[],
    uniquenessKey: string
  ): Promise<{ gateResult: GateResult; settlement?: SettlementResult }> {
    // Step 1: Evaluate
    const evalTx = await this.povGate.evaluateClaim(
      orderId, milestoneId, schemaId, povHash,
      attestations.map(a => [a.attestor, a.role, a.evidenceHash, a.timestamp, a.signature]),
      uniquenessKey
    );
    const evalReceipt = await evalTx.wait();

    // Check for GatePass event
    const gatePassLog = evalReceipt.logs.find(
      (l: any) => l.fragment?.name === "GatePass"
    );

    if (!gatePassLog) {
      // Gate returned FAIL
      const failLog = evalReceipt.logs.find((l: any) => l.fragment?.name === "GateFail");
      return {
        gateResult: {
          pass: false,
          gatePassId: ethers.ZeroHash,
          claimId: ethers.ZeroHash,
          outcome: failLog?.args?.outcome || 0,
          reason: failLog?.args?.reason || "Unknown failure",
        },
      };
    }

    const gatePassId = gatePassLog.args.gatePassId;
    const claimId = gatePassLog.args.claimId;

    // Step 2: Settle
    const settleTx = await this.settlement.settleTrancheOnPass(
      orderId, milestoneId, gatePassId, uniquenessKey, povHash
    );
    const settleReceipt = await settleTx.wait();

    const settleEvent = settleReceipt.logs.find(
      (l: any) => l.fragment?.name === "MilestoneSettled"
    );

    return {
      gateResult: {
        pass: true,
        gatePassId,
        claimId,
        outcome: 0,
        reason: "PASS",
      },
      settlement: settleEvent ? {
        receiptId: settleEvent.args.receiptId,
        orderId: settleEvent.args.orderId,
        milestoneId: settleEvent.args.milestoneId,
        trancheGross: settleEvent.args.trancheGross,
        platformFee: settleEvent.args.platformFee,
        burnAmount: settleEvent.args.burnAmount,
        burnHash: settleEvent.args.burnHash,
        netToBeneficiary: settleEvent.args.netToBeneficiary,
      } : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Queries
  // ═══════════════════════════════════════════════════════════════════════════

  async isClaimAvailable(uniquenessKey: string): Promise<boolean> {
    return this.oneClaim.isAvailable(uniquenessKey);
  }

  async getLockedAmount(orderId: string, milestoneId: string, supplier: string): Promise<bigint> {
    return this.edsd.getLockedAmount(orderId, milestoneId, supplier);
  }

  async isMilestoneUnlocked(orderId: string, milestoneId: string, supplier: string): Promise<boolean> {
    return this.edsd.isUnlocked(orderId, milestoneId, supplier);
  }

  async isAttestorActive(address: string): Promise<boolean> {
    return this.attestorRegistry.isActive(address);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Event Listeners (for webhook dispatch to edma-ops)
  // ═══════════════════════════════════════════════════════════════════════════

  onMilestoneSettled(callback: (event: SettlementResult) => void): void {
    this.settlement.on("MilestoneSettled", (
      orderId: string, milestoneId: string, receiptId: string, burnHash: string,
      trancheGross: bigint, platformFee: bigint, burnAmount: bigint, netToBeneficiary: bigint
    ) => {
      callback({
        receiptId, orderId, milestoneId,
        trancheGross, platformFee, burnAmount, burnHash, netToBeneficiary,
      });
    });
  }

  onGatePass(callback: (orderId: string, milestoneId: string, gatePassId: string) => void): void {
    this.povGate.on("GatePass", (orderId: string, milestoneId: string, gatePassId: string) => {
      callback(orderId, milestoneId, gatePassId);
    });
  }

  onGateFail(callback: (orderId: string, milestoneId: string, reason: string) => void): void {
    this.povGate.on("GateFail", (orderId: string, milestoneId: string, _outcome: number, reason: string) => {
      callback(orderId, milestoneId, reason);
    });
  }

  removeAllListeners(): void {
    this.povGate.removeAllListeners();
    this.settlement.removeAllListeners();
    this.oneClaim.removeAllListeners();
  }
}
