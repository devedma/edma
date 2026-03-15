// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title CertificateNFT — Tradable/retirable energy and carbon certificates
/// @notice ERC-721 with embedded provenance, Registry Mirror binding, and irreversible retirement.
///         Canon reference: PoV-Gate Baseline Rules v1.0 CONVERT_CERT
contract CertificateNFT is ERC721 {

    struct CertData {
        bytes32 certType;           // REC, GO, VCU, SREC, etc.
        bytes32 registryId;         // External registry (Verra, I-REC, PJM-GATS)
        string serialNumber;        // External serial bound via Registry Mirror
        bytes32 corridorId;
        bytes32 povHash;
        uint256[] sourceETTs;       // Provenance chain
        uint256 mintedAt;
        bool retired;
        bytes32 retirementReceiptId;
        uint256 retiredAt;
    }

    mapping(uint256 => CertData) public certs;
    uint256 public totalMinted;
    uint256 public totalRetired;

    address public settlementController;
    address public admin;

    event CertificateMinted(uint256 indexed tokenId, bytes32 certType, bytes32 registryId, string serialNumber);
    event CertificateRetired(uint256 indexed tokenId, bytes32 receiptId, uint256 timestamp);

    modifier onlySettlement() { require(msg.sender == settlementController, "CertNFT: not settlement"); _; }
    modifier onlyAdmin() { require(msg.sender == admin, "CertNFT: not admin"); _; }

    constructor(address _admin) ERC721("EDMA Certificate", "EDMA-CERT") {
        require(_admin != address(0), "CertNFT: zero admin");
        admin = _admin;
    }

    function setSettlementController(address _sc) external onlyAdmin { settlementController = _sc; }

    function mint(
        address to,
        bytes32 certType,
        bytes32 registryId,
        string calldata serialNumber,
        bytes32 corridorId,
        bytes32 povHash,
        uint256[] calldata sourceETTs
    ) external onlySettlement returns (uint256 tokenId) {
        totalMinted++;
        tokenId = totalMinted;

        _mint(to, tokenId);

        certs[tokenId] = CertData({
            certType: certType,
            registryId: registryId,
            serialNumber: serialNumber,
            corridorId: corridorId,
            povHash: povHash,
            sourceETTs: sourceETTs,
            mintedAt: block.timestamp,
            retired: false,
            retirementReceiptId: bytes32(0),
            retiredAt: 0
        });

        emit CertificateMinted(tokenId, certType, registryId, serialNumber);
    }

    /// @notice Retire a certificate — irreversible. Freezes the NFT permanently.
    function retire(uint256 tokenId, bytes32 receiptId) external onlySettlement {
        require(ownerOf(tokenId) != address(0), "CertNFT: not found");
        require(!certs[tokenId].retired, "CertNFT: already retired");

        certs[tokenId].retired = true;
        certs[tokenId].retirementReceiptId = receiptId;
        certs[tokenId].retiredAt = block.timestamp;
        totalRetired++;

        emit CertificateRetired(tokenId, receiptId, block.timestamp);
    }

    /// @dev Block transfers of retired certificates
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        // Allow minting (from == 0) and burning (to == 0)
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(!certs[tokenId].retired, "CertNFT: retired certificates are frozen");
        }
        return super._update(to, tokenId, auth);
    }

    function getCert(uint256 tokenId) external view returns (CertData memory) { return certs[tokenId]; }
    function isRetired(uint256 tokenId) external view returns (bool) { return certs[tokenId].retired; }
}
