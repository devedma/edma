// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";
import {IPoVGate} from "../interfaces/IPoVGate.sol";

/// @title DemoSettler — Atomic evaluate + settle helper for live chain demos
/// @notice On a live L2 with 2-second blocks, evaluateClaim and settleTrancheOnPass
///         MUST be in the same block (gate pass and OneClaim reservation expire after
///         one block). This contract wraps both calls in a single transaction.
/// @dev For demo/testing only. In production, the SDK batches these via the sequencer.
interface ISettlementControllerSettle {
    function settleTrancheOnPass(
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 gatePassId,
        bytes32 uniquenessKey,
        bytes32 povHash
    ) external returns (bytes32 receiptId);
}

contract DemoSettler {

    event DemoSettlement(
        bytes32 indexed orderId,
        bytes32 indexed milestoneId,
        bytes32 gatePassId,
        bytes32 receiptId,
        bool gatePass
    );

    /// @notice Evaluate a claim at PoVGate and immediately settle at SettlementController
    /// @dev Both calls execute in the same transaction = same block = gate pass valid
    function evaluateAndSettle(
        address gate,
        address sc,
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 schemaId,
        bytes32 povHash,
        EdmaTypes.Attestation[] calldata attestations,
        bytes32 uniquenessKey
    ) external returns (bytes32 receiptId, bytes32 gatePassId) {

        // Step 1: Evaluate claim → get gate pass
        EdmaTypes.GateResult memory result = IPoVGate(gate).evaluateClaim(
            orderId, milestoneId, schemaId, povHash, attestations, uniquenessKey
        );
        require(result.pass, string(abi.encodePacked("Gate FAIL: ", result.reason)));
        gatePassId = result.gatePassId;

        // Step 2: Settle tranche (same block — gate pass is valid)
        receiptId = ISettlementControllerSettle(sc).settleTrancheOnPass(
            orderId, milestoneId, gatePassId, uniquenessKey, povHash
        );

        emit DemoSettlement(orderId, milestoneId, gatePassId, receiptId, true);
    }
}
