// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";

/// @title IPoVGate — Interface for the Proof-of-Verification Gate
/// @notice The PoV Gate is the single admissibility check for all state changes on EDMA.
///         Canon reference: PoV-Gate Baseline Rules v1.0 §1–§7
interface IPoVGate {

    /// @notice Evaluate a claim against a milestone schema
    /// @param orderId The order or listing ID
    /// @param milestoneId The milestone being claimed (ON_BOARD, CUSTOMS, ARRIVAL_QA, etc.)
    /// @param schemaId The checklist schema to evaluate against
    /// @param povHash SHA-256 of the normalized evidence set
    /// @param attestations Array of role-signed attestations
    /// @param uniquenessKey The One-Claim key for this evidence
    /// @return result The gate evaluation result
    function evaluateClaim(
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 schemaId,
        bytes32 povHash,
        EdmaTypes.Attestation[] calldata attestations,
        bytes32 uniquenessKey
    ) external returns (EdmaTypes.GateResult memory result);

    /// @notice Check if a gate pass is valid (not yet consumed, same block)
    function isGatePassValid(bytes32 gatePassId) external view returns (bool);

    /// @notice Consume a gate pass (called by SettlementController)
    function consumeGatePass(bytes32 gatePassId) external;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event GatePass(
        bytes32 indexed orderId,
        bytes32 indexed milestoneId,
        bytes32 gatePassId,
        bytes32 povHash,
        bytes32 claimId
    );

    event GateFail(
        bytes32 indexed orderId,
        bytes32 indexed milestoneId,
        EdmaTypes.GateOutcome outcome,
        string reason
    );
}
