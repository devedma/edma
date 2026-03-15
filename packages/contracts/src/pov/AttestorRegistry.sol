// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";
import {IAttestorRegistry} from "../interfaces/IAttestorRegistry.sol";

/// @title AttestorRegistry — Attestor key, role, and SLA management
/// @notice Canon reference: PoV-Gate Baseline Rules v1.0 §4, Attestor SLA clause §1–§7
contract AttestorRegistry is IAttestorRegistry {

    // ─── State ──────────────────────────────────────────────────────────────────
    mapping(address => EdmaTypes.AttestorRecord) private _attestors;
    mapping(address => mapping(bytes32 => bool)) private _roleMap;
    mapping(bytes32 => address[]) private _orgAttestors; // orgIdHash → attestor addresses

    address public admin;
    address public povGate;

    // ─── SLA Thresholds (Canon §2.1–2.3) ────────────────────────────────────────
    uint256 public constant MAX_REVERSAL_RATE_BPS = 50; // 0.50%
    uint256 public constant MIN_SLA_PASS_RATE_BPS = 9000; // 90%

    modifier onlyAdmin() {
        require(msg.sender == admin, "AttestorRegistry: not admin");
        _;
    }

    modifier onlyPoVGate() {
        require(msg.sender == povGate, "AttestorRegistry: not PoVGate");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "AttestorRegistry: zero admin");
        admin = _admin;
    }

    function setPoVGate(address _povGate) external onlyAdmin {
        require(_povGate != address(0), "AttestorRegistry: zero PoVGate");
        povGate = _povGate;
    }

    // ─── Registration ───────────────────────────────────────────────────────────
    function registerAttestor(
        address keyAddress,
        bytes32 orgIdHash,
        bytes32[] calldata roles
    ) external onlyAdmin {
        require(keyAddress != address(0), "AttestorRegistry: zero key");
        require(orgIdHash != bytes32(0), "AttestorRegistry: zero orgId");
        require(roles.length > 0, "AttestorRegistry: no roles");
        require(
            _attestors[keyAddress].status == EdmaTypes.AttestorStatus.INACTIVE,
            "AttestorRegistry: already registered"
        );

        EdmaTypes.AttestorRecord storage rec = _attestors[keyAddress];
        rec.keyAddress = keyAddress;
        rec.orgIdHash = orgIdHash;
        rec.roles = roles;
        rec.status = EdmaTypes.AttestorStatus.ACTIVE;
        rec.registeredAt = block.timestamp;

        for (uint256 i = 0; i < roles.length; i++) {
            _roleMap[keyAddress][roles[i]] = true;
        }
        _orgAttestors[orgIdHash].push(keyAddress);

        emit AttestorRegistered(keyAddress, orgIdHash, roles);
    }

    // ─── Queries ────────────────────────────────────────────────────────────────
    function getAttestor(address keyAddress) external view returns (EdmaTypes.AttestorRecord memory) {
        return _attestors[keyAddress];
    }

    function isActive(address keyAddress) external view returns (bool) {
        return _attestors[keyAddress].status == EdmaTypes.AttestorStatus.ACTIVE;
    }

    function hasRole(address keyAddress, bytes32 role) external view returns (bool) {
        return _roleMap[keyAddress][role] && _attestors[keyAddress].status == EdmaTypes.AttestorStatus.ACTIVE;
    }

    function getOrgId(address keyAddress) external view returns (bytes32) {
        return _attestors[keyAddress].orgIdHash;
    }

    /// @notice Check if two attestors belong to the same organization
    function sameOrg(address a, address b) external view returns (bool) {
        return _attestors[a].orgIdHash == _attestors[b].orgIdHash
            && _attestors[a].orgIdHash != bytes32(0);
    }

    // ─── SLA Recording (called by PoVGate) ──────────────────────────────────────
    function recordPass(address keyAddress, uint256 latencyMs) external onlyPoVGate {
        _attestors[keyAddress].passCount++;
        _attestors[keyAddress].totalLatencyMs += latencyMs;
    }

    function recordFail(address keyAddress) external onlyPoVGate {
        _attestors[keyAddress].failCount++;
    }

    function recordReversal(address keyAddress) external onlyPoVGate {
        EdmaTypes.AttestorRecord storage rec = _attestors[keyAddress];
        rec.reversalCount++;

        // Auto-suspend if reversal rate exceeds 0.5% (Canon §2.3)
        uint256 totalDecisions = rec.passCount + rec.failCount;
        if (totalDecisions > 0) {
            uint256 reversalRateBps = (rec.reversalCount * 10000) / totalDecisions;
            if (reversalRateBps > MAX_REVERSAL_RATE_BPS) {
                rec.status = EdmaTypes.AttestorStatus.SUSPENDED;
                emit AttestorSuspended(keyAddress, "Auto: reversal rate > 0.50%");
            }
        }
    }

    // ─── Admin Actions ──────────────────────────────────────────────────────────
    function suspend(address keyAddress, string calldata reason) external onlyAdmin {
        require(_attestors[keyAddress].status == EdmaTypes.AttestorStatus.ACTIVE, "AttestorRegistry: not active");
        _attestors[keyAddress].status = EdmaTypes.AttestorStatus.SUSPENDED;
        emit AttestorSuspended(keyAddress, reason);
    }

    function reinstate(address keyAddress) external onlyAdmin {
        require(_attestors[keyAddress].status == EdmaTypes.AttestorStatus.SUSPENDED, "AttestorRegistry: not suspended");
        _attestors[keyAddress].status = EdmaTypes.AttestorStatus.ACTIVE;
        emit AttestorReinstated(keyAddress);
    }

    function revoke(address keyAddress) external onlyAdmin {
        require(
            _attestors[keyAddress].status != EdmaTypes.AttestorStatus.INACTIVE,
            "AttestorRegistry: not registered"
        );
        _attestors[keyAddress].status = EdmaTypes.AttestorStatus.REVOKED;
        emit AttestorRevoked(keyAddress);
    }
}
