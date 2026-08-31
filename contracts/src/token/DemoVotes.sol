// SPDX-License-Identifier: MIT
pragma solidity >=0.8.23 <0.9.0;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { ERC20Votes } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import { Nonces } from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title DemoVotes
/// @notice The governance token OZGovernor reads weight from.
/// @dev Nothing but OpenZeppelin's ERC20Votes, which is where the weight actually comes
///      from: a balance at a past block, not a number anyone can assign. That is the whole
///      difference with DemoGovernor, and the reason this token exists.
///
///      `mint` is open because this is a testnet demo — on a real deployment the supply
///      would be distributed once and this function would not be here.
contract DemoVotes is ERC20, ERC20Permit, ERC20Votes {
    constructor() ERC20("Demo Votes", "DVOTE") ERC20Permit("Demo Votes") { }

    /// @notice Mints voting tokens. Testnet only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
