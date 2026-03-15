// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";
import {IPoVGate} from "../interfaces/IPoVGate.sol";
import {IOneClaimLedger} from "../interfaces/IOneClaimLedger.sol";
import {EDSD} from "./EDSD.sol";
import {FeeRouter} from "../economics/FeeRouter.sol";
import {EDMBurner} from "../economics/EDMBurner.sol";

/// @title SettlementController — Atomic settlement orchestrator for EDMA
/// @notice Ties together: Gate PASS → EMT mint → One-Claim finalize →
///         Locked EDSD → Unlocked → Fee → Burn → Receipt — all in ONE transaction.
///         Canon reference: Receipt v1 Spec v1.0
/// @dev Enforces ALL five invariants:
///      I-1: No EMT, No Funds (requires gatePassId)
///      I-2: One-Claim (finalizes in same tx)
///      I-3: Must-Fund (checks locked EDSD present)
///      I-4: Locked→Unlocked only on proof (gated by EMT)
///      I-5: 50% Burns (via FeeRouter + EDMBurner)
contract SettlementController {

    // ─── Dependencies ───────────────────────────────────────────────────────────
    IPoVGate public immutable povGate;
    IOneClaimLedger public immutable oneClaim;
    EDSD public immutable edsd;
    FeeRouter public immutable feeRouter;
    EDMBurner public immutable edmBurner;

    address public admin;

    // ─── EMT Storage (soulbound, non-transferable) ──────────────────────────────
    mapping(bytes32 => EdmaTypes.EMTRecord) public emts;
    uint256 public emtCount;

    // ─── Milestone Schedule (orderId → milestoneId → config) ────────────────────
    struct MilestoneConfig {
        uint256 weightBps;          // e.g., 3000 = 30% of PO value
        address supplier;
        bytes32 corridorId;
        bool configured;
    }
    mapping(bytes32 => mapping(bytes32 => MilestoneConfig)) public milestones;
    mapping(bytes32 => uint256) public orderTotalValue;  // PO value in EDSD

    // ─── Receipt Counter ────────────────────────────────────────────────────────
    uint256 public receiptCount;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event EMTMinted(
        bytes32 indexed orderId,
        bytes32 indexed milestoneId,
        bytes32 emtId,
        bytes32 gatePassId,
        uint256 trancheGross
    );

    event MilestoneSettled(
        bytes32 indexed orderId,
        bytes32 indexed milestoneId,
        bytes32 receiptId,
        bytes32 burnHash,
        uint256 trancheGross,
        uint256 platformFee,
        uint256 burnAmount,
        uint256 netToBeneficiary
    );

    event ReceiptEmitted(
        bytes32 indexed receiptId,
        bytes32 orderId,
        bytes32 corridorId,
        bytes32 milestoneId,
        bytes32 povHash,
        bytes32 burnHash
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Settlement: not admin");
        _;
    }

    constructor(
        address _povGate,
        address _oneClaim,
        address _edsd,
        address _feeRouter,
        address _edmBurner,
        address _admin
    ) {
        require(
            _povGate != address(0) && _oneClaim != address(0) && _edsd != address(0)
            && _feeRouter != address(0) && _edmBurner != address(0) && _admin != address(0),
            "Settlement: zero address"
        );
        povGate = IPoVGate(_povGate);
        oneClaim = IOneClaimLedger(_oneClaim);
        edsd = EDSD(_edsd);
        feeRouter = FeeRouter(_feeRouter);
        edmBurner = EDMBurner(_edmBurner);
        admin = _admin;
    }

    // ─── Milestone Configuration ────────────────────────────────────────────────
    /// @notice Configure a milestone for an order (called during order setup)
    function configureMilestone(
        bytes32 orderId,
        bytes32 milestoneId,
        uint256 weightBps,
        address supplier,
        bytes32 corridorId,
        uint256 poTotalValue
    ) external onlyAdmin {
        milestones[orderId][milestoneId] = MilestoneConfig({
            weightBps: weightBps,
            supplier: supplier,
            corridorId: corridorId,
            configured: true
        });
        if (orderTotalValue[orderId] == 0) {
            orderTotalValue[orderId] = poTotalValue;
        }
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // CORE: settleTrancheOnPass — The atomic settlement transaction
    // ═════════════════════════════════════════════════════════════════════════════
    /// @notice Execute full settlement for a trade milestone that passed PoV Gate
    /// @dev This is a SINGLE TRANSACTION that enforces all 5 invariants
    function settleTrancheOnPass(
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 gatePassId,
        bytes32 uniquenessKey,
        bytes32 povHash
    ) external returns (bytes32 receiptId) {

        // ── I-1: No EMT without Gate PASS ───────────────────────────────────────
        require(povGate.isGatePassValid(gatePassId), "Settlement: invalid gate pass (I-1)");
        povGate.consumeGatePass(gatePassId);

        // ── Load milestone config ───────────────────────────────────────────────
        MilestoneConfig memory ms = milestones[orderId][milestoneId];
        require(ms.configured, "Settlement: milestone not configured");

        uint256 trancheGross = (orderTotalValue[orderId] * ms.weightBps) / 10000;
        require(trancheGross > 0, "Settlement: zero tranche");

        // ── I-3: Must-Fund — verify EDSD is locked ─────────────────────────────
        uint256 lockedAmount = edsd.getLockedAmount(orderId, milestoneId, ms.supplier);
        require(lockedAmount >= trancheGross, "Settlement: insufficient locked EDSD (I-3)");

        // ── Mint EMT ────────────────────────────────────────────────────────────
        emtCount++;
        bytes32 emtId = keccak256(abi.encodePacked("EMT", orderId, milestoneId, emtCount));

        emts[emtId] = EdmaTypes.EMTRecord({
            orderId: orderId,
            milestoneId: milestoneId,
            gatePassId: gatePassId,
            povHash: povHash,
            trancheGross: trancheGross,
            mintedAt: block.timestamp,
            consumed: false
        });

        emit EMTMinted(orderId, milestoneId, emtId, gatePassId, trancheGross);

        // ── I-2: Finalize One-Claim ─────────────────────────────────────────────
        oneClaim.finalize(uniquenessKey);

        // ── I-4: Flip Locked → Unlocked EDSD ────────────────────────────────────
        edsd.unlock(orderId, milestoneId, ms.supplier, trancheGross);

        // Mark EMT as consumed
        emts[emtId].consumed = true;

        // ── I-5: Fee calculation + 50% burn ─────────────────────────────────────
        (uint256 platformFee, uint256 burnAmount, uint256 treasuryAmount) =
            feeRouter.calculateFee(ms.corridorId, EdmaTypes.FEE_MILESTONE, trancheGross, orderId);

        // Record cumulative fee
        feeRouter.recordFee(orderId, platformFee);

        // Execute burn
        bytes32 burnHash = bytes32(0);
        if (burnAmount > 0) {
            burnHash = edmBurner.burn(burnAmount, orderId, milestoneId);
        }

        // ── Emit Receipt ────────────────────────────────────────────────────────
        receiptCount++;
        receiptId = keccak256(abi.encodePacked("RCP", orderId, milestoneId, receiptCount));

        uint256 netToBeneficiary = trancheGross - platformFee;

        emit MilestoneSettled(
            orderId, milestoneId, receiptId, burnHash,
            trancheGross, platformFee, burnAmount, netToBeneficiary
        );

        emit ReceiptEmitted(
            receiptId, orderId, ms.corridorId, milestoneId, povHash, burnHash
        );
    }
}
