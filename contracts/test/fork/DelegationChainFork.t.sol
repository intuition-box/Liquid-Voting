// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";
import { ModeLib, ModeCode } from "@erc7579/lib/ModeLib.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { IDelegationManager } from "@delegation-framework/interfaces/IDelegationManager.sol";
import { Delegation, Caveat } from "@delegation-framework/utils/Types.sol";
import { HybridDeleGator } from "@delegation-framework/HybridDeleGator.sol";

import { GraphDomainCaveatEnforcer } from "../../src/GraphDomainCaveatEnforcer.sol";
import { MockGovernor } from "../../src/MockGovernor.sol";
import { IMultiVault } from "../../src/interfaces/IMultiVault.sol";

/// @notice Fork suite against Intuition testnet (13579): the real MultiVault (real id
/// math, real counter-triples, real share accounting) and the real deployed
/// DelegationManager v1.3.0 with a signed two-level HybridDeleGator chain.
/// Covers §6 tests 6 (revocation) and 14 (narrowing) end-to-end, plus real-vault
/// variants of 7/8/9. Vocabulary term_ids come from the Phase 0.b audit (ADR 0008)
/// and are revalidated against the vault in setUp.
contract DelegationChainForkTest is Test {
    string internal constant DEFAULT_RPC = "https://testnet.rpc.intuition.systems/http";

    // Delegation Framework v1.3.0 on 13579 — verified via eth_getCode + explorer (ADR 0002).
    address internal constant DELEGATION_MANAGER = 0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3;
    address internal constant HYBRID_IMPL = 0x48dBe696A4D990079e039489bA2053B36E8FFEC4;
    address internal constant MULTIVAULT = 0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91;

    bytes32 internal constant ROOT_AUTHORITY = bytes32(type(uint256).max);

    // Vocabulary term_ids from the Phase 0.b audit (ADR 0008), revalidated in setUp.
    bytes32 internal constant DESIGN = 0x1392c1e72e3408bd41c4d2b670e4ac4371ca30c1b92b43b15d8b25a6954cb066;
    bytes32 internal constant BRANDING = 0x8017cd335e3f8c0ab844d752a8212952e78b772257c59d65142a6be8ebbeee7f;
    bytes32 internal constant UX = 0xafd298baa9c88ca6dd45aee1e061b48f2e5d914fc0a6c02b0a73aa2b83859420;
    bytes32 internal constant LEGAL = 0xc9bbf040865761d20ca7e63e5b00c61db924521e0e0c306a0c4f0e9cf52b2325;
    bytes32 internal constant LOGO = 0x1d3f36760a218532b7ceca6364a490f1d2674ec3f3eb29739b9da7e1edaddf7a;
    bytes32 internal constant PREDICATE = 0x9c2e2f2018dbfaa74fd3fd86cd54a62b16e771936f5d342e3751db8d0c046f80;
    bytes32 internal constant T_BRANDING_DESIGN = 0x176419b5177cfa99cba68cb6b0b884ea7bb593a84f0053ef6baf1e082f373784;
    bytes32 internal constant T_UX_DESIGN = 0xae3359f86f0ea89d3ff29f4d6e36d8d35d1610343da9442e9ca89f4a661ab7de;
    bytes32 internal constant T_LOGO_BRANDING = 0xdcec7ce37346e051b98f1e19bc7d088a4844cdbe55d2b3ce9a3e5a320d70e865;

    IDelegationManager internal manager;
    IMultiVault internal vault;
    MockGovernor internal governor;
    GraphDomainCaveatEnforcer internal enforcer;
    uint256 internal curveId;

    // voter = HybridDeleGator smart account (root delegator — must execute); the
    // downstream accounts can be EOAs for signature purposes.
    address internal voter;
    address internal voterOwner;
    uint256 internal voterOwnerPk;
    address internal delegateEoa;
    uint256 internal delegatePk;
    address internal executorEoa;

    function setUp() public {
        vm.createSelectFork(vm.envOr("INTUITION_TESTNET_RPC", DEFAULT_RPC));

        manager = IDelegationManager(DELEGATION_MANAGER);
        vault = IMultiVault(MULTIVAULT);
        (, curveId) = vault.getBondingCurveConfig();

        (voterOwner, voterOwnerPk) = makeAddrAndKey("voterOwner");
        (delegateEoa, delegatePk) = makeAddrAndKey("delegate");
        executorEoa = makeAddr("executor");

        voter = address(
            new ERC1967Proxy(
                HYBRID_IMPL,
                abi.encodeWithSelector(
                    HybridDeleGator.initialize.selector, voterOwner, new string[](0), new uint256[](0), new uint256[](0)
                )
            )
        );

        governor = new MockGovernor();
        enforcer = new GraphDomainCaveatEnforcer(vault, address(governor), MockGovernor.castVoteFor.selector);

        // ADR 0004: the existing triples carry no real positions — the delegator-as-
        // attestor (voter) deposits on the two edges its `design` delegation relies on.
        // logo → branding is deliberately left unattested for the ADR-B test.
        vm.deal(voter, 1 ether);
        vm.prank(voter);
        vault.deposit{ value: 0.01 ether }(voter, T_BRANDING_DESIGN, curveId, 0);
        vm.prank(voter);
        vault.deposit{ value: 0.01 ether }(voter, T_UX_DESIGN, curveId, 0);
    }

    /// voter → delegate, rooted at `design`. Deterministic build + sign (0.8.23 cannot
    /// copy Caveat[] into storage, so delegations are rebuilt per use, byte-identical).
    function _rootDel() internal view returns (Delegation memory) {
        return _signedDelegation(voterOwnerPk, voter, delegateEoa, ROOT_AUTHORITY, _terms(DESIGN, 3, 0, address(0)));
    }

    /// delegate → executor, narrowed to `UX`, authority-bound to the root delegation.
    function _leafDel() internal view returns (Delegation memory) {
        return _signedDelegation(
            delegatePk, delegateEoa, executorEoa, manager.getDelegationHash(_rootDel()), _terms(UX, 3, 0, address(0))
        );
    }

    ////////////////////////////// Helpers //////////////////////////////

    function _terms(bytes32 root, uint8 maxDepth, uint64 expiry, address attestor)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            GraphDomainCaveatEnforcer.Terms({
                rootDomainId: root,
                predicateId: PREDICATE,
                maxDepth: maxDepth,
                expiry: expiry,
                attestor: attestor
            })
        );
    }

    function _signedDelegation(
        uint256 signerPk,
        address delegator,
        address delegate,
        bytes32 authority,
        bytes memory terms
    ) internal view returns (Delegation memory delegation_) {
        Caveat[] memory caveats = new Caveat[](1);
        caveats[0] = Caveat({ enforcer: address(enforcer), terms: terms, args: "" });
        delegation_ = Delegation({
            delegate: delegate,
            delegator: delegator,
            authority: authority,
            caveats: caveats,
            salt: 0,
            signature: ""
        });
        bytes32 digest =
            MessageHashUtils.toTypedDataHash(manager.getDomainHash(), manager.getDelegationHash(delegation_));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        delegation_.signature = abi.encodePacked(r, s, v);
    }

    /// @dev The delegated execution under test: a vote on a proposal scoped to `domainId`.
    ///      Proposing is outside the caveat (anyone may propose in their own name), so the
    ///      proposal is recorded here and the vote is what the delegation authorizes.
    ///      `voter` must be the redeeming account — the enforcer binds the field.
    function _voteCalldata(bytes32 domainId, address voter_) internal returns (bytes memory) {
        // The ERC-7710 delegation says the delegate MAY vote here; the governor's own
        // register says whose weight it carries. Both are needed for a delegated vote.
        vm.prank(voter);
        governor.delegateWeight(voter_, domainId);

        uint256 proposalId = governor.propose(domainId, "fork proposal");
        // Voting opens VOTING_DELAY blocks later; the positive cases execute for real.
        vm.roll(block.number + governor.VOTING_DELAY());
        address[] memory principals = new address[](1);
        principals[0] = voter;   // the root delegator's weight rides along
        return abi.encodePacked(
            address(governor),
            uint256(0),
            abi.encodeCall(MockGovernor.castVoteFor, (proposalId, 1, voter_, principals))
        );
    }

    /// Builds the redeemDelegations arguments for the full 2-level chain. Args (the
    /// path witnesses) are attached post-signing: `args` is excluded from the caveat
    /// hash by design. All external calls happen HERE, so tests can place
    /// vm.expectRevert / vm.prank directly before manager.redeemDelegations.
    function _chainCall(bytes32 domainId, bytes32[] memory leafPath, bytes32[] memory rootPath)
        internal
        returns (bytes[] memory contexts, ModeCode[] memory modes, bytes[] memory execs)
    {
        Delegation[] memory chain = new Delegation[](2);
        chain[0] = _leafDel();
        chain[1] = _rootDel();
        chain[0].caveats[0].args = abi.encode(leafPath);
        chain[1].caveats[0].args = abi.encode(rootPath);

        contexts = new bytes[](1);
        contexts[0] = abi.encode(chain);
        modes = new ModeCode[](1);
        modes[0] = ModeLib.encodeSimpleSingle();
        execs = new bytes[](1);
        execs[0] = _voteCalldata(domainId, executorEoa);
    }

    /// Builds the redeemDelegations arguments for the root delegation alone
    /// (level-1 authority, redeemed by the delegate).
    function _rootOnlyCall(bytes32 domainId, bytes32[] memory rootPath)
        internal
        returns (bytes[] memory contexts, ModeCode[] memory modes, bytes[] memory execs)
    {
        Delegation[] memory chain = new Delegation[](1);
        chain[0] = _rootDel();
        chain[0].caveats[0].args = abi.encode(rootPath);

        contexts = new bytes[](1);
        contexts[0] = abi.encode(chain);
        modes = new ModeCode[](1);
        modes[0] = ModeLib.encodeSimpleSingle();
        execs = new bytes[](1);
        execs[0] = _voteCalldata(domainId, delegateEoa);
    }

    function _path(bytes32 a) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = a;
    }

    function _path(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](2);
        p[0] = a;
        p[1] = b;
    }

    function _path(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](3);
        p[0] = a;
        p[1] = b;
        p[2] = c;
    }

    ////////////////////////////// Sanity //////////////////////////////

    /// The audit's term_ids match live vault state: id math, positive-triple types,
    /// and the attestor stake laid down in setUp.
    function test_Fork_SetupSanity() public view {
        assertEq(vault.calculateTripleId(BRANDING, PREDICATE, DESIGN), T_BRANDING_DESIGN, "triple id drift");
        assertEq(vault.calculateTripleId(UX, PREDICATE, DESIGN), T_UX_DESIGN, "triple id drift");
        assertEq(vault.calculateTripleId(LOGO, PREDICATE, BRANDING), T_LOGO_BRANDING, "triple id drift");
        assertEq(vault.getVaultType(T_BRANDING_DESIGN), 1);
        assertEq(vault.getVaultType(T_UX_DESIGN), 1);
        assertEq(vault.getVaultType(T_LOGO_BRANDING), 1);
        assertGt(vault.getShares(voter, T_BRANDING_DESIGN, curveId), 0, "attestor stake missing");
        assertGt(vault.getShares(voter, T_UX_DESIGN, curveId), 0, "attestor stake missing");
    }

    /// §6 test 8 premise, on the real vault (ADR 0005): the counter-triple of a valid
    /// relation is accepted by `isTriple` but classified 2 by `getVaultType` — the
    /// coarse check is a real trap on the live deployment, not a hypothetical.
    function test_Fork_CounterTripleTrapIsReal() public view {
        bytes32 counterId = vault.getCounterIdFromTripleId(T_BRANDING_DESIGN);
        assertTrue(vault.isTriple(counterId), "isTriple must accept the counter-triple (the trap)");
        assertEq(vault.getVaultType(counterId), 2, "getVaultType must classify it COUNTER_TRIPLE");
    }

    ////////////////////////////// End-to-end //////////////////////////////

    /// Happy path through the full chain: a vote on a `UX` proposal satisfies the leaf's
    /// `UX` scope (exact match) and the root's `design` scope (1 hop). The vote is
    /// recorded for the executor — the account that redeemed — and carries the root
    /// delegator's weight with it.
    function test_Fork_ChainRedeem_UXProposal_Passes() public {
        (bytes[] memory c, ModeCode[] memory m, bytes[] memory e) = _chainCall(UX, _path(UX), _path(UX, DESIGN));
        vm.prank(executorEoa);
        manager.redeemDelegations(c, m, e);

        assertEq(governor.proposalCount(), 1);
        assertEq(governor.getProposal(0).domainId, UX);
        (, uint256 forVotes,) = governor.proposalVotes(0);
        assertEq(forVotes, 2, "the executor's own weight plus the root delegator's");
        assertTrue(governor.hasVoted(0, executorEoa), "the vote is recorded for the redeemer");
        assertTrue(governor.hasVoted(0, voter), "the delegator's weight was exercised");
    }

    /// §6 test 14 — narrowing is emergent (ADR 0007): `branding` is valid under the
    /// root's `design` scope but has no witness to the leaf's `UX` scope. The leaf
    /// hook runs first (manager iterates leaf → root) and rejects the hop.
    function test_Fork_Narrowing_BrandingBlocked() public {
        bytes32 missing = vault.calculateTripleId(BRANDING, PREDICATE, UX);
        (bytes[] memory c, ModeCode[] memory m, bytes[] memory e) =
            _chainCall(BRANDING, _path(BRANDING, UX), _path(BRANDING, DESIGN));
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        vm.prank(executorEoa);
        manager.redeemDelegations(c, m, e);
    }

    /// §6 test 2 e2e — under the root delegation alone (scope `design`), a `branding`
    /// proposal passes with the 1-hop witness.
    function test_Fork_RootOnly_BrandingPasses() public {
        (bytes[] memory c, ModeCode[] memory m, bytes[] memory e) = _rootOnlyCall(BRANDING, _path(BRANDING, DESIGN));
        vm.prank(delegateEoa);
        manager.redeemDelegations(c, m, e);
        assertEq(governor.proposalCount(), 1);
        assertEq(governor.getProposal(0).domainId, BRANDING);
    }

    /// §6 test 7 e2e — `legal` was deliberately never linked: no witness exists.
    function test_Fork_Legal_Fails() public {
        bytes32 missing = vault.calculateTripleId(LEGAL, PREDICATE, DESIGN);
        (bytes[] memory c, ModeCode[] memory m, bytes[] memory e) = _rootOnlyCall(LEGAL, _path(LEGAL, DESIGN));
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        vm.prank(delegateEoa);
        manager.redeemDelegations(c, m, e);
    }

    /// §6 test 9 e2e (ADR 0004) — `logo → branding` exists on the live graph but
    /// carries no attestor stake (setUp deposits only on the two design edges): the
    /// witness verifies structurally and still fails attestation.
    function test_Fork_UnattestedEdge_LogoFails() public {
        (bytes[] memory c, ModeCode[] memory m, bytes[] memory e) =
            _rootOnlyCall(LOGO, _path(LOGO, BRANDING, DESIGN));
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, T_LOGO_BRANDING, voter)
        );
        vm.prank(delegateEoa);
        manager.redeemDelegations(c, m, e);
    }

    /// §6 test 6 — revocation is native: the voter disables the root delegation and
    /// the whole downstream chain dies, executor and delegate alike. No enforcer code
    /// involved (the manager checks disabled state before any hook).
    function test_Fork_Revocation_KillsChain() public {
        Delegation memory root = _rootDel();
        vm.prank(voter);
        manager.disableDelegation(root);

        (bytes[] memory c1, ModeCode[] memory m1, bytes[] memory e1) = _chainCall(UX, _path(UX), _path(UX, DESIGN));
        vm.expectRevert(IDelegationManager.CannotUseADisabledDelegation.selector);
        vm.prank(executorEoa);
        manager.redeemDelegations(c1, m1, e1);

        (bytes[] memory c2, ModeCode[] memory m2, bytes[] memory e2) = _rootOnlyCall(BRANDING, _path(BRANDING, DESIGN));
        vm.expectRevert(IDelegationManager.CannotUseADisabledDelegation.selector);
        vm.prank(delegateEoa);
        manager.redeemDelegations(c2, m2, e2);
    }

    /// §6 test 5 e2e — a delegation signed with a past-due expiry dies inside our
    /// enforcer with the parameterized error the frontend will surface.
    function test_Fork_ExpiredDelegation_Fails() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        Delegation memory expiring = _signedDelegation(
            voterOwnerPk, voter, delegateEoa, ROOT_AUTHORITY, _terms(DESIGN, 3, expiry, address(0))
        );

        vm.warp(block.timestamp + 2 hours);

        Delegation[] memory chain = new Delegation[](1);
        chain[0] = expiring;
        chain[0].caveats[0].args = abi.encode(_path(BRANDING, DESIGN));

        bytes[] memory contexts = new bytes[](1);
        contexts[0] = abi.encode(chain);
        ModeCode[] memory modes = new ModeCode[](1);
        modes[0] = ModeLib.encodeSimpleSingle();
        bytes[] memory execs = new bytes[](1);
        execs[0] = _voteCalldata(BRANDING, delegateEoa);

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.DelegationExpired.selector, expiry, block.timestamp)
        );
        vm.prank(delegateEoa);
        manager.redeemDelegations(contexts, modes, execs);
    }
}
