# Phase 1 — Gas per witness depth

`beforeHook` cost as a function of path depth (hops), measured 2026-08-17 with
`optimizer_runs = 200`. Every measurement runs in its own transaction, so vault
storage is **cold** — these are worst-case numbers; warm re-verification within the
same block is cheaper.

- **Mock** column: `test/unit/GasBench.t.sol` against `MockMultiVault`
  (`forge test --match-contract GasBench -vv`).
- **Live** column: `test/fork/GasBenchFork.t.sol` against the real MultiVault proxy on
  a 13579 fork. The live graph's longest chain is 2 hops (`logo → branding → design`),
  so depths 3–5 are extrapolated from the measured marginal hop cost.

| Depth (hops) | Mock gas | Live gas | Live source |
|---|---|---|---|
| 0 (exact match) | 17,535 | 17,535 | measured — no vault call at all |
| 1 | 35,211 | 44,209 | measured |
| 2 | 45,150 | 58,115 | measured |
| 3 | 55,088 | ~72,000 | extrapolated (+13.9k/hop) |
| 4 | 65,027 | ~86,000 | extrapolated |
| 5 | 74,964 | ~100,000 | extrapolated |

**Marginal hop cost:** ≈ 9,939 gas on the mock, ≈ 13,906 gas on the live vault. Per
hop the enforcer makes three staticcalls into the MultiVault: `calculateTripleId`
(pure — the keccak), `getVaultType` (one cold SLOAD family), `getShares` (one cold
SLOAD). The live vault sits behind a proxy, so each staticcall pays an extra
delegatecall hop — that is the mock/live gap.

Depth ≥ 1 additionally pays one `getBondingCurveConfig` staticcall per hook invocation
(the curve id is governance-configurable and read live, never hardcoded); depth 0
skips all vault interaction, which is why it is identical in both columns.

**Why the depth cap exists:** cost is strictly linear in hops and the loop is bounded
by the signed `maxDepth` (uint8), so there is no unbounded-loop surface; but the cap
is also semantic — every hop is one more edge the attestor must have staked, and a
delegation whose scope needs six hops of taxonomy to justify is probably scoped wrong.
At the recommended cap (3–5) the whole caveat costs less than a third of a Uniswap
swap, on an L3 where gas is near-free.

Note: in a 2-level chain redemption both enforcer instances run, so the total caveat
overhead is the sum of the two rows involved (e.g. leaf depth 0 + root depth 1
≈ 62k live).
