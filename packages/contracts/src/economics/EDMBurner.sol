// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title EDMBurner — Executes the 50% protocol fee burn in EDM
/// @notice Every protocol fee on EDMA burns exactly 50% in EDM. The burn hash
///         is recorded on the receipt and verifiable from L1.
///         Canon reference: Tariff & Rails-Policy v1.0, Invariant I-5
/// @dev INVARIANT I-5: 50% burn ratio is immutable. Burns stop at 100M supply floor.
contract EDMBurner {

    IERC20 public immutable edm;
    address public settlementController;
    address public admin;

    // Supply floor: burns stop when EDM circulating supply reaches 100M
    uint256 public constant SUPPLY_FLOOR = 100_000_000 ether; // 100M EDM (18 decimals)

    uint256 public totalBurned;
    uint256 public burnCount;

    event EDMBurned(
        bytes32 indexed orderId,
        bytes32 indexed milestoneId,
        uint256 amount,
        bytes32 burnHash,
        uint256 totalBurnedAfter
    );

    modifier onlySettlement() {
        require(msg.sender == settlementController, "EDMBurner: not settlement");
        _;
    }

    constructor(address _edm, address _admin) {
        require(_edm != address(0) && _admin != address(0), "EDMBurner: zero address");
        edm = IERC20(_edm);
        admin = _admin;
    }

    function setSettlementController(address _sc) external {
        require(msg.sender == admin, "EDMBurner: not admin");
        settlementController = _sc;
    }

    /// @notice Burn EDM as part of protocol fee settlement
    /// @param edmAmount Amount of EDM to burn
    /// @param orderId Associated order (for receipt linking)
    /// @param milestoneId Associated milestone
    /// @return burnHash Deterministic hash of this burn event
    function burn(
        uint256 edmAmount,
        bytes32 orderId,
        bytes32 milestoneId
    ) external onlySettlement returns (bytes32 burnHash) {
        // Check supply floor
        uint256 currentSupply = edm.totalSupply();
        if (currentSupply <= SUPPLY_FLOOR) {
            // Below floor — route to treasury instead of burning
            // Return a zero burn hash to indicate no burn occurred
            return bytes32(0);
        }

        // If burning would drop below floor, only burn down to the floor
        uint256 actualBurn = edmAmount;
        if (currentSupply - edmAmount < SUPPLY_FLOOR) {
            actualBurn = currentSupply - SUPPLY_FLOOR;
        }

        if (actualBurn > 0) {
            // Transfer EDM to this contract, then burn by sending to address(0xdead)
            // Using 0xdead instead of address(0) to avoid ERC20 zero-address revert
            require(
                edm.transferFrom(msg.sender, address(0xdEaD), actualBurn),
                "EDMBurner: transfer failed"
            );

            totalBurned += actualBurn;
            burnCount++;
        }

        // Generate deterministic burn hash
        burnHash = keccak256(abi.encodePacked(
            orderId,
            milestoneId,
            actualBurn,
            block.number,
            block.timestamp,
            burnCount
        ));

        emit EDMBurned(orderId, milestoneId, actualBurn, burnHash, totalBurned);
    }
}
