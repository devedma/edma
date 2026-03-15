// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";
import {IOneClaimLedger} from "../interfaces/IOneClaimLedger.sol";

/// @title OneClaimLedger — Global evidence uniqueness on EDMA
/// @notice The same fact pattern can support exactly ONE monetization claim.
///         Atomic reserve-finalize in a single transaction prevents race conditions.
///         Canon reference: PoV-Gate Baseline Rules v1.0 §6
/// @dev INVARIANT I-2: One-Claim enforcement is immutable and cannot be disabled.
contract OneClaimLedger is IOneClaimLedger {

    // ─── State ──────────────────────────────────────────────────────────────────
    mapping(bytes32 => EdmaTypes.ClaimRecord) private _claims;
    uint256 private _claimNonce;

    // ─── Access Control ─────────────────────────────────────────────────────────
    address public admin;
    address public povGate;
    address public settlementController;

    modifier onlyPoVGate() {
        require(msg.sender == povGate, "OneClaim: caller is not PoVGate");
        _;
    }

    modifier onlySettlementController() {
        require(msg.sender == settlementController, "OneClaim: caller is not SettlementController");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "OneClaim: not admin");
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────────
    constructor(address _admin) {
        require(_admin != address(0), "OneClaim: zero admin");
        admin = _admin;
    }

    /// @notice Set authorized callers (one-time setup after deployment)
    function setPoVGate(address _povGate) external onlyAdmin {
        require(_povGate != address(0), "OneClaim: zero PoVGate");
        require(povGate == address(0), "OneClaim: PoVGate already set");
        povGate = _povGate;
    }

    function setSettlementController(address _sc) external onlyAdmin {
        require(_sc != address(0), "OneClaim: zero SC");
        require(settlementController == address(0), "OneClaim: SC already set");
        settlementController = _sc;
    }

    // ─── Reserve (Canon §6: idempotency + uniqueness) ───────────────────────────
    /// @inheritdoc IOneClaimLedger
    function reserve(bytes32 uniquenessKey) external onlyPoVGate returns (bytes32 claimId) {
        EdmaTypes.ClaimRecord storage record = _claims[uniquenessKey];

        // FINALIZED claims are permanently taken — collision
        if (record.status == EdmaTypes.ClaimStatus.FINALIZED) {
            emit ClaimCollision(uniquenessKey, record.claimId);
            revert("OneClaim: FAIL_DUPLICATE — key already finalized");
        }

        // RESERVED from a different block means that tx reverted — treat as FREE
        if (record.status == EdmaTypes.ClaimStatus.RESERVED && record.blockReserved != block.number) {
            // Auto-expire stale reservation
            record.status = EdmaTypes.ClaimStatus.FREE;
        }

        // RESERVED in the same block means duplicate call within same tx — reject
        if (record.status == EdmaTypes.ClaimStatus.RESERVED) {
            revert("OneClaim: already reserved in this block");
        }

        // FREE — reserve it
        _claimNonce++;
        claimId = keccak256(abi.encodePacked(uniquenessKey, block.number, _claimNonce));

        record.status = EdmaTypes.ClaimStatus.RESERVED;
        record.claimId = claimId;
        record.blockReserved = block.number;

        emit ClaimReserved(uniquenessKey, claimId, block.number);
    }

    // ─── Finalize ───────────────────────────────────────────────────────────────
    /// @inheritdoc IOneClaimLedger
    function finalize(bytes32 uniquenessKey) external onlySettlementController {
        EdmaTypes.ClaimRecord storage record = _claims[uniquenessKey];

        require(
            record.status == EdmaTypes.ClaimStatus.RESERVED,
            "OneClaim: can only finalize RESERVED claims"
        );
        require(
            record.blockReserved == block.number,
            "OneClaim: reservation expired (different block)"
        );

        record.status = EdmaTypes.ClaimStatus.FINALIZED;

        emit ClaimFinalized(uniquenessKey, record.claimId, record.orderId);
    }

    // ─── Queries ────────────────────────────────────────────────────────────────
    /// @inheritdoc IOneClaimLedger
    function isAvailable(bytes32 uniquenessKey) external view returns (bool) {
        EdmaTypes.ClaimRecord storage record = _claims[uniquenessKey];
        if (record.status == EdmaTypes.ClaimStatus.FREE) return true;
        if (record.status == EdmaTypes.ClaimStatus.FINALIZED) return false;
        // RESERVED from a previous block = auto-expired = available
        if (record.status == EdmaTypes.ClaimStatus.RESERVED && record.blockReserved != block.number) {
            return true;
        }
        return false;
    }

    /// @inheritdoc IOneClaimLedger
    function getClaim(bytes32 uniquenessKey) external view returns (EdmaTypes.ClaimRecord memory) {
        return _claims[uniquenessKey];
    }
}
