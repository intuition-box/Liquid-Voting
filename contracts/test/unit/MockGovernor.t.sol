// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { Test } from "forge-std/Test.sol";

import { MockGovernor } from "../../src/MockGovernor.sol";

/// @notice Unit suite for the MockGovernor proposal recorder.
contract MockGovernorTest is Test {
    MockGovernor internal governor;

    bytes32 internal constant DOMAIN = keccak256("domain");

    event ProposalCreated(uint256 indexed proposalId, bytes32 indexed domainId, address indexed proposer, string description);

    function setUp() public {
        governor = new MockGovernor();
    }

    function test_Propose_RecordsAndEmits() public {
        vm.expectEmit(true, true, true, true);
        emit ProposalCreated(0, DOMAIN, address(this), "first");
        uint256 id = governor.propose(DOMAIN, "first");

        assertEq(id, 0);
        assertEq(governor.proposalCount(), 1);
        MockGovernor.Proposal memory p = governor.getProposal(0);
        assertEq(p.domainId, DOMAIN);
        assertEq(p.proposer, address(this));
        assertEq(p.description, "first");
    }

    function test_Propose_SequentialIds() public {
        assertEq(governor.propose(DOMAIN, "a"), 0);
        assertEq(governor.propose(DOMAIN, "b"), 1);
        assertEq(governor.proposalCount(), 2);
    }

    function test_RevertWhen_ProposalNotFound() public {
        vm.expectRevert(abi.encodeWithSelector(MockGovernor.ProposalNotFound.selector, 0));
        governor.getProposal(0);
    }
}
