// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title EDSD — Platform-bound settlement stablecoin
/// @notice Minted 1:1 on buyer funding, Locked by supplier/stage, Unlocked on proof, Burned on payout.
///         EDSD never leaves the rail mid-schedule. Transfers are restricted to authorized controllers.
///         Canon reference: Tariff & Rails-Policy v1.0, Receipt v1 Spec §3.3
/// @dev INVARIANT I-4: Locked → Unlocked ONLY on proof (via SettlementController after EMT).
contract EDSD is ERC20 {

    // ─── Access Control ─────────────────────────────────────────────────────────
    address public admin;
    mapping(address => bool) public authorizedControllers;

    // ─── Lock Tracking ──────────────────────────────────────────────────────────
    /// @dev lockKey = keccak256(orderId, milestoneId, supplier)
    mapping(bytes32 => uint256) public lockedAmounts;
    mapping(bytes32 => bool) public lockUnlocked;

    uint256 public totalLocked;
    uint256 public totalBurned;

    modifier onlyAuthorized() {
        require(authorizedControllers[msg.sender], "EDSD: not authorized");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "EDSD: not admin");
        _;
    }

    constructor(address _admin) ERC20("EDMA Settlement Dollar", "EDSD") {
        require(_admin != address(0), "EDSD: zero admin");
        admin = _admin;
    }

    function decimals() public pure override returns (uint8) {
        return 6; // USD-denominated, 6 decimals like USDC
    }

    function setAuthorized(address controller, bool authorized) external onlyAdmin {
        authorizedControllers[controller] = authorized;
    }

    // ─── Mint (buyer funds the order) ───────────────────────────────────────────
    function mint(address to, uint256 amount) external onlyAuthorized {
        require(to != address(0), "EDSD: mint to zero");
        require(amount > 0, "EDSD: zero amount");
        _mint(to, amount);
    }

    // ─── Lock (assign to supplier + milestone) ──────────────────────────────────
    function lock(
        bytes32 orderId,
        bytes32 milestoneId,
        address supplier,
        uint256 amount
    ) external onlyAuthorized {
        bytes32 lockKey = _lockKey(orderId, milestoneId, supplier);
        require(!lockUnlocked[lockKey], "EDSD: already unlocked");

        lockedAmounts[lockKey] += amount;
        totalLocked += amount;
    }

    // ─── Unlock (INVARIANT I-4: only after EMT mint) ────────────────────────────
    function unlock(
        bytes32 orderId,
        bytes32 milestoneId,
        address supplier,
        uint256 amount
    ) external onlyAuthorized {
        bytes32 lockKey = _lockKey(orderId, milestoneId, supplier);
        require(lockedAmounts[lockKey] >= amount, "EDSD: insufficient locked");
        require(!lockUnlocked[lockKey], "EDSD: already unlocked");

        lockedAmounts[lockKey] -= amount;
        totalLocked -= amount;
        lockUnlocked[lockKey] = true;
    }

    // ─── Burn (on fiat payout to supplier) ──────────────────────────────────────
    function burn(address from, uint256 amount) external onlyAuthorized {
        require(amount > 0, "EDSD: zero burn");
        _burn(from, amount);
        totalBurned += amount;
    }

    // ─── Query ──────────────────────────────────────────────────────────────────
    function getLockedAmount(
        bytes32 orderId,
        bytes32 milestoneId,
        address supplier
    ) external view returns (uint256) {
        return lockedAmounts[_lockKey(orderId, milestoneId, supplier)];
    }

    function isUnlocked(
        bytes32 orderId,
        bytes32 milestoneId,
        address supplier
    ) external view returns (bool) {
        return lockUnlocked[_lockKey(orderId, milestoneId, supplier)];
    }

    // ─── Transfer Restriction (platform-bound) ──────────────────────────────────
    /// @dev Only authorized controllers can move EDSD. Users cannot transfer freely.
    function _update(address from, address to, uint256 amount) internal override {
        // Allow minting (from == 0) and burning (to == 0) from authorized
        // Allow transfers only between authorized controllers
        if (from != address(0) && to != address(0)) {
            require(
                authorizedControllers[msg.sender],
                "EDSD: transfers restricted to authorized controllers"
            );
        }
        super._update(from, to, amount);
    }

    // ─── Internal ───────────────────────────────────────────────────────────────
    function _lockKey(bytes32 orderId, bytes32 milestoneId, address supplier) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(orderId, milestoneId, supplier));
    }
}
