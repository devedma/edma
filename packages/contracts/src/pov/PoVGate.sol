// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";
import {IPoVGate} from "../interfaces/IPoVGate.sol";
import {IOneClaimLedger} from "../interfaces/IOneClaimLedger.sol";
import {IAttestorRegistry} from "../interfaces/IAttestorRegistry.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title PoVGate — Proof-of-Verification admissibility gate
/// @notice The single contract that decides whether a claim is admissible on EDMA.
///         No state change (mint, settle, retire, convert) can occur without a PASS.
///         Canon reference: PoV-Gate Baseline Rules v1.0 §1–§7
/// @dev INVARIANT I-1: No EMT without Gate PASS. This is enforced in SettlementController.
contract PoVGate is IPoVGate {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Dependencies ───────────────────────────────────────────────────────────
    IOneClaimLedger public immutable oneClaim;
    IAttestorRegistry public immutable attestorRegistry;

    // ─── Schema Store ───────────────────────────────────────────────────────────
    /// @notice A Schema defines what the Gate checks for a given milestone type
    struct Schema {
        bytes32[] requiredRoles;          // Roles that must be present
        uint256 minAttestations;          // Minimum attestation count
        uint256 freshnessWindowSeconds;   // Max age of attestations
        bool requiresFunding;             // If true, checks EDSD locked amount
        bool active;
    }

    mapping(bytes32 => Schema) public schemas;
    address public admin;

    // ─── Gate Pass Tracking ─────────────────────────────────────────────────────
    struct GatePass {
        bool valid;
        uint256 blockIssued;
        bytes32 orderId;
        bytes32 milestoneId;
    }
    mapping(bytes32 => GatePass) private _passes;

    // ─── EIP-712 Domain ─────────────────────────────────────────────────────────
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(bytes32 orderId,bytes32 milestoneId,bytes32 povHash)"
    );
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ─── Settlement Controller (for funding checks) ─────────────────────────────
    address public settlementController;

    modifier onlyAdmin() {
        require(msg.sender == admin, "PoVGate: not admin");
        _;
    }

    modifier onlySettlementController() {
        require(msg.sender == settlementController, "PoVGate: not SettlementController");
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────────
    constructor(
        address _oneClaim,
        address _attestorRegistry,
        address _admin
    ) {
        require(_oneClaim != address(0) && _attestorRegistry != address(0) && _admin != address(0),
            "PoVGate: zero address");

        oneClaim = IOneClaimLedger(_oneClaim);
        attestorRegistry = IAttestorRegistry(_attestorRegistry);
        admin = _admin;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("EDMA PoV Gate"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    function setSettlementController(address _sc) external onlyAdmin {
        require(_sc != address(0), "PoVGate: zero SC");
        settlementController = _sc;
    }

    // ─── Schema Management ──────────────────────────────────────────────────────
    function setSchema(
        bytes32 schemaId,
        bytes32[] calldata requiredRoles,
        uint256 minAttestations,
        uint256 freshnessWindowSeconds,
        bool requiresFunding
    ) external onlyAdmin {
        require(requiredRoles.length > 0, "PoVGate: empty roles");
        require(minAttestations > 0, "PoVGate: zero min attestations");
        require(freshnessWindowSeconds >= 900, "PoVGate: freshness < 15 min"); // min 15 min

        schemas[schemaId] = Schema({
            requiredRoles: requiredRoles,
            minAttestations: minAttestations,
            freshnessWindowSeconds: freshnessWindowSeconds,
            requiresFunding: requiresFunding,
            active: true
        });
    }

    // ═════════════════════════════════════════════════════════════════════════════
    // CORE: evaluateClaim — Canon §7 decision logic
    // ═════════════════════════════════════════════════════════════════════════════
    /// @inheritdoc IPoVGate
    function evaluateClaim(
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 schemaId,
        bytes32 povHash,
        EdmaTypes.Attestation[] calldata attestations,
        bytes32 uniquenessKey
    ) external returns (EdmaTypes.GateResult memory result) {

        // ── Step 1: Schema lookup ───────────────────────────────────────────────
        Schema storage schema = schemas[schemaId];
        if (!schema.active) {
            return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_INCOMPLETE, "E_SCHEMA_NOT_FOUND");
        }

        // ── Step 2: Completeness — enough attestations? ─────────────────────────
        if (attestations.length < schema.minAttestations) {
            return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_INCOMPLETE, "E_INSUFFICIENT_ATTESTATIONS");
        }

        // ── Step 3–5: Validate each attestation ────────────────────────────────
        bytes32[] memory seenOrgs = new bytes32[](attestations.length);
        bool[] memory rolesFilled = new bool[](schema.requiredRoles.length);

        for (uint256 i = 0; i < attestations.length; i++) {
            EdmaTypes.Attestation calldata att = attestations[i];

            // Step 3: Signature verification
            bytes32 structHash = keccak256(abi.encode(
                ATTESTATION_TYPEHASH, orderId, milestoneId, povHash
            ));
            bytes32 digest = MessageHashUtils.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
            address recovered = ECDSA.recover(digest, att.signature);

            if (recovered != att.attestor) {
                return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_SIG, "E_SIG_MISMATCH");
            }

            // Check attestor is active
            if (!attestorRegistry.isActive(att.attestor)) {
                return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_REVOKED, "E_ATTESTOR_NOT_ACTIVE");
            }

            // Check attestor has the claimed role
            if (!attestorRegistry.hasRole(att.attestor, att.role)) {
                return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_SIG, "E_ROLE_NOT_ASSIGNED");
            }

            // Step 4: Equality — all attestations must reference the same povHash
            if (att.evidenceHash != povHash) {
                return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_CONFLICT, "E_HASH_MISMATCH");
            }

            // Step 5: Role diversity — no two required roles from same org
            bytes32 orgId = attestorRegistry.getOrgId(att.attestor);
            for (uint256 j = 0; j < i; j++) {
                if (seenOrgs[j] == orgId && orgId != bytes32(0)) {
                    return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_CONFLICT, "E_SAME_ORG_DUPLICATE");
                }
            }
            seenOrgs[i] = orgId;

            // Mark which required roles are filled
            for (uint256 r = 0; r < schema.requiredRoles.length; r++) {
                if (att.role == schema.requiredRoles[r] && !rolesFilled[r]) {
                    rolesFilled[r] = true;
                    break;
                }
            }

            // Step 7: Freshness check
            if (block.timestamp > att.timestamp + schema.freshnessWindowSeconds) {
                return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_STALE, "E_STALE_ATTESTATION");
            }
        }

        // Verify all required roles are filled
        for (uint256 r = 0; r < schema.requiredRoles.length; r++) {
            if (!rolesFilled[r]) {
                return _fail(orderId, milestoneId, EdmaTypes.GateOutcome.FAIL_INCOMPLETE, "E_QUORUM_MISSING");
            }
        }

        // ── Step 6: One-Claim reserve ───────────────────────────────────────────
        // This reverts on collision — caught by the caller
        bytes32 claimId = oneClaim.reserve(uniquenessKey);

        // ── Step 9: PASS ────────────────────────────────────────────────────────
        bytes32 gatePassId = keccak256(abi.encodePacked(
            orderId, milestoneId, povHash, block.number, address(this)
        ));

        // Store the gate pass
        _passes[gatePassId] = GatePass({
            valid: true,
            blockIssued: block.number,
            orderId: orderId,
            milestoneId: milestoneId
        });

        // Record SLA for attestors
        for (uint256 i = 0; i < attestations.length; i++) {
            uint256 latency = block.timestamp > attestations[i].timestamp
                ? (block.timestamp - attestations[i].timestamp) * 1000
                : 0;
            attestorRegistry.recordPass(attestations[i].attestor, latency);
        }

        result = EdmaTypes.GateResult({
            pass: true,
            gatePassId: gatePassId,
            claimId: claimId,
            outcome: EdmaTypes.GateOutcome.PASS,
            reason: "PASS"
        });

        emit GatePass(orderId, milestoneId, gatePassId, povHash, claimId);
    }

    // ─── Gate Pass Lifecycle ────────────────────────────────────────────────────
    /// @inheritdoc IPoVGate
    function isGatePassValid(bytes32 gatePassId) external view returns (bool) {
        GatePass storage gp = _passes[gatePassId];
        return gp.valid && gp.blockIssued == block.number;
    }

    /// @inheritdoc IPoVGate
    function consumeGatePass(bytes32 gatePassId) external onlySettlementController {
        GatePass storage gp = _passes[gatePassId];
        require(gp.valid, "PoVGate: invalid gate pass");
        require(gp.blockIssued == block.number, "PoVGate: gate pass expired (different block)");
        gp.valid = false;
    }

    // ─── Internal ───────────────────────────────────────────────────────────────
    function _fail(
        bytes32 orderId,
        bytes32 milestoneId,
        EdmaTypes.GateOutcome outcome,
        string memory reason
    ) internal returns (EdmaTypes.GateResult memory) {
        emit GateFail(orderId, milestoneId, outcome, reason);
        return EdmaTypes.GateResult({
            pass: false,
            gatePassId: bytes32(0),
            claimId: bytes32(0),
            outcome: outcome,
            reason: reason
        });
    }
}
