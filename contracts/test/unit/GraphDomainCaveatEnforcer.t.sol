// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";
import {
    ModeLib,
    ModeCode,
    ModePayload,
    CALLTYPE_SINGLE,
    EXECTYPE_TRY,
    MODE_DEFAULT
} from "@erc7579/lib/ModeLib.sol";

import { GraphDomainCaveatEnforcer } from "../../src/GraphDomainCaveatEnforcer.sol";
import { MockGovernor } from "../../src/MockGovernor.sol";
import { IMultiVault } from "../../src/interfaces/IMultiVault.sol";
import { MockMultiVault } from "../mocks/MockMultiVault.sol";

/// @notice Unit suite for GraphDomainCaveatEnforcer against MockMultiVault (no network).
/// Test numbering in comments follows §6 of the bounty bootstrap. Hooks are driven
/// directly (the DelegationManager's role); chain-level cases (revocation, narrowing
/// through redeemDelegations) live in the fork suite.
contract GraphDomainCaveatEnforcerTest is Test {
    MockMultiVault internal vault;
    MockGovernor internal governor;
    GraphDomainCaveatEnforcer internal enforcer;

    address internal delegator = makeAddr("delegator");
    address internal redeemer = makeAddr("redeemer");
    address internal org = makeAddr("orgAttestor");

    uint256 internal constant CURVE_ID = 1;
    uint256 internal constant STAKE = 1e15;

    bytes32 internal design;
    bytes32 internal branding;
    bytes32 internal ux;
    bytes32 internal legal;
    bytes32 internal logo;
    bytes32 internal predicate;

    bytes32 internal tBrandingDesign;
    bytes32 internal tUxDesign;
    bytes32 internal tLogoBranding;

    ModeCode internal singleMode;

    function setUp() public {
        vault = new MockMultiVault();

        design = vault.createAtom("design");
        branding = vault.createAtom("branding");
        ux = vault.createAtom("UX");
        legal = vault.createAtom("legal");
        logo = vault.createAtom("logo");
        predicate = vault.createAtom("is a sub-domain of");

        governor = new MockGovernor(IMultiVault(address(vault)), predicate);
        enforcer = new GraphDomainCaveatEnforcer(
            IMultiVault(address(vault)), address(governor), MockGovernor.castVoteFor.selector
        );

        tBrandingDesign = vault.createTriple(branding, predicate, design);
        tUxDesign = vault.createTriple(ux, predicate, design);
        tLogoBranding = vault.createTriple(logo, predicate, branding);
        // `legal` is deliberately left unlinked.

        // Default attestation regime (ADR 0004): the delegator staked on every edge.
        vault.setShares(delegator, tBrandingDesign, CURVE_ID, STAKE);
        vault.setShares(delegator, tUxDesign, CURVE_ID, STAKE);
        vault.setShares(delegator, tLogoBranding, CURVE_ID, STAKE);

        singleMode = ModeLib.encodeSimpleSingle();
    }

    ////////////////////////////// Helpers //////////////////////////////

    function _terms(bytes32 root, uint8 maxDepth, uint64 expiry, address attestor)
        internal
        view
        returns (bytes memory)
    {
        return abi.encode(
            GraphDomainCaveatEnforcer.Terms({
                rootDomainId: root,
                predicateId: predicate,
                maxDepth: maxDepth,
                expiry: expiry,
                attestor: attestor
            })
        );
    }

    function _defaultTerms(bytes32 root) internal view returns (bytes memory) {
        return _terms(root, 3, 0, address(0));
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

    /// @dev The execution under test: a delegated vote on a proposal scoped to `domainId`.
    ///      Voting is the only delegated action — proposing needs no delegation, so it is
    ///      outside the caveat. The proposal is recorded here so the enforcer can resolve
    ///      its domain from the governor.
    function _voteOn(bytes32 domainId) internal returns (bytes memory) {
        return _voteAs(_record(domainId), redeemer);
    }

    /// @dev A vote on an already-recorded proposal, cast by the redeemer.
    function _voteFor(uint256 proposalId) internal view returns (bytes memory) {
        return _voteAs(proposalId, redeemer);
    }

    /// @dev A vote with an explicit voter field, for the redeemer-binding tests. The
    ///      redeemer names itself as the voter and the delegator rides along as a
    ///      principal, which is the shape the enforcer binds to `_redeemer`.
    function _voteAs(uint256 proposalId, address voter) internal view returns (bytes memory) {
        address[] memory principals = new address[](1);
        principals[0] = delegator;
        bytes32[] memory noPath = new bytes32[](0);
        return abi.encodePacked(
            address(governor),
            uint256(0),
            abi.encodeCall(MockGovernor.castVoteFor, (proposalId, 1, voter, principals, noPath))
        );
    }

    /// @dev Records a proposal on the governor so its domain can be resolved.
    function _record(bytes32 domainId) internal returns (uint256 proposalId) {
        proposalId = governor.propose(domainId, "recorded for a vote");
    }

    function _hook(bytes memory terms, bytes32[] memory path, bytes memory execData) internal view {
        enforcer.beforeHook(terms, abi.encode(path), singleMode, execData, bytes32(0), delegator, redeemer);
    }

    ////////////////////////////// Happy paths //////////////////////////////

    /// §6 test 1 — exact match: zero hops, passes trivially.
    function test_ExactMatch_ZeroHops_Passes() public {
        _hook(_defaultTerms(design), _path(design), _voteOn(design));
    }

    /// §6 test 1 boundary — maxDepth 0 still allows the zero-hop exact match.
    function test_ExactMatch_WithMaxDepthZero_Passes() public {
        _hook(_terms(design, 0, 0, address(0)), _path(design), _voteOn(design));
    }

    /// §6 test 2 — 1-hop: branding → design.
    function test_OneHop_BrandingUnderDesign_Passes() public {
        _hook(_defaultTerms(design), _path(branding, design), _voteOn(branding));
    }

    /// §6 test 3 — 2-hop: logo → branding → design.
    function test_TwoHop_LogoUnderDesign_Passes() public {
        _hook(_defaultTerms(design), _path(logo, branding, design), _voteOn(logo));
    }

    /// §6 test 5 counterpart — expiry 0 means no expiry, far future included.
    function test_ZeroExpiry_NeverExpires() public {
        vm.warp(block.timestamp + 3650 days);
        _hook(_defaultTerms(design), _path(branding, design), _voteOn(branding));
    }

    ////////////////////////////// Revert paths //////////////////////////////

    /// §6 test 4 — a path longer than maxDepth reverts.
    function test_RevertWhen_PathExceedsMaxDepth() public {
        bytes memory exec_ = _voteOn(logo);

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathTooLong.selector, 2, 1));
        _hook(_terms(design, 1, 0, address(0)), _path(logo, branding, design), exec_);
    }

    /// §6 test 5 — past expiry reverts.
    function test_RevertWhen_Expired() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.DelegationExpired.selector, expiry, block.timestamp)
        );
        _hook(_terms(design, 3, expiry, address(0)), _path(branding, design), exec_);
    }

    /// §6 test 7 — `legal` has no sub-domain triple: the computed hop id was never created.
    function test_RevertWhen_UnlinkedDomain_Legal() public {
        bytes32 missing = vault.calculateTripleId(legal, predicate, design);
        bytes memory exec_ = _voteOn(legal);

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        _hook(_defaultTerms(design), _path(legal, design), exec_);
    }

    /// §6 test 8 — counter-triple attack (ADR 0005). The term at the hop id exists and
    /// `isTriple` accepts it (the live-vault trap, reproduced by the mock), but it is a
    /// COUNTER_TRIPLE: the enforcer must reject it. An enforcer built on `isTriple`
    /// would pass here — this test fails it for the right reason.
    function test_RevertWhen_HopIsCounterTriple_IsTripleTrap() public {
        vault.forceSetType(tBrandingDesign, 2);
        assertTrue(vault.isTriple(tBrandingDesign), "trap precondition: isTriple accepts the counter-triple");
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, tBrandingDesign));
        _hook(_defaultTerms(design), _path(branding, design), exec_);
    }

    /// §6 test 9 — triple exists but the attestor holds no shares (ADR 0004).
    function test_RevertWhen_HopUnattested() public {
        vault.setShares(delegator, tBrandingDesign, CURVE_ID, 0);
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, tBrandingDesign, delegator)
        );
        _hook(_defaultTerms(design), _path(branding, design), exec_);
    }

    /// §6 test 10 — attestor dial, institutional curation: the org staked, the
    /// delegator did not. Passes with `attestor = org`, fails with the default
    /// (`address(0)` → delegator).
    function test_AttestorDial_OrgCuration() public {
        vault.setShares(org, tBrandingDesign, CURVE_ID, STAKE);
        vault.setShares(delegator, tBrandingDesign, CURVE_ID, 0);

        _hook(_terms(design, 3, 0, org), _path(branding, design), _voteOn(branding));

        // Built before expectRevert: recording the proposal is a state write of its own.
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, tBrandingDesign, delegator)
        );
        _hook(_terms(design, 3, 0, address(0)), _path(branding, design), exec_);
    }

    /// §6 test 10 (vice versa) — self curation: the delegator staked (setUp default),
    /// the org did not. Passes with the default attestor, fails with `attestor = org`.
    function test_AttestorDial_DelegatorCuration() public {
        _hook(_terms(design, 3, 0, address(0)), _path(branding, design), _voteOn(branding));

        // Built before expectRevert: recording the proposal is a state write of its own.
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, tBrandingDesign, org));
        _hook(_terms(design, 3, 0, org), _path(branding, design), exec_);
    }

    /// §6 test 11 — broken path: consecutive entries not actually linked.
    function test_RevertWhen_BrokenPath() public {
        bytes32 missing = vault.calculateTripleId(logo, predicate, design);
        bytes memory exec_ = _voteOn(logo);

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        _hook(_defaultTerms(design), _path(logo, design), exec_);
    }

    /// §6 test 12a — path[0] must equal the proposal's domain.
    function test_RevertWhen_PathStartMismatch() public {
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathStartMismatch.selector, ux, branding)
        );
        _hook(_defaultTerms(design), _path(ux, design), exec_);
    }

    /// §6 test 12b — path[end] must equal the delegation's root domain.
    function test_RevertWhen_PathEndMismatch() public {
        bytes memory exec_ = _voteOn(branding);

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathEndMismatch.selector, ux, design));
        _hook(_defaultTerms(design), _path(branding, ux), exec_);
    }

    /// Path witness must be non-empty (step 4 of the §4.1 order of operations).
    function test_RevertWhen_EmptyPath() public {
        bytes memory exec_ = _voteOn(design);

        vm.expectRevert(GraphDomainCaveatEnforcer.EmptyPath.selector);
        _hook(_defaultTerms(design), new bytes32[](0), exec_);
    }

    /// §6 test 13a — an execution to any target other than the governor reverts.
    function test_RevertWhen_WrongTarget() public {
        address other = makeAddr("otherTarget");
        address[] memory principals = new address[](1);
        principals[0] = delegator;
        bytes memory exec =
            abi.encodePacked(other, uint256(0), abi.encodeCall(MockGovernor.castVoteFor, (0, 1, redeemer, principals, new bytes32[](0))));

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.InvalidTarget.selector, other, address(governor))
        );
        _hook(_defaultTerms(design), _path(design), exec);
    }

    /// §6 test 13b — the selector check is not optional: any other governor function reverts.
    function test_RevertWhen_WrongSelector() public {
        bytes memory exec =
            abi.encodePacked(address(governor), uint256(0), abi.encodeCall(MockGovernor.proposalCount, ()));
        vm.expectRevert(
            abi.encodeWithSelector(
                GraphDomainCaveatEnforcer.InvalidSelector.selector,
                MockGovernor.proposalCount.selector,
                MockGovernor.castVoteFor.selector
            )
        );
        _hook(_defaultTerms(design), _path(design), exec);
    }

    /// §6 test 13c — batch mode is an attack surface: reverts.
    function test_RevertWhen_BatchMode() public {
        ModeCode batchMode = ModeLib.encodeSimpleBatch();
        bytes memory exec_ = _voteOn(design);
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotSingleExecutionMode.selector, batchMode)
        );
        enforcer.beforeHook(
            _defaultTerms(design), abi.encode(_path(design)), batchMode, exec_, bytes32(0), delegator, redeemer
        );
    }

    /// §6 test 13d — try-execution mode is not a single default execution: reverts.
    function test_RevertWhen_TryExecutionMode() public {
        ModeCode tryMode = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, MODE_DEFAULT, ModePayload.wrap(bytes22(0)));
        bytes memory exec_ = _voteOn(design);
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotSingleExecutionMode.selector, tryMode));
        enforcer.beforeHook(
            _defaultTerms(design), abi.encode(_path(design)), tryMode, exec_, bytes32(0), delegator, redeemer
        );
    }

    /// §6 test 14 (unit half, ADR 0007) — narrowing is emergent: the same branding
    /// proposal passes the level-1 check (root `design`) and has no witness that can
    /// satisfy the level-2 check (root `UX`). The DelegationManager runs both; the fork
    /// suite proves the composed behavior end-to-end.
    function test_Narrowing_UXLevel_BlocksBranding() public {
        bytes memory exec = _voteOn(branding);

        _hook(_defaultTerms(design), _path(branding, design), exec);

        bytes32 missing = vault.calculateTripleId(branding, predicate, ux);
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        _hook(_defaultTerms(ux), _path(branding, ux), exec);
    }

    /// Constructor input validation.
    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(GraphDomainCaveatEnforcer.ZeroAddress.selector);
        new GraphDomainCaveatEnforcer(IMultiVault(address(0)), address(governor), MockGovernor.castVoteFor.selector);

        vm.expectRevert(GraphDomainCaveatEnforcer.ZeroAddress.selector);
        new GraphDomainCaveatEnforcer(IMultiVault(address(vault)), address(0), MockGovernor.castVoteFor.selector);
    }

    ////////////////////////////// Delegated votes //////////////////////////////

    /// A vote on a domain one attested hop under the delegation's root passes. The domain
    /// never appears in the calldata — it is resolved from the governor.
    function test_Vote_BrandingUnderDesign_Passes() public {
        uint256 proposalId = _record(branding);
        _hook(_defaultTerms(design), _path(branding, design), _voteFor(proposalId));
    }

    /// The headline rejection: the delegation is scoped to `design`, the proposal is
    /// `legal`, and no attested path connects them — so the represented weight cannot be
    /// exercised even though the voter could vote for itself.
    function test_RevertWhen_VotingOnUnreachableDomain() public {
        uint256 proposalId = _record(legal);
        vm.expectRevert(
            abi.encodeWithSelector(
                GraphDomainCaveatEnforcer.NotATriple.selector, vault.calculateTripleId(legal, predicate, design)
            )
        );
        _hook(_defaultTerms(design), _path(legal, design), _voteFor(proposalId));
    }

    /// Narrowing applies to votes exactly as it does to proposals: the UX-scoped level
    /// rejects a `branding` vote the design-scoped level would accept.
    function test_Vote_Narrowing_UXLevelBlocksBranding() public {
        uint256 proposalId = _record(branding);
        vm.expectRevert(
            abi.encodeWithSelector(
                GraphDomainCaveatEnforcer.NotATriple.selector, vault.calculateTripleId(branding, predicate, ux)
            )
        );
        _hook(_defaultTerms(ux), _path(branding, ux), _voteFor(proposalId));
    }

    function test_Vote_ExactMatch_ZeroHops_Passes() public {
        uint256 proposalId = _record(design);
        _hook(_defaultTerms(design), _path(design), _voteFor(proposalId));
    }

    function test_RevertWhen_VoteWitnessDoesNotMatchResolvedDomain() public {
        uint256 proposalId = _record(branding);
        // The witness claims `ux`, but the governor resolves the proposal to `branding`.
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathStartMismatch.selector, ux, branding)
        );
        _hook(_defaultTerms(design), _path(ux, design), _voteFor(proposalId));
    }

    /// The voter field is bound to the redeemer: a vote cannot be recorded in anyone
    /// else's name, so a vote standing for B is proof that B redeemed.
    function test_RevertWhen_VoteNamesSomeoneOtherThanTheRedeemer() public {
        uint256 proposalId = _record(branding);
        address impostor = address(0xBAD);
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.VoterIsNotRedeemer.selector, impostor, redeemer)
        );
        _hook(_defaultTerms(design), _path(branding, design), _voteAs(proposalId, impostor));
    }

    function test_RevertWhen_VoteCalldataTooShort() public {
        bytes memory execData = abi.encodePacked(
            address(governor), uint256(0), abi.encodePacked(MockGovernor.castVoteFor.selector, hex"1234")
        );
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.MalformedVoteCalldata.selector, uint256(6)));
        _hook(_defaultTerms(design), _path(design), execData);
    }

    ////////////////////////////// Fuzz //////////////////////////////

    /// Terms encoding roundtrips through getTermsInfo.
    function testFuzz_TermsRoundtrip(bytes32 root, bytes32 pred, uint8 maxDepth, uint64 expiry, address attestor)
        public
        view
    {
        GraphDomainCaveatEnforcer.Terms memory decoded = enforcer.getTermsInfo(
            abi.encode(
                GraphDomainCaveatEnforcer.Terms({
                    rootDomainId: root,
                    predicateId: pred,
                    maxDepth: maxDepth,
                    expiry: expiry,
                    attestor: attestor
                })
            )
        );
        assertEq(decoded.rootDomainId, root);
        assertEq(decoded.predicateId, pred);
        assertEq(decoded.maxDepth, maxDepth);
        assertEq(decoded.expiry, expiry);
        assertEq(decoded.attestor, attestor);
    }

    /// Every suffix of the seeded chain logo → branding → design is a valid witness
    /// for its own head domain.
    function testFuzz_ValidSuffixPathsPass(uint8 startSeed) public {
        bytes32[3] memory chain = [logo, branding, design];
        uint256 start = bound(startSeed, 0, 2);

        bytes32[] memory path = new bytes32[](3 - start);
        for (uint256 i = start; i < 3; i++) {
            path[i - start] = chain[i];
        }
        _hook(_defaultTerms(design), path, _voteOn(chain[start]));
    }

    /// A witness for any domain outside the seeded vocabulary must never verify,
    /// whatever the path contents. (Asserted as "the hook reverts", error-agnostic —
    /// the specific error depends on where the forgery is caught.)
    function testFuzz_ForgedWitnessAlwaysReverts(bytes32[] memory path, bytes32 domain) public {
        vm.assume(domain != design && domain != branding && domain != ux && domain != logo && domain != legal);

        (bool ok,) = address(enforcer).call(
            abi.encodeWithSelector(
                enforcer.beforeHook.selector,
                _defaultTerms(design),
                abi.encode(path),
                singleMode,
                _voteOn(domain),
                bytes32(0),
                delegator,
                redeemer
            )
        );
        assertFalse(ok, "forged witness must revert");
    }
}
