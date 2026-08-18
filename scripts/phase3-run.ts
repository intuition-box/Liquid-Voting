/**
 * Phase 3 step 3 — the acceptance criteria, live on 13579, through the signed chain:
 *
 *   1. UX proposal through the full 2-level chain          -> PASSES (recorded, proposer = voter SA)
 *   2. branding proposal under the design root (level 1)   -> PASSES
 *   3. legal proposal under the same delegation            -> FAILS  NotATriple
 *   4. narrowing: branding through the UX-narrowed chain   -> FAILS  NotATriple (ADR 0007)
 *   5. maxDepth: logo (2 hops) under a maxDepth-1 variant  -> FAILS  PathTooLong
 *   6. revocation: voter disables the root                 -> both downstream accounts die
 *
 * Expected-pass cases run as real self-bundled user operations (ADR 0010) and the
 * resulting governor state is re-read. Expected-fail cases are proven against live
 * state with an eth_call preflight (`from` = the redeeming smart account): the full
 * redemption path — signature validation, every enforcer hook — executes on the live
 * contracts and the specific revert reason is decoded; no gas is burned on known
 * failures (this is exactly the frontend's panel-3 flow). Case 6 changes state for
 * real; run `bun run phase3:delegate` afterwards to sign a fresh chain (new salt).
 *
 * Run: bun run phase3:run
 */
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExecutionMode, createExecution, type Delegation } from "@metamask/smart-accounts-kit";
import { encodeExecutionCalldatas, encodePermissionContexts } from "@metamask/smart-accounts-kit/utils";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest } from "./lib/network";
import { toHybridAccount, ensureEnvironment } from "./lib/kit";
import { sendUserOp } from "./lib/user-op";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsPath = join(repoRoot, "data", "accounts.json");
const delegationsPath = join(repoRoot, "data", "delegations.json");

const errorAbi = [
  { type: "error", name: "NotATriple", inputs: [{ name: "tripleId", type: "bytes32" }] },
  { type: "error", name: "NotAttested", inputs: [{ name: "tripleId", type: "bytes32" }, { name: "attestor", type: "address" }] },
  { type: "error", name: "PathTooLong", inputs: [{ name: "hops", type: "uint256" }, { name: "maxDepth", type: "uint8" }] },
  { type: "error", name: "PathStartMismatch", inputs: [{ name: "pathStart", type: "bytes32" }, { name: "proposalDomain", type: "bytes32" }] },
  { type: "error", name: "PathEndMismatch", inputs: [{ name: "pathEnd", type: "bytes32" }, { name: "rootDomainId", type: "bytes32" }] },
  { type: "error", name: "DelegationExpired", inputs: [{ name: "expiry", type: "uint64" }, { name: "currentTimestamp", type: "uint256" }] },
  { type: "error", name: "EmptyPath", inputs: [] },
  { type: "error", name: "InvalidTarget", inputs: [{ name: "actual", type: "address" }, { name: "expected", type: "address" }] },
  { type: "error", name: "InvalidSelector", inputs: [{ name: "actual", type: "bytes4" }, { name: "expected", type: "bytes4" }] },
  { type: "error", name: "CannotUseADisabledDelegation", inputs: [] },
  { type: "error", name: "InvalidERC1271Signature", inputs: [] },
  { type: "error", name: "InvalidDelegate", inputs: [] },
  { type: "error", name: "InvalidAuthority", inputs: [] },
] as const;

