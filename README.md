# Graph-scoped governance delegation

Delegate a vote **by domain**, and let a knowledge graph decide what that domain covers.

An account hands its voting weight to another on `treasury`. The delegate can then vote on
`payroll`, `grants` and `micro-grants` — because the Intuition graph says those sit under
`treasury` — but not on `events`, which does not. Add `audit-fund — is a sub-domain of —
treasury` to the graph and every `treasury` delegation already signed reaches it, with no
contract redeployed and no signature reissued.

Built as a proof of concept for the Intuition Box DAO bounty (Mission 10), live on
Intuition testnet.

## How it works

Each delegation is an [ERC-7710](https://eips.ethereum.org/EIPS/eip-7710) delegation
carrying one custom caveat, `GraphDomainScope`. At vote time the caveat has to answer a
single question: *is this proposal's domain inside the domain this delegation was signed
for?*

The Intuition MultiVault cannot be asked that directly. Its storage is keyed by
`hash(subject, predicate, object)`, so a contract can verify that a given triple exists
but can never enumerate the children of a node. There is no reverse index, which makes
on-chain graph traversal impossible rather than merely expensive.

So the redeemer supplies the path as a **witness** in the delegation's `args`, and the
enforcer verifies every hop against live chain state — the same split as a Merkle proof:
the prover offers a witness, never a fact. Per hop, at roughly 14k gas:

```
calculateTripleId(child, predicate, parent)   recompute the edge's id
getVaultType(id) == 1                         a positive triple, never a counter-triple
getShares(attestor, id, curveId) > 0          somebody staked on it
```

That last line is the trust model. Triples are permissionless — anyone can mint
`events — is a sub-domain of — treasury` for a fraction of a cent — so **existence is not
attestation**. Creating a term forces a deposit, which makes a stake position the readable
proof that a named attestor stands behind an edge. Whose stake counts is a signed term:
an organisation's address for institutional curation, or `address(0)`, which resolves to
the delegator so each level of a chain is read through its own signer's view of the graph.

Narrowing needs no code. The Delegation Framework runs every caveat in a chain and
requires all of them to pass, so a delegation narrowed from `treasury` to `grants` is the
intersection of the two scopes.

Weight is a separate question from scope, and it is answered separately. The token says
how much an account holds; a register beside the governor says who may exercise it where.
Because a lending moves no token, the governor also keeps count of **how much of each
account's weight is already on each proposal** — otherwise a delegator could take a domain
back after its delegate had voted and cast the same weight again. A lending is followed to
the end of its chain, so in A → B → C it is C who votes with A's weight and B, having
passed on what it held, holds nothing. See [ADR 0020](docs/adr/0020-a-voice-is-spent-once.md)
and [ADR 0021](docs/adr/0021-a-lending-is-passed-on.md).

Every voice a vote carries is logged under the principal, indexed, so a delegator can ask
what was cast in its name with one query rather than a scan of every vote ever recorded.
Delegating by domain is only worth doing if the delegator stays accountable, and that has
to be readable from the chain rather than reconstructed by one front end
([ADR 0022](docs/adr/0022-accountability-is-logged.md)).

## Deployed on Intuition testnet (chain 13579)

The app runs on a stock OpenZeppelin `Governor`. Nothing in their package is modified or
copied: `Governor`, `GovernorSettings`, `GovernorCountingSimple` and `GovernorVotes` are
inherited as published, and the whole integration is one override of `_getVotes`, which
`Governor` declares `virtual` for exactly this purpose. OpenZeppelin's own `delegate()`
moves an account's entire weight to one delegate; per-domain delegation is finer, so a
second register answers *who may exercise weight where* while the token keeps answering
*how much*.

| Contract | Address | Role |
|---|---|---|
| `OZGovernor` | [`0xd3eAA81C…917F`](https://testnet.explorer.intuition.systems/address/0xd3eAA81C5D283E4270EFB568045A7b406197917F) | OpenZeppelin Governor + `DomainVotes`. What the app votes through. |
| `OZGraphDomainScope` | [`0x6FC726eC…8C59`](https://testnet.explorer.intuition.systems/address/0x6FC726eCCfbAA30D08FbcC7F4afb3bAa30298C59) | The caveat, bound to that governor and its resolver. |
| `ProposalDomains` | [`0x11CC4155…f31D`](https://testnet.explorer.intuition.systems/address/0x11CC4155bf035394b79291529b423406859ff31D) | Which domain a proposal belongs to. OZ proposals have no field for it. |
| `DemoVotes` | [`0x0f44F7d9…2b50`](https://testnet.explorer.intuition.systems/address/0x0f44F7d916e19B04A6291a1fAB37fC5178EEA14e) | The `ERC20Votes` weight is read from. |
| `DemoGovernor` | [`0x2bEE53dd…6cEE`](https://testnet.explorer.intuition.systems/address/0x2bEE53dd6BE3eEea1769A74AAb64773b1C176cEE) | The first implementation: OZ-shaped, self-contained. Test harness and point of comparison. |
| `GraphDomainScope` | [`0x948CFe84…5302`](https://testnet.explorer.intuition.systems/address/0x948CFe8438161390DbeF07c291Cb8ffDd7955302) | The same caveat bound to `DemoGovernor`. |

Reading the graph: MultiVault
[`0x2Ece8D4d…AB91`](https://testnet.explorer.intuition.systems/address/0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91),
17 domain atoms and 16 `is a sub-domain of` triples, each staked by the curator
`0xAA7a2Dfe…615A`. MetaMask's Delegation Framework **v1.3.0** is deployed at its canonical
CREATE2 addresses, all 31 standard enforcers included.

Every address lives in [`manifest/13579.json`](manifest/13579.json), the single source of
truth shared by the scripts, the tests and the frontend.

## Running it

Requires [bun](https://bun.sh) and [Foundry](https://getfoundry.sh).

```bash
bun install
bun run verify     # read-only: asserts the demo's claims against live chain state
bun run dev        # http://localhost:5173
```

Those three accounts belong to whoever generated them: their owner keys live in
`data/accounts.json`, which is gitignored because it has to be. Anywhere else — a clone, a
hosted build — press **Create three wallets** instead. Four keys are generated in the
browser, three smart accounts are deployed, funded, given a hundred `DVOTE` each and
self-delegated, and the whole thing plays out in the transaction log at the foot of the
page. About thirty seconds.

Hosted, the first tTRUST comes from your own wallet: one transaction of 0.03 tTRUST funds
the session, and the three accounts pay for everything after it themselves. No funded key
exists anywhere, which is the point — one in `dist/` would be published to whoever reads
the bundle. [ADR 0023](docs/adr/0023-sessions-are-made-in-the-browser.md) has the
reasoning, and [`faucet/`](faucet/README.md) is the alternative for a deployment that
would rather nobody needed a wallet.

The frontend needs two gitignored files the scripts produce — `data/accounts.json` (owner
keys) and `data/delegations.json` (the pre-signed chain) — plus `contracts/.env` with a
funded `PRIVATE_KEY`. See [`contracts/.env.example`](contracts/.env.example). From a clean
chain:

```bash
bun run seed       # create the domain vocabulary and stake every edge
bun run setup      # deploy and fund the three HybridDeleGator accounts
bun run delegate   # sign the delegation chain
```

Secrets reach the browser only in dev, through a generated `.env.local`; a production
build carries none and opens read-only. See
[ADR 0011](docs/adr/0011-frontend-demo-keys.md).

### Scripts

| Command | What it does |
|---|---|
| `bun run verify` | Read-only. Asserts every panel's behaviour against live state. Run before presenting. |
| `bun run reset` | Back to the opening state: delegations taken back, a fresh proposal per domain. |
| `bun run seed` | Creates the vocabulary if absent, then stakes each edge. Idempotent. |
| `bun run setup` | Deploys and funds the three smart accounts. Idempotent. |
| `bun run delegate` | Signs the delegation chain off-chain. Free. |
| `bun run acceptance` | The counting rules proven live: a voice spent once, a chain of three. |
| `bun run rehearse` | Runs the live graph extension under a throwaway label. |
| `bun run dev` / `build` | The frontend. |

There is no bundler on chain 13579 and `DeleGatorCore.execute` is `onlyEntryPoint`, so
every smart-account action is a self-bundled user operation: a funded EOA submits
`EntryPoint.handleOps`, each account pre-pays its own gas. No relayer, no paymaster.

## Tests

```bash
cd contracts
forge test                                  # 141 tests, 6 suites
forge test --no-match-path "test/**/*fork*" # 129 offline, against a MockMultiVault
forge test --match-path "test/**/*fork*"    # 12 fork tests, live RPC
```

| Suite | Tests | What it covers |
|---|---|---|
| `enforcers/GraphDomainScope.t.sol` | 33 | Every revert path of the caveat, plus fuzzing on the witness. |
| `enforcers/DelegationChain.fork.t.sol` | 9 | The chain end to end against the real MultiVault and DelegationManager. |
| `governance/DemoGovernor.t.sol` | 53 | Proposal lifecycle, counting, the per-domain register. |
| `governance/OZGovernor.t.sol` | 37 | The `_getVotes` override, and the counting rules: a voice spent once, a lending followed to the end of its chain, a path that has to hold up. |
| `gas/Bench.t.sol` | 6 | Gas per witness depth, 0 to 5. |
| `gas/Bench.fork.t.sol` | 3 | The same against live vault storage. |

`GraphDomainScope` and `DomainVotes` — the caveat and the counting — are at **100 %** on
lines and functions, 96 % and above on statements. The rest of `src/` is covered in the
high eighties to high nineties, except `DemoVotes`, a plain `ERC20Votes` with no logic of
its own.

There is also `bun run acceptance`, which proves the counting rules against the real chain
rather than a mock: ten checks, through the same `src/lib` the frontend runs.

The fork suites need the public RPC, which enforces a bandwidth quota and answers
`-31002 Bandwidth limit exceeded` when it is exhausted — a fork suite that cannot
instantiate reports as a failure without anything being wrong in the code.

## Layout

```
contracts/src/enforcers/    GraphDomainScope — the ERC-7710 caveat
contracts/src/governance/   OZGovernor + DomainVotes (what the app runs on) · DemoGovernor
contracts/src/resolvers/    ProposalDomains — a proposal's domain, beside the governor
contracts/src/token/        DemoVotes — the ERC20Votes
contracts/test/             mirrors src/, plus gas benchmarks and fork suites
scripts/                    the CLI above; scripts/lib/ is their shared setup
faucet/                     optional: a Worker that funds a session instead of a wallet
src/lib/                    services by subject — chain/ graph/ delegation/ config/ actions/
src/components/             the panels; src/hooks/ owns the reads they display
manifest/13579.json         addresses, vocabulary term_ids, curator stakes
```

## Documentation

| Document | For |
|---|---|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | What was built and why, in plain terms. Start here. |
| [docs/WRITEUP.md](docs/WRITEUP.md) | Design decisions, gas, limitations, what production needs. |
| [docs/DEMO.md](docs/DEMO.md) | An ordered demo script, expected output and recovery moves. |
| [docs/slides.md](docs/slides.md) | Slide outline for the presentation. |
| [docs/adr/](docs/adr/) | ADRs 0001–0028: every architectural decision, with the alternatives rejected. |
| [contracts/SECURITY_REVIEW.md](contracts/SECURITY_REVIEW.md) | Threat-model walk, reviewed with no code findings. |
| [docs/phase0/](docs/phase0/) | The opening audit: framework verification and the graph vocabulary. |

Two diagrams sit beside them as `.excalidraw` files, openable at excalidraw.com:
`docs/delegation-flow.excalidraw` for the signature and execution flow, and
`docs/scope-check.excalidraw` for how a scope is verified against the graph.
