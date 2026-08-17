// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

/// @title IMultiVault
/// @notice Read surface of the Intuition MultiVault used by this POC, plus `deposit`
///         (needed by the seeding flow and the fork tests to give the attestor a position).
/// @dev Signatures verified against `0xIntuition/intuition-contracts-v2` and probed against
///      the live testnet deployment at 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91 (chain 13579).
///      Behavioral notes that shape the enforcer (verified onchain 2026-08-17):
///      - `getVaultType` REVERTS for a term that was never created (it does not return a
///        sentinel), so callers that need a clean failure must try/catch the staticcall.
///      - `isTriple` returns true for counter-triples as well — it is a coarse family check
///        and MUST NOT be used as a positive-triple existence check (ADR 0005).
interface IMultiVault {
    /// @notice Deterministic atom id from its data bytes. Pure: identical across chains.
    function calculateAtomId(bytes memory data) external pure returns (bytes32);

    /// @notice Deterministic triple id from its component term ids. Pure: identical across chains.
    function calculateTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId)
        external
        pure
        returns (bytes32);

    /// @notice Components (subject, predicate, object) of a triple.
    function getTriple(bytes32 tripleId) external view returns (bytes32, bytes32, bytes32);

    /// @notice Id of the counter-triple (the "against" vault) for a triple id.
    function getCounterIdFromTripleId(bytes32 tripleId) external pure returns (bytes32);

    /// @notice True if the term (atom, triple, or counter-triple) has been created.
    function isTermCreated(bytes32 termId) external view returns (bool);

    /// @notice COARSE family check — true for positive triples AND counter-triples.
    function isTriple(bytes32 termId) external view returns (bool);

    /// @notice Precise term classifier: 0 = ATOM, 1 = TRIPLE, 2 = COUNTER_TRIPLE.
    /// @dev Reverts if the term was never created.
    function getVaultType(bytes32 termId) external view returns (uint8);

    /// @notice Shares held by `account` in the vault of `termId` on curve `curveId`.
    function getShares(address account, bytes32 termId, uint256 curveId) external view returns (uint256);

    /// @notice Vault state (totalAssets, totalShares) for a term on a curve.
    function getVault(bytes32 termId, uint256 curveId) external view returns (uint256, uint256);

    /// @notice Bonding-curve config: (curve registry, default curve id). Governance-configurable — query, never hardcode.
    function getBondingCurveConfig() external view returns (address, uint256);

    /// @notice Deposit native TRUST into a term's vault, minting shares to `receiver`.
    function deposit(address receiver, bytes32 termId, uint256 curveId, uint256 minShares)
        external
        payable
        returns (uint256);
}
