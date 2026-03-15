// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";

/// @title EMT — Event/Milestone Token
/// @notice Non-transferable, single-use token proving a milestone passed PoV.
///         Minted by SettlementController on Gate PASS; consumed immediately
///         to flip Locked → Unlocked EDSD. Soulbound to the order.
///         Canon reference: §7 Architecture — About Edma
contract EMT {

    mapping(bytes32 => EdmaTypes.EMTRecord) public records;
    mapping(bytes32 => bool) public exists;
    uint256 public totalMinted;

    address public settlementController;

    event EMTMinted(bytes32 indexed emtId, bytes32 indexed orderId, bytes32 milestoneId, uint256 trancheGross);
    event EMTConsumed(bytes32 indexed emtId, bytes32 indexed orderId, bytes32 milestoneId);

    modifier onlySettlement() {
        require(msg.sender == settlementController, "EMT: not settlement");
        _;
    }

    constructor(address _settlementController) {
        require(_settlementController != address(0), "EMT: zero address");
        settlementController = _settlementController;
    }

    /// @notice Mint a new EMT for a milestone that passed PoV Gate
    function mint(
        bytes32 emtId,
        bytes32 orderId,
        bytes32 milestoneId,
        bytes32 gatePassId,
        bytes32 povHash,
        uint256 trancheGross
    ) external onlySettlement returns (bytes32) {
        require(!exists[emtId], "EMT: already exists");

        records[emtId] = EdmaTypes.EMTRecord({
            orderId: orderId,
            milestoneId: milestoneId,
            gatePassId: gatePassId,
            povHash: povHash,
            trancheGross: trancheGross,
            mintedAt: block.timestamp,
            consumed: false
        });
        exists[emtId] = true;
        totalMinted++;

        emit EMTMinted(emtId, orderId, milestoneId, trancheGross);
        return emtId;
    }

    /// @notice Consume an EMT (marks it as used — irreversible)
    function consume(bytes32 emtId) external onlySettlement {
        require(exists[emtId], "EMT: does not exist");
        require(!records[emtId].consumed, "EMT: already consumed");
        records[emtId].consumed = true;
        emit EMTConsumed(emtId, records[emtId].orderId, records[emtId].milestoneId);
    }

    function isConsumed(bytes32 emtId) external view returns (bool) {
        return records[emtId].consumed;
    }

    function getRecord(bytes32 emtId) external view returns (EdmaTypes.EMTRecord memory) {
        return records[emtId];
    }
}
