// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title RevocationManager — Freeze downstream slices on evidence revocation
/// @notice When evidence is revoked (e.g., BL rolled, QA invalidated), only downstream
///         milestones are frozen. Paid slices remain paid. History shows the delta.
///         Canon reference: PoV-Gate Baseline Rules v1.0 §7, Receipt v1 Spec §8
contract RevocationManager {

    enum RevocationStatus { NONE, ACTIVE, RESOLVED }

    struct Revocation {
        bytes32 revocationId;
        bytes32 orderId;
        bytes32 milestoneId;         // The milestone whose evidence is revoked
        bytes32 povHash;             // The evidence being revoked
        string reason;
        address initiator;
        uint256 createdAt;
        RevocationStatus status;
        bytes32 amendedReceiptId;    // Links to corrective receipt if resolved
    }

    mapping(bytes32 => Revocation) public revocations;
    mapping(bytes32 => bytes32[]) public orderRevocations;  // orderId → revocationIds
    mapping(bytes32 => bool) public frozenMilestones;       // key(orderId,milestoneId) → frozen

    uint256 public revocationCount;

    address public admin;
    address public settlementController;

    event RevocationCreated(bytes32 indexed revocationId, bytes32 indexed orderId, bytes32 milestoneId, string reason);
    event MilestoneFrozen(bytes32 indexed orderId, bytes32 milestoneId);
    event RevocationResolved(bytes32 indexed revocationId, bytes32 amendedReceiptId);
    event MilestoneUnfrozen(bytes32 indexed orderId, bytes32 milestoneId);

    modifier onlyAdmin() { require(msg.sender == admin, "Revocation: not admin"); _; }

    constructor(address _admin) {
        require(_admin != address(0), "Revocation: zero admin");
        admin = _admin;
    }

    function setSettlementController(address _sc) external onlyAdmin { settlementController = _sc; }

    /// @notice Create a revocation — freezes downstream milestones
    /// @param orderId The affected order
    /// @param milestoneId The milestone whose evidence is being revoked
    /// @param downstreamMilestones Milestones that should be frozen (not yet paid)
    function createRevocation(
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 povHash,
        string calldata reason,
        bytes32[] calldata downstreamMilestones
    ) external onlyAdmin returns (bytes32 revocationId) {
        revocationCount++;
        revocationId = keccak256(abi.encodePacked("REV", orderId, milestoneId, revocationCount));

        revocations[revocationId] = Revocation({
            revocationId: revocationId,
            orderId: orderId,
            milestoneId: milestoneId,
            povHash: povHash,
            reason: reason,
            initiator: msg.sender,
            createdAt: block.timestamp,
            status: RevocationStatus.ACTIVE,
            amendedReceiptId: bytes32(0)
        });

        orderRevocations[orderId].push(revocationId);

        // Freeze downstream milestones (narrow freeze — Canon §7)
        for (uint256 i = 0; i < downstreamMilestones.length; i++) {
            bytes32 freezeKey = keccak256(abi.encodePacked(orderId, downstreamMilestones[i]));
            frozenMilestones[freezeKey] = true;
            emit MilestoneFrozen(orderId, downstreamMilestones[i]);
        }

        emit RevocationCreated(revocationId, orderId, milestoneId, reason);
    }

    /// @notice Resolve a revocation with a corrective receipt
    function resolveRevocation(
        bytes32 revocationId,
        bytes32 amendedReceiptId,
        bytes32[] calldata milestonesToUnfreeze
    ) external onlyAdmin {
        Revocation storage rev = revocations[revocationId];
        require(rev.status == RevocationStatus.ACTIVE, "Revocation: not active");

        rev.status = RevocationStatus.RESOLVED;
        rev.amendedReceiptId = amendedReceiptId;

        for (uint256 i = 0; i < milestonesToUnfreeze.length; i++) {
            bytes32 freezeKey = keccak256(abi.encodePacked(rev.orderId, milestonesToUnfreeze[i]));
            frozenMilestones[freezeKey] = false;
            emit MilestoneUnfrozen(rev.orderId, milestonesToUnfreeze[i]);
        }

        emit RevocationResolved(revocationId, amendedReceiptId);
    }

    /// @notice Check if a milestone is frozen
    function isFrozen(bytes32 orderId, bytes32 milestoneId) external view returns (bool) {
        return frozenMilestones[keccak256(abi.encodePacked(orderId, milestoneId))];
    }

    function getRevocation(bytes32 revocationId) external view returns (Revocation memory) {
        return revocations[revocationId];
    }

    function getOrderRevocations(bytes32 orderId) external view returns (bytes32[] memory) {
        return orderRevocations[orderId];
    }
}
