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
        governor = new MockGovernor();
        enforcer = new GraphDomainCaveatEnforcer(
            IMultiVault(address(vault)), address(governor), MockGovernor.propose.selector
        );

        design = vault.createAtom("design");
        branding = vault.createAtom("branding");
        ux = vault.createAtom("UX");
        legal = vault.createAtom("legal");
        logo = vault.createAtom("logo");
        predicate = vault.createAtom("is a sub-domain of");

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

    function _propose(bytes32 domainId) internal view returns (bytes memory) {
        return abi.encodePacked(
            address(governor), uint256(0), abi.encodeCall(MockGovernor.propose, (domainId, "test proposal"))
        );
    }

    function _hook(bytes memory terms, bytes32[] memory path, bytes memory execData) internal view {
        enforcer.beforeHook(terms, abi.encode(path), singleMode, execData, bytes32(0), delegator, redeemer);
    }

    ////////////////////////////// Happy paths //////////////////////////////

    /// §6 test 1 — exact match: zero hops, passes trivially.
    function test_ExactMatch_ZeroHops_Passes() public view {
        _hook(_defaultTerms(design), _path(design), _propose(design));
    }

    /// §6 test 1 boundary — maxDepth 0 still allows the zero-hop exact match.
    function test_ExactMatch_WithMaxDepthZero_Passes() public view {
        _hook(_terms(design, 0, 0, address(0)), _path(design), _propose(design));
    }

    /// §6 test 2 — 1-hop: branding → design.
    function test_OneHop_BrandingUnderDesign_Passes() public view {
        _hook(_defaultTerms(design), _path(branding, design), _propose(branding));
    }

    /// §6 test 3 — 2-hop: logo → branding → design.
    function test_TwoHop_LogoUnderDesign_Passes() public view {
        _hook(_defaultTerms(design), _path(logo, branding, design), _propose(logo));
    }

    /// §6 test 5 counterpart — expiry 0 means no expiry, far future included.
    function test_ZeroExpiry_NeverExpires() public {
        vm.warp(block.timestamp + 3650 days);
        _hook(_defaultTerms(design), _path(branding, design), _propose(branding));
    }

    ////////////////////////////// Revert paths //////////////////////////////

    /// §6 test 4 — a path longer than maxDepth reverts.
    function test_RevertWhen_PathExceedsMaxDepth() public {
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathTooLong.selector, 2, 1));
        _hook(_terms(design, 1, 0, address(0)), _path(logo, branding, design), _propose(logo));
    }

    /// §6 test 5 — past expiry reverts.
    function test_RevertWhen_Expired() public {
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.DelegationExpired.selector, expiry, block.timestamp)
        );
        _hook(_terms(design, 3, expiry, address(0)), _path(branding, design), _propose(branding));
    }

    /// §6 test 7 — `legal` has no sub-domain triple: the computed hop id was never created.
    function test_RevertWhen_UnlinkedDomain_Legal() public {
        bytes32 missing = vault.calculateTripleId(legal, predicate, design);
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        _hook(_defaultTerms(design), _path(legal, design), _propose(legal));
    }

    /// §6 test 8 — counter-triple attack (ADR 0005). The term at the hop id exists and
    /// `isTriple` accepts it (the live-vault trap, reproduced by the mock), but it is a
    /// COUNTER_TRIPLE: the enforcer must reject it. An enforcer built on `isTriple`
    /// would pass here — this test fails it for the right reason.
    function test_RevertWhen_HopIsCounterTriple_IsTripleTrap() public {
        vault.forceSetType(tBrandingDesign, 2);
        assertTrue(vault.isTriple(tBrandingDesign), "trap precondition: isTriple accepts the counter-triple");
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, tBrandingDesign));
        _hook(_defaultTerms(design), _path(branding, design), _propose(branding));
    }

    /// §6 test 9 — triple exists but the attestor holds no shares (ADR 0004).
    function test_RevertWhen_HopUnattested() public {
        vault.setShares(delegator, tBrandingDesign, CURVE_ID, 0);
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, tBrandingDesign, delegator)
        );
        _hook(_defaultTerms(design), _path(branding, design), _propose(branding));
    }

    /// §6 test 10 — attestor dial, institutional curation: the org staked, the
    /// delegator did not. Passes with `attestor = org`, fails with the default
    /// (`address(0)` → delegator).
    function test_AttestorDial_OrgCuration() public {
        vault.setShares(org, tBrandingDesign, CURVE_ID, STAKE);
        vault.setShares(delegator, tBrandingDesign, CURVE_ID, 0);

        _hook(_terms(design, 3, 0, org), _path(branding, design), _propose(branding));

        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, tBrandingDesign, delegator)
        );
        _hook(_terms(design, 3, 0, address(0)), _path(branding, design), _propose(branding));
    }

    /// §6 test 10 (vice versa) — self curation: the delegator staked (setUp default),
    /// the org did not. Passes with the default attestor, fails with `attestor = org`.
    function test_AttestorDial_DelegatorCuration() public {
        _hook(_terms(design, 3, 0, address(0)), _path(branding, design), _propose(branding));

        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotAttested.selector, tBrandingDesign, org));
        _hook(_terms(design, 3, 0, org), _path(branding, design), _propose(branding));
    }

    /// §6 test 11 — broken path: consecutive entries not actually linked.
    function test_RevertWhen_BrokenPath() public {
        bytes32 missing = vault.calculateTripleId(logo, predicate, design);
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        _hook(_defaultTerms(design), _path(logo, design), _propose(logo));
    }

    /// §6 test 12a — path[0] must equal the proposal's domain.
    function test_RevertWhen_PathStartMismatch() public {
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathStartMismatch.selector, ux, branding)
        );
        _hook(_defaultTerms(design), _path(ux, design), _propose(branding));
    }

    /// §6 test 12b — path[end] must equal the delegation's root domain.
    function test_RevertWhen_PathEndMismatch() public {
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.PathEndMismatch.selector, ux, design));
        _hook(_defaultTerms(design), _path(branding, ux), _propose(branding));
    }

    /// Path witness must be non-empty (step 4 of the §4.1 order of operations).
    function test_RevertWhen_EmptyPath() public {
        vm.expectRevert(GraphDomainCaveatEnforcer.EmptyPath.selector);
        _hook(_defaultTerms(design), new bytes32[](0), _propose(design));
    }

    /// §6 test 13a — an execution to any target other than the governor reverts.
    function test_RevertWhen_WrongTarget() public {
        address other = makeAddr("otherTarget");
        bytes memory exec = abi.encodePacked(
            other, uint256(0), abi.encodeCall(MockGovernor.propose, (design, "test proposal"))
        );
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
                MockGovernor.propose.selector
            )
        );
        _hook(_defaultTerms(design), _path(design), exec);
    }

    /// §6 test 13c — batch mode is an attack surface: reverts.
    function test_RevertWhen_BatchMode() public {
        ModeCode batchMode = ModeLib.encodeSimpleBatch();
        vm.expectRevert(
            abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotSingleExecutionMode.selector, batchMode)
        );
        enforcer.beforeHook(
            _defaultTerms(design), abi.encode(_path(design)), batchMode, _propose(design), bytes32(0), delegator, redeemer
        );
    }

    /// §6 test 13d — try-execution mode is not a single default execution: reverts.
    function test_RevertWhen_TryExecutionMode() public {
        ModeCode tryMode = ModeLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, MODE_DEFAULT, ModePayload.wrap(bytes22(0)));
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotSingleExecutionMode.selector, tryMode));
        enforcer.beforeHook(
            _defaultTerms(design), abi.encode(_path(design)), tryMode, _propose(design), bytes32(0), delegator, redeemer
        );
    }

    /// §6 test 14 (unit half, ADR 0007) — narrowing is emergent: the same branding
    /// proposal passes the level-1 check (root `design`) and has no witness that can
    /// satisfy the level-2 check (root `UX`). The DelegationManager runs both; the fork
    /// suite proves the composed behavior end-to-end.
    function test_Narrowing_UXLevel_BlocksBranding() public {
        bytes memory exec = _propose(branding);

        _hook(_defaultTerms(design), _path(branding, design), exec);

        bytes32 missing = vault.calculateTripleId(branding, predicate, ux);
        vm.expectRevert(abi.encodeWithSelector(GraphDomainCaveatEnforcer.NotATriple.selector, missing));
        _hook(_defaultTerms(ux), _path(branding, ux), exec);
    }

    /// Constructor input validation.
    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(GraphDomainCaveatEnforcer.ZeroAddress.selector);
        new GraphDomainCaveatEnforcer(IMultiVault(address(0)), address(governor), MockGovernor.propose.selector);

        vm.expectRevert(GraphDomainCaveatEnforcer.ZeroAddress.selector);
        new GraphDomainCaveatEnforcer(IMultiVault(address(vault)), address(0), MockGovernor.propose.selector);
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
    function testFuzz_ValidSuffixPathsPass(uint8 startSeed) public view {
        bytes32[3] memory chain = [logo, branding, design];
        uint256 start = bound(startSeed, 0, 2);

        bytes32[] memory path = new bytes32[](3 - start);
        for (uint256 i = start; i < 3; i++) {
            path[i - start] = chain[i];
        }
        _hook(_defaultTerms(design), path, _propose(chain[start]));
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
                _propose(domain),
                bytes32(0),
                delegator,
                redeemer
            )
        );
        assertFalse(ok, "forged witness must revert");
    }
}
