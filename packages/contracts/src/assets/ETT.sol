// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title ETT — Energy Tracking Token
/// @notice Non-transferable proof token. 1 ETT = 10 kWh verified renewable generation.
///         Minted only when PoV Gate passes a METER_WINDOW event.
///         Canon reference: PoV-Gate Baseline Rules v1.0 Table 3-A
contract ETT {

    struct ETTRecord {
        uint256 id;
        bytes32 deviceId;
        uint256 windowStart;
        uint256 windowEnd;
        uint256 kWh;
        bytes32 povHash;
        bytes32 claimId;
        address producer;
        uint256 mintedAt;
        bool consumed;
    }

    mapping(uint256 => ETTRecord) public tokens;
    mapping(address => uint256[]) public producerTokens;
    uint256 public totalMinted;
    uint256 public totalConsumed;

    address public settlementController;
    address public admin;

    event ETTMinted(uint256 indexed tokenId, address indexed producer, bytes32 deviceId, uint256 kWh, bytes32 povHash);
    event ETTConsumed(uint256 indexed tokenId, bytes32 reason);

    modifier onlySettlement() { require(msg.sender == settlementController, "ETT: not settlement"); _; }
    modifier onlyAdmin() { require(msg.sender == admin, "ETT: not admin"); _; }

    constructor(address _admin) {
        require(_admin != address(0), "ETT: zero admin");
        admin = _admin;
    }

    function setSettlementController(address _sc) external onlyAdmin { settlementController = _sc; }

    function mint(
        address producer, bytes32 deviceId, uint256 windowStart, uint256 windowEnd,
        uint256 kWh, bytes32 povHash, bytes32 claimId
    ) external onlySettlement returns (uint256 tokenId) {
        require(producer != address(0), "ETT: zero producer");
        require(kWh >= 10, "ETT: minimum 10 kWh");
        require(windowEnd > windowStart, "ETT: invalid window");

        totalMinted++;
        tokenId = totalMinted;
        tokens[tokenId] = ETTRecord(tokenId, deviceId, windowStart, windowEnd, kWh, povHash, claimId, producer, block.timestamp, false);
        producerTokens[producer].push(tokenId);
        emit ETTMinted(tokenId, producer, deviceId, kWh, povHash);
    }

    function consume(uint256 tokenId, bytes32 reason) external onlySettlement {
        require(tokens[tokenId].id != 0, "ETT: not found");
        require(!tokens[tokenId].consumed, "ETT: already consumed");
        tokens[tokenId].consumed = true;
        totalConsumed++;
        emit ETTConsumed(tokenId, reason);
    }

    function consumeBatch(uint256[] calldata tokenIds, bytes32 reason) external onlySettlement returns (uint256 totalKWh) {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(tokens[tokenIds[i]].id != 0 && !tokens[tokenIds[i]].consumed, "ETT: invalid");
            tokens[tokenIds[i]].consumed = true;
            totalConsumed++;
            totalKWh += tokens[tokenIds[i]].kWh;
            emit ETTConsumed(tokenIds[i], reason);
        }
    }

    function getToken(uint256 tokenId) external view returns (ETTRecord memory) { return tokens[tokenId]; }
    function getProducerTokenCount(address producer) external view returns (uint256) { return producerTokens[producer].length; }
}