const redeemAbi = [
  {
    type: "function",
    name: "redeemDelegations",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_permissionContexts", type: "bytes[]" },
      { name: "_modes", type: "bytes32[]" },
      { name: "_executionCallDatas", type: "bytes[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "disableDelegation",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "_delegation",
        type: "tuple",
        components: [
          { name: "delegate", type: "address" },
          { name: "delegator", type: "address" },
          { name: "authority", type: "bytes32" },
          {
            name: "caveats",
            type: "tuple[]",
            components: [
              { name: "enforcer", type: "address" },
              { name: "terms", type: "bytes" },
              { name: "args", type: "bytes" },
            ],
          },
          { name: "salt", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

const governorAbi = [
  { type: "function", name: "proposalCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "propose",
    stateMutability: "nonpayable",
    inputs: [{ name: "domainId", type: "bytes32" }, { name: "description", type: "string" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getProposal",
    stateMutability: "view",
    inputs: [{ name: "proposalId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "domainId", type: "bytes32" },
          { name: "proposer", type: "address" },
          { name: "description", type: "string" },
        ],
      },
    ],
  },
] as const;

interface SignedDelegations {
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
}

function decodeRevert(data: Hex): string {
  try {
    const decoded = decodeErrorResult({ abi: errorAbi, data });
    return `${decoded.errorName}(${(decoded.args ?? []).map(String).join(", ")})`;
  } catch {
    return `unrecognized revert data ${data}`;
  }
}

function encodePath(path: Hex[]): Hex {
  return encodeAbiParameters([{ type: "bytes32[]" }], [path]);
}

/** Attaches path witnesses and builds the redeemDelegations calldata for one chain. */
function buildRedeemCalldata(
  chain: Delegation[],
  paths: Hex[][],
  governor: `0x${string}`,
  domainId: Hex,
  description: string,
): Hex {
  const withArgs = chain.map((delegation, i) => ({
    ...delegation,
    caveats: delegation.caveats.map((caveat) => ({ ...caveat, args: encodePath(paths[i] ?? []) })),
  }));
  const execution = createExecution({
    target: governor,
    callData: encodeFunctionData({ abi: governorAbi, functionName: "propose", args: [domainId, description] }),
  });
  return encodeFunctionData({
    abi: redeemAbi,
    functionName: "redeemDelegations",
    args: [encodePermissionContexts([withArgs]), [ExecutionMode.SingleDefault], encodeExecutionCalldatas([[execution]])],
  });
}

async function main(): Promise<void> {
  if (!existsSync(accountsPath) || !existsSync(delegationsPath)) {
    throw new Error("run phase3:setup and phase3:delegate first");
  }
  const stored = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, `0x${string}`> };
  const signed = JSON.parse(readFileSync(delegationsPath, "utf-8")) as SignedDelegations;
  const manifest = readManifest();
  const governor = manifest.contracts.MockGovernor.address;
  const atoms = manifest.vocabulary.atoms as Record<string, Hex>;
  const design = atoms["design"] as Hex;
  const branding = atoms["branding"] as Hex;
  const ux = atoms["UX"] as Hex;
  const legal = atoms["legal"] as Hex;
  const logo = atoms["logo"] as Hex;

  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
  const environment = ensureEnvironment();
  const manager = environment.DelegationManager;

  const submitter = createWalletClient({
    chain: intuitionTestnet,
    transport,
    account: privateKeyToAccount((process.env["PRIVATE_KEY"] ?? "") as `0x${string}`),
  });
  const voterSA = await toHybridAccount(publicClient, privateKeyToAccount(stored.keys["voter"] as `0x${string}`));
  const delegateSA = await toHybridAccount(publicClient, privateKeyToAccount(stored.keys["delegate"] as `0x${string}`));
  const executorSA = await toHybridAccount(publicClient, privateKeyToAccount(stored.keys["executor"] as `0x${string}`));

  const root: Delegation = { ...signed.rootDelegation };
  const leaf: Delegation = { ...signed.leafDelegation };

  /** eth_call with from = the redeeming SA: full live redemption path, no gas, exact revert. */
  async function preflight(from: `0x${string}`, data: Hex): Promise<{ ok: boolean; reason: string | null }> {
    try {
      await publicClient.call({ to: manager, data, account: from });
      return { ok: true, reason: null };
    } catch (error) {
      const revertData = extractRevertData(error);
      return { ok: false, reason: revertData ? decodeRevert(revertData) : String(error).slice(0, 200) };
    }
  }

  function extractRevertData(error: unknown): Hex | null {
    let current: unknown = error;
    while (current && typeof current === "object") {
      const maybe = current as { data?: unknown; cause?: unknown };
      if (typeof maybe.data === "string" && maybe.data.startsWith("0x") && maybe.data.length > 2) {
        return maybe.data as Hex;
      }
      current = maybe.cause;
    }
    return null;
  }

  const results: string[] = [];
  function report(line: string): void {
    console.log(line);
    results.push(line);
  }

  // ── 1. UX through the full chain: executor redeems [leaf, root] ─────────────────
  {
    const data = buildRedeemCalldata([leaf, root], [[ux], [ux, design]], governor, ux, "UX proposal via full chain");
    const pre = await preflight(executorSA.address, data);
    if (!pre.ok) throw new Error(`case 1 preflight unexpectedly failed: ${pre.reason}`);
    const before = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "proposalCount" });
    const op = await sendUserOp(publicClient, submitter, executorSA, [{ to: manager, value: 0n, data }]);
    const after = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "proposalCount" });
    if (!op.success || after !== before + 1n) throw new Error(`case 1 failed: op.success=${op.success} count ${before}->${after}`);
    const proposal = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "getProposal", args: [after - 1n] });
    if (proposal.proposer.toLowerCase() !== voterSA.address.toLowerCase()) {
      throw new Error(`case 1: proposer ${proposal.proposer} is not the voter SA`);
    }
    report(`1. PASS  UX via full chain — proposal #${after - 1n} recorded, proposer = voter SA (tx ${op.txHash})`);
  }

  // ── 2. branding under the design root: delegate redeems [root] ──────────────────
  {
    const data = buildRedeemCalldata([root], [[branding, design]], governor, branding, "branding proposal via design root");
    const pre = await preflight(delegateSA.address, data);
    if (!pre.ok) throw new Error(`case 2 preflight unexpectedly failed: ${pre.reason}`);
    const op = await sendUserOp(publicClient, submitter, delegateSA, [{ to: manager, value: 0n, data }]);
    const count = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "proposalCount" });
    if (!op.success) throw new Error("case 2 user op failed");
    report(`2. PASS  branding under design root — proposal #${count - 1n} recorded (tx ${op.txHash})`);
  }

  // ── 3. legal under the same delegation: must fail with NotATriple ───────────────
  {
    const data = buildRedeemCalldata([root], [[legal, design]], governor, legal, "legal proposal (must fail)");
    const pre = await preflight(delegateSA.address, data);
    if (pre.ok || !pre.reason?.startsWith("NotATriple")) throw new Error(`case 3 expected NotATriple, got ${pre.reason}`);
    report(`3. PASS  legal rejected live — ${pre.reason}`);
  }

  // ── 4. narrowing: branding through the UX-narrowed chain must fail (ADR 0007) ───
  {
    const data = buildRedeemCalldata([leaf, root], [[branding, ux], [branding, design]], governor, branding, "branding via UX chain (must fail)");
    const pre = await preflight(executorSA.address, data);
    if (pre.ok || !pre.reason?.startsWith("NotATriple")) throw new Error(`case 4 expected NotATriple, got ${pre.reason}`);
    report(`4. PASS  narrowing blocks branding through the UX-scoped level — ${pre.reason}`);
  }

  // ── 5. maxDepth: logo (2 hops) under a maxDepth-1 variant must fail ─────────────
  {
    const shallowTerms = encodeAbiParameters(
      [
        { type: "bytes32" }, { type: "bytes32" }, { type: "uint8" }, { type: "uint64" }, { type: "address" },
      ],
      [design, manifest.vocabulary.predicate.termId, 1, 0n, manifest.attestation.orgAttestor as `0x${string}`],
    );
    const shallow: Delegation = {
      delegate: delegateSA.address,
      delegator: voterSA.address,
      authority: root.authority,
      caveats: [{ enforcer: manifest.contracts.GraphDomainCaveatEnforcer.address, terms: shallowTerms, args: "0x" }],
      salt: root.salt,
      signature: "0x",
    };
    shallow.signature = await voterSA.signDelegation({ delegation: shallow });
    const data = buildRedeemCalldata([shallow], [[logo, branding, design]], governor, logo, "logo under maxDepth 1 (must fail)");
    const pre = await preflight(delegateSA.address, data);
    if (pre.ok || !pre.reason?.startsWith("PathTooLong")) throw new Error(`case 5 expected PathTooLong, got ${pre.reason}`);
    report(`5. PASS  maxDepth respected — ${pre.reason}`);
  }

  // ── 6. revocation: voter disables the root; both downstream accounts die ────────
  {
    const disableData = encodeFunctionData({
      abi: redeemAbi,
      functionName: "disableDelegation",
      args: [{ ...root, salt: BigInt(root.salt) }],
    });
    const op = await sendUserOp(publicClient, submitter, voterSA, [{ to: manager, value: 0n, data: disableData }]);
    if (!op.success) throw new Error(`revocation user op failed (tx ${op.txHash})`);

    const chainData = buildRedeemCalldata([leaf, root], [[ux], [ux, design]], governor, ux, "UX after revoke (must fail)");
    const executorAfter = await preflight(executorSA.address, chainData);
    const rootData = buildRedeemCalldata([root], [[branding, design]], governor, branding, "branding after revoke (must fail)");
    const delegateAfter = await preflight(delegateSA.address, rootData);
    const bothDead =
      !executorAfter.ok && executorAfter.reason?.startsWith("CannotUseADisabledDelegation") &&
      !delegateAfter.ok && delegateAfter.reason?.startsWith("CannotUseADisabledDelegation");
    if (!bothDead) {
      throw new Error(`case 6: executor=${executorAfter.reason} delegate=${delegateAfter.reason}`);
    }
    report(`6. PASS  revocation kills the whole chain — executor AND delegate now revert CannotUseADisabledDelegation (revoke tx ${op.txHash})`);
  }

  console.log("\nAll six acceptance flows verified live on 13579.");
  console.log("The signed chain is now revoked — run `bun run phase3:delegate` to sign a fresh one.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
