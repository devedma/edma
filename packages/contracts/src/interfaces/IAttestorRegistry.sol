// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {EdmaTypes} from "../libraries/EdmaTypes.sol";

/// @title IAttestorRegistry — Attestor lifecycle management
/// @notice Canon reference: PoV-Gate Baseline Rules v1.0 §4, Attestor SLA clause
interface IAttestorRegistry {

    function registerAttestor(
        address keyAddress,
        bytes32 orgIdHash,
        bytes32[] calldata roles
    ) external;

    function getAttestor(address keyAddress) external view returns (EdmaTypes.AttestorRecord memory);
    function isActive(address keyAddress) external view returns (bool);
    function hasRole(address keyAddress, bytes32 role) external view returns (bool);
    function getOrgId(address keyAddress) external view returns (bytes32);
    function suspend(address keyAddress, string calldata reason) external;
    function reinstate(address keyAddress) external;
    function revoke(address keyAddress) external;

    function recordPass(address keyAddress, uint256 latencyMs) external;
    function recordFail(address keyAddress) external;
    function recordReversal(address keyAddress) external;

    event AttestorRegistered(address indexed keyAddress, bytes32 orgIdHash, bytes32[] roles);
    event AttestorSuspended(address indexed keyAddress, string reason);
    event AttestorReinstated(address indexed keyAddress);
    event AttestorRevoked(address indexed keyAddress);
}
