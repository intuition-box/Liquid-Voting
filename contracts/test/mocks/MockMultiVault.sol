// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { IMultiVault } from "../../src/interfaces/IMultiVault.sol";

/// @title MockMultiVault
/// @notice Offline stand-in for the Intuition MultiVault so unit tests run without a
///         network. Mirrors the behaviors the enforcer depends on, verified against the
///         live testnet deployment on 2026-08-17:
///         - `getVaultType` REVERTS for a never-created term (the live vault does).
///         - `isTriple` is true for counter-triples too (the ADR 0005 trap).
///         Id math is deliberately NOT the live algorithm (which is not plain keccak):
///         ids are opaque to the enforcer — it only ever passes them back to the same
///         vault — so the mock uses its own prefixed-keccak scheme consistently.
contract MockMultiVault is IMultiVault {
    /// @notice Mirrors the live vault's revert on classifying a never-created term.
    error TermNotCreated(bytes32 termId);

    uint8 internal constant VAULT_TYPE_ATOM = 0;
    uint8 internal constant VAULT_TYPE_TRIPLE = 1;
    uint8 internal constant VAULT_TYPE_COUNTER_TRIPLE = 2;

    mapping(bytes32 => bool) private _created;
    mapping(bytes32 => uint8) private _vaultType;
    mapping(bytes32 => bytes32[3]) private _triples;
    mapping(address => mapping(bytes32 => mapping(uint256 => uint256))) private _shares;
    mapping(bytes32 => mapping(uint256 => uint256)) private _totalShares;

    address private _curveRegistry = address(0xC047FE);
    uint256 private _defaultCurveId = 1;

    ////////////////////////////// IMultiVault (read surface) //////////////////////////////

    /// @inheritdoc IMultiVault
    function calculateAtomId(bytes memory data) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("MOCK_ATOM", data));
    }

    /// @inheritdoc IMultiVault
    function calculateTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("MOCK_TRIPLE", subjectId, predicateId, objectId));
    }

    /// @inheritdoc IMultiVault
    function getTriple(bytes32 tripleId) external view returns (bytes32, bytes32, bytes32) {
        if (!_created[tripleId]) revert TermNotCreated(tripleId);
        bytes32[3] storage t = _triples[tripleId];
        return (t[0], t[1], t[2]);
    }

    /// @inheritdoc IMultiVault
    function getCounterIdFromTripleId(bytes32 tripleId) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("MOCK_COUNTER", tripleId));
    }

    /// @inheritdoc IMultiVault
    function isTermCreated(bytes32 termId) external view returns (bool) {
        return _created[termId];
    }

    /// @inheritdoc IMultiVault
    function isTriple(bytes32 termId) external view returns (bool) {
        // Coarse on purpose: true for counter-triples too, like the live vault.
        return _created[termId]
            && (_vaultType[termId] == VAULT_TYPE_TRIPLE || _vaultType[termId] == VAULT_TYPE_COUNTER_TRIPLE);
    }

    /// @inheritdoc IMultiVault
    function getVaultType(bytes32 termId) external view returns (uint8) {
        if (!_created[termId]) revert TermNotCreated(termId);
        return _vaultType[termId];
    }

    /// @inheritdoc IMultiVault
    function getShares(address account, bytes32 termId, uint256 curveId) external view returns (uint256) {
        return _shares[account][termId][curveId];
    }

    /// @inheritdoc IMultiVault
    function getVault(bytes32 termId, uint256 curveId) external view returns (uint256, uint256) {
        return (_totalShares[termId][curveId], _totalShares[termId][curveId]);
    }

    /// @inheritdoc IMultiVault
    function getBondingCurveConfig() external view returns (address, uint256) {
        return (_curveRegistry, _defaultCurveId);
    }

    /// @inheritdoc IMultiVault
    function deposit(address receiver, bytes32 termId, uint256 curveId, uint256)
        external
        payable
        returns (uint256)
    {
        if (!_created[termId]) revert TermNotCreated(termId);
        _shares[receiver][termId][curveId] += msg.value;
        _totalShares[termId][curveId] += msg.value;
        return msg.value;
    }

    ////////////////////////////// Test helpers //////////////////////////////

    /// @notice Registers an atom from its data and returns its id.
    function createAtom(bytes memory data) external returns (bytes32 atomId) {
        atomId = calculateAtomId(data);
        _created[atomId] = true;
        _vaultType[atomId] = VAULT_TYPE_ATOM;
    }

    /// @notice Registers a positive triple and its counter-triple, returning the triple id.
    function createTriple(bytes32 subjectId, bytes32 predicateId, bytes32 objectId)
        external
        returns (bytes32 tripleId)
    {
        tripleId = calculateTripleId(subjectId, predicateId, objectId);
        _created[tripleId] = true;
        _vaultType[tripleId] = VAULT_TYPE_TRIPLE;
        _triples[tripleId] = [subjectId, predicateId, objectId];

        bytes32 counterId = getCounterIdFromTripleId(tripleId);
        _created[counterId] = true;
        _vaultType[counterId] = VAULT_TYPE_COUNTER_TRIPLE;
    }

    /// @notice Sets an account's share balance directly (attestation fixture).
    function setShares(address account, bytes32 termId, uint256 curveId, uint256 amount) external {
        _totalShares[termId][curveId] = _totalShares[termId][curveId] - _shares[account][termId][curveId] + amount;
        _shares[account][termId][curveId] = amount;
    }

    /// @notice Forces a term's vault type — used to simulate the counter-triple trap
    ///         (a term that `isTriple` accepts but is NOT a positive triple, ADR 0005).
    function forceSetType(bytes32 termId, uint8 vaultType_) external {
        _created[termId] = true;
        _vaultType[termId] = vaultType_;
    }

    /// @notice Overrides the bonding-curve config (governance-configurable on the live vault).
    function setBondingCurveConfig(address registry, uint256 curveId) external {
        _curveRegistry = registry;
        _defaultCurveId = curveId;
    }
}
