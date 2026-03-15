// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title ParameterStore — Timelocked parameter governance for EDMA
/// @notice All tunable parameters live here with 72h timelock and bounded ranges.
///         INVARIANTS I-1 through I-5 are NOT stored here — they are hardcoded.
///         Canon reference: docs.edma.app §14 Governance
contract ParameterStore {

    struct PendingChange {
        bytes32 key;
        uint256 newValue;
        uint256 effectiveAfter;    // block.timestamp + TIMELOCK_DURATION
        bool exists;
    }

    // ─── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant TIMELOCK_DURATION = 72 hours;

    // ─── State ──────────────────────────────────────────────────────────────────
    mapping(bytes32 => uint256) public params;
    mapping(bytes32 => uint256) public minBounds;
    mapping(bytes32 => uint256) public maxBounds;
    mapping(bytes32 => PendingChange) public pendingChanges;

    address public admin;  // Will transition to DAO

    // ─── Well-Known Parameter Keys ──────────────────────────────────────────────
    bytes32 public constant BUYER_REVIEW_WINDOW = keccak256("BUYER_REVIEW_WINDOW");
    bytes32 public constant TOPUP_DEADLINE = keccak256("TOPUP_DEADLINE");
    bytes32 public constant DEFAULT_FRESHNESS_WINDOW = keccak256("DEFAULT_FRESHNESS_WINDOW");
    bytes32 public constant ATTESTOR_SUSPENSION_THRESHOLD = keccak256("ATTESTOR_SUSPENSION_THRESHOLD");

    event ParameterChangeProposed(bytes32 indexed key, uint256 currentValue, uint256 newValue, uint256 effectiveAfter);
    event ParameterChangeExecuted(bytes32 indexed key, uint256 oldValue, uint256 newValue);
    event ParameterChangeCancelled(bytes32 indexed key);

    modifier onlyAdmin() { require(msg.sender == admin, "ParamStore: not admin"); _; }

    constructor(address _admin) {
        require(_admin != address(0), "ParamStore: zero admin");
        admin = _admin;

        // Set defaults with bounds
        _initParam(BUYER_REVIEW_WINDOW, 2 hours, 0, 4 hours);
        _initParam(TOPUP_DEADLINE, 48 hours, 12 hours, 96 hours);
        _initParam(DEFAULT_FRESHNESS_WINDOW, 1 hours, 15 minutes, 24 hours);
        _initParam(ATTESTOR_SUSPENSION_THRESHOLD, 50, 10, 200); // bps (0.50% default)
    }

    function _initParam(bytes32 key, uint256 value, uint256 min, uint256 max) internal {
        params[key] = value;
        minBounds[key] = min;
        maxBounds[key] = max;
    }

    // ─── Propose Change (starts 72h timelock) ───────────────────────────────────
    function proposeChange(bytes32 key, uint256 newValue) external onlyAdmin {
        require(maxBounds[key] > 0 || minBounds[key] > 0 || params[key] > 0, "ParamStore: unknown key");
        require(newValue >= minBounds[key] && newValue <= maxBounds[key], "ParamStore: out of bounds");

        pendingChanges[key] = PendingChange({
            key: key,
            newValue: newValue,
            effectiveAfter: block.timestamp + TIMELOCK_DURATION,
            exists: true
        });

        emit ParameterChangeProposed(key, params[key], newValue, block.timestamp + TIMELOCK_DURATION);
    }

    // ─── Execute Change (after timelock expires) ────────────────────────────────
    function executeChange(bytes32 key) external onlyAdmin {
        PendingChange storage pending = pendingChanges[key];
        require(pending.exists, "ParamStore: no pending change");
        require(block.timestamp >= pending.effectiveAfter, "ParamStore: timelock not expired");

        uint256 oldValue = params[key];
        params[key] = pending.newValue;
        delete pendingChanges[key];

        emit ParameterChangeExecuted(key, oldValue, params[key]);
    }

    // ─── Cancel Pending Change ──────────────────────────────────────────────────
    function cancelChange(bytes32 key) external onlyAdmin {
        require(pendingChanges[key].exists, "ParamStore: no pending change");
        delete pendingChanges[key];
        emit ParameterChangeCancelled(key);
    }

    // ─── Query ──────────────────────────────────────────────────────────────────
    function get(bytes32 key) external view returns (uint256) { return params[key]; }
    function getBounds(bytes32 key) external view returns (uint256 min, uint256 max) {
        return (minBounds[key], maxBounds[key]);
    }
    function getPending(bytes32 key) external view returns (uint256 newValue, uint256 effectiveAfter, bool exists) {
        PendingChange storage p = pendingChanges[key];
        return (p.newValue, p.effectiveAfter, p.exists);
    }

    // ─── Admin Transfer (will become DAO) ───────────────────────────────────────
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "ParamStore: zero admin");
        admin = newAdmin;
    }
}
