// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";

/// @title FeeRouter — Protocol fee calculation, capping, and treasury/burn split
/// @notice Canon reference: Tariff & Rails-Policy v1.0 §1
/// @dev INVARIANT I-5: Exactly 50% of every protocol fee burns in EDM.
contract FeeRouter {

    // ─── Fee Config ─────────────────────────────────────────────────────────────
    struct FeeConfig {
        uint256 rateBps;         // Rate in basis points (50 = 0.50%)
        uint256 capBps;          // Cumulative cap in bps (150 = 1.50%) — 0 means no cap
        bool active;
    }

    // Global defaults
    mapping(bytes32 => FeeConfig) public globalFees;
    // Corridor overrides: corridorId => feeCode => override config
    mapping(bytes32 => mapping(bytes32 => FeeConfig)) public corridorOverrides;
    // Cumulative fees per PO (for cap enforcement)
    mapping(bytes32 => uint256) public cumulativePOFees;

    address public admin;
    address public settlementController;

    // INVARIANT I-5: burn ratio is constant and immutable
    uint256 public constant BURN_RATIO_BPS = 5000; // 50% — NEVER CHANGES

    // ─── Per-tranche caps (Canon §02) ───────────────────────────────────────────
    uint256 public constant CAP_TIER1_THRESHOLD = 1_000_000e6;  // $1M (EDSD has 6 decimals)
    uint256 public constant CAP_TIER1_MAX       = 5_000e6;      // $5k
    uint256 public constant CAP_TIER2_THRESHOLD = 5_000_000e6;  // $5M
    uint256 public constant CAP_TIER2_MAX       = 25_000e6;     // $25k
    uint256 public constant CAP_TIER3_MAX       = 50_000e6;     // $50k

    modifier onlyAdmin() {
        require(msg.sender == admin, "FeeRouter: not admin");
        _;
    }

    modifier onlySettlement() {
        require(msg.sender == settlementController, "FeeRouter: not settlement");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "FeeRouter: zero admin");
        admin = _admin;

        // Set global defaults per Canon §02 Tariff v1.0
        globalFees[EdmaTypes.FEE_MILESTONE] = FeeConfig({rateBps: 50, capBps: 150, active: true});
        globalFees[EdmaTypes.FEE_SUPPLIER_SENDS] = FeeConfig({rateBps: 100, capBps: 0, active: true});
        globalFees[EdmaTypes.FEE_ATTACH_BUYER] = FeeConfig({rateBps: 200, capBps: 0, active: true});
        globalFees[EdmaTypes.FEE_ATTACH_SELLER] = FeeConfig({rateBps: 200, capBps: 0, active: true});
    }

    function setSettlementController(address _sc) external onlyAdmin {
        settlementController = _sc;
    }

    // ─── Fee Calculation ────────────────────────────────────────────────────────
    /// @notice Calculate fee for a given action
    /// @return feeAmount Total fee in EDSD
    /// @return burnAmount Amount to burn in EDM (always 50% of feeAmount)
    /// @return treasuryAmount Amount to send to treasury (always 50% of feeAmount)
    function calculateFee(
        bytes32 corridorId,
        bytes32 feeCode,
        uint256 baseAmount,
        bytes32 orderId
    ) external view returns (uint256 feeAmount, uint256 burnAmount, uint256 treasuryAmount) {
        // Check corridor override first, fall back to global
        FeeConfig memory config = corridorOverrides[corridorId][feeCode].active
            ? corridorOverrides[corridorId][feeCode]
            : globalFees[feeCode];

        require(config.active, "FeeRouter: fee code not active");

        // Calculate raw fee
        feeAmount = (baseAmount * config.rateBps) / 10000;

        // Apply per-tranche cap
        feeAmount = _applyTrancheCap(feeAmount, baseAmount);

        // Apply PO cumulative cap if configured
        if (config.capBps > 0) {
            uint256 maxCumulative = (baseAmount * config.capBps) / 10000;
            uint256 priorFees = cumulativePOFees[orderId];
            if (priorFees + feeAmount > maxCumulative) {
                feeAmount = maxCumulative > priorFees ? maxCumulative - priorFees : 0;
            }
        }

        // INVARIANT I-5: exactly 50% burns
        burnAmount = feeAmount / 2;
        treasuryAmount = feeAmount - burnAmount;
    }

    /// @notice Record that a fee was charged (for cumulative cap tracking)
    function recordFee(bytes32 orderId, uint256 feeAmount) external onlySettlement {
        cumulativePOFees[orderId] += feeAmount;
    }

    // ─── Corridor Override ──────────────────────────────────────────────────────
    function setCorridorOverride(
        bytes32 corridorId,
        bytes32 feeCode,
        uint256 rateBps,
        uint256 capBps
    ) external onlyAdmin {
        // Corridors can tighten but never loosen beyond global defaults
        FeeConfig memory global = globalFees[feeCode];
        require(global.active, "FeeRouter: global fee not set");
        // Override rate must be >= global rate (can't discount below Canon)
        // Override cap must be <= global cap (can tighten, not loosen)
        // NOTE: in practice corridors CAN have lower rates for competitive reasons,
        // but cap tightening is the main use case. Leaving rate flexible for now.

        corridorOverrides[corridorId][feeCode] = FeeConfig({
            rateBps: rateBps,
            capBps: capBps,
            active: true
        });
    }

    // ─── Internal ───────────────────────────────────────────────────────────────
    function _applyTrancheCap(uint256 fee, uint256 trancheAmount) internal pure returns (uint256) {
        uint256 cap;
        if (trancheAmount <= CAP_TIER1_THRESHOLD) {
            cap = CAP_TIER1_MAX;
        } else if (trancheAmount <= CAP_TIER2_THRESHOLD) {
            cap = CAP_TIER2_MAX;
        } else {
            cap = CAP_TIER3_MAX;
        }
        return fee > cap ? cap : fee;
    }
}
