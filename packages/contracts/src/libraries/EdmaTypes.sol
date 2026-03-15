// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title EdmaTypes — Canonical types for the EDMA L2 protocol
/// @notice Shared structs and enums used across PoV, Settlement, and Asset contracts.
///         Canon reference: PoV-Gate Baseline Rules v1.0, Receipt v1 Spec v1.0
library EdmaTypes {

    // ─── Attestor Roles (Canon §4) ──────────────────────────────────────────────
    bytes32 constant ROLE_TITLE           = keccak256("TITLE");
    bytes32 constant ROLE_CUSTOMS         = keccak256("CUSTOMS");
    bytes32 constant ROLE_FORWARDER       = keccak256("FORWARDER/TERMINAL");
    bytes32 constant ROLE_QA_LAB          = keccak256("QA_LAB");
    bytes32 constant ROLE_IOT_COLDCHAIN   = keccak256("IOT/COLDCHAIN");
    bytes32 constant ROLE_INSTALLER       = keccak256("INSTALLER/O&M");

    // ─── Gate Outcomes (Canon §7) ───────────────────────────────────────────────
    enum GateOutcome {
        PASS,
        FAIL_INCOMPLETE,     // NEED_MORE — required evidence missing
        FAIL_SIG,            // Signature invalid or key not active
        FAIL_CONFLICT,       // Role diversity violation or evidence mismatch
        FAIL_DUPLICATE,      // One-Claim collision
        FAIL_STALE,          // Attestation outside freshness window
        FAIL_PENDING_FUNDS,  // Must-fund not met
        FAIL_REVOKED         // Counted attestation is revoked
    }

    // ─── Gate Result ────────────────────────────────────────────────────────────
    struct GateResult {
        bool pass;
        bytes32 gatePassId;      // Single-use, valid in same tx
        bytes32 claimId;         // One-Claim reservation
        GateOutcome outcome;
        string reason;           // Human-readable (e.g., "E_SEAL_MISMATCH")
    }

    // ─── Attestation (submitted to Gate) ────────────────────────────────────────
    struct Attestation {
        address attestor;        // Must be registered in AttestorRegistry
        bytes32 role;            // One of the ROLE_* constants
        bytes32 evidenceHash;    // Must equal the povHash being evaluated
        uint256 timestamp;       // When attestor signed
        bytes signature;         // EIP-712 signature over (orderId, milestoneId, povHash)
    }

    // ─── One-Claim Status ───────────────────────────────────────────────────────
    enum ClaimStatus {
        FREE,
        RESERVED,
        FINALIZED
    }

    struct ClaimRecord {
        ClaimStatus status;
        bytes32 claimId;         // UUID of the monetization claim
        bytes32 orderId;         // Associated order/listing
        uint256 blockReserved;   // Block number when reserved
    }

    // ─── Attestor Record ────────────────────────────────────────────────────────
    enum AttestorStatus {
        INACTIVE,
        ACTIVE,
        SUSPENDED,
        REVOKED
    }

    struct AttestorRecord {
        address keyAddress;
        bytes32 orgIdHash;       // SHA-256 of LEI/vLEI
        bytes32[] roles;
        AttestorStatus status;
        uint256 bondAmount;      // Staked EDM
        uint256 passCount;
        uint256 failCount;
        uint256 reversalCount;
        uint256 totalLatencyMs;
        uint256 registeredAt;
    }

    // ─── EDSD Lock State ────────────────────────────────────────────────────────
    enum EDSDState {
        LOCKED,
        UNLOCKED,
        BURNED
    }

    struct EDSDLock {
        bytes32 orderId;
        bytes32 milestoneId;
        address supplier;
        uint256 amount;
        EDSDState state;
    }

    // ─── EMT (Event/Milestone Token) ────────────────────────────────────────────
    struct EMTRecord {
        bytes32 orderId;
        bytes32 milestoneId;
        bytes32 gatePassId;
        bytes32 povHash;
        uint256 trancheGross;
        uint256 mintedAt;
        bool consumed;
    }

    // ─── Receipt (Canon §04 — Receipt v1 Spec) ─────────────────────────────────
    struct Receipt {
        bytes32 receiptId;
        bytes32 claimId;
        bytes32 orderId;
        bytes32 corridorId;
        bytes32 milestoneId;
        bytes32 povHash;
        uint256 trancheGross;
        uint256 platformFee;
        uint256 burnAmount;
        bytes32 burnHash;
        uint256 netToBeneficiary;
        uint256 timestamp;
    }

    // ─── Fee Codes (Canon §02 Tariff) ───────────────────────────────────────────
    bytes32 constant FEE_MILESTONE      = keccak256("MILESTONE_FEE");
    bytes32 constant FEE_SUPPLIER_SENDS = keccak256("SUPPLIER_SENDS");
    bytes32 constant FEE_ATTACH_BUYER   = keccak256("ATTACH_FEE_BUYER");
    bytes32 constant FEE_ATTACH_SELLER  = keccak256("ATTACH_FEE_SELLER");
}
