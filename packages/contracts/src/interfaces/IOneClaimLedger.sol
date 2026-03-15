// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";

/// @title IOneClaimLedger — Interface for global evidence uniqueness
/// @notice Prevents duplicate use of the same evidence fact pattern anywhere on EDMA.
///         Canon reference: PoV-Gate Baseline Rules v1.0 §6
interface IOneClaimLedger {

    /// @notice Reserve a uniqueness key (called by PoVGate during evaluation)
    /// @dev Reverts if key is already FINALIZED. RESERVED keys from a different block
    ///      are treated as FREE (auto-expire from reverted transactions).
    /// @param uniquenessKey The key derived from evidence fact pattern
    /// @return claimId A new UUID for this monetization claim
    function reserve(bytes32 uniquenessKey) external returns (bytes32 claimId);

    /// @notice Finalize a reservation (called by SettlementController after successful settlement)
    /// @param uniquenessKey The key to finalize
    function finalize(bytes32 uniquenessKey) external;

    /// @notice Check if a uniqueness key is available
    function isAvailable(bytes32 uniquenessKey) external view returns (bool);

    /// @notice Get the claim record for a uniqueness key
    function getClaim(bytes32 uniquenessKey) external view returns (EdmaTypes.ClaimRecord memory);

    // ─── Events ─────────────────────────────────────────────────────────────────
    event ClaimReserved(bytes32 indexed uniquenessKey, bytes32 claimId, uint256 blockNumber);
    event ClaimFinalized(bytes32 indexed uniquenessKey, bytes32 claimId, bytes32 orderId);
    event ClaimCollision(bytes32 indexed uniquenessKey, bytes32 existingClaimId);
}
