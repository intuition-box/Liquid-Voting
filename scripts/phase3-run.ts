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
 * failures. Both paths go through the frontend's own service layer (src/lib), so the
 * demo on screen and this runner exercise identical code. Case 6 changes state for
 * real; run `bun run phase3:delegate` afterwards to sign a fresh chain (new salt).
 *
 * Run: bun run phase3:run
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { intuitionTestnet, readManifest } from "./lib/network";
import { governorAbi } from "../src/lib/abis";
import { FRAMEWORK } from "../src/lib/chain";
import {
  buildDisableCalldata,
  buildRedeemCalldata,
  encodeTerms,
  preflightRedeem,
  type Delegation,
} from "../src/lib/delegation";
import { toHybridAccount } from "../src/lib/smart-accounts";
import { sendUserOp } from "../src/lib/user-op";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const accountsPath = join(repoRoot, "data", "accounts.json");
const delegationsPath = join(repoRoot, "data", "delegations.json");

interface SignedDelegations {
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
}

async function main(): Promise<void> {
  if (!existsSync(accountsPath) || !existsSync(delegationsPath)) {
    throw new Error("run phase3:setup and phase3:delegate first");
  }
  const stored = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys: Record<string, `0x${string}`> };
  const signed = JSON.parse(readFileSync(delegationsPath, "utf-8")) as SignedDelegations;
  const manifest = readManifest();
  const governor = manifest.contracts.MockGovernor.address;
  const enforcer = manifest.contracts.GraphDomainCaveatEnforcer.address;
  const attestor = manifest.attestation.orgAttestor;
  if (!attestor) throw new Error("manifest attestation.orgAttestor missing — run seed first");
  const atoms = manifest.vocabulary.atoms as Record<string, Hex>;
  const design = atoms["design"] as Hex;
  const branding = atoms["branding"] as Hex;
  const ux = atoms["UX"] as Hex;
  const legal = atoms["legal"] as Hex;
  const logo = atoms["logo"] as Hex;

  const transport = http(process.env["INTUITION_TESTNET_RPC"] ?? intuitionTestnet.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: intuitionTestnet, transport });
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
  const manager = FRAMEWORK.delegationManager;

  // ── 1. UX through the full chain: executor redeems [leaf, root] ─────────────────
  {
    const calldata = buildRedeemCalldata({
      chain: [leaf, root],
      witnesses: [[ux], [ux, design]],
      governor,
      domainId: ux,
      description: "UX proposal via full chain",
    });
    const pre = await preflightRedeem(publicClient, executorSA.address, calldata);
    if (!pre.ok) throw new Error(`case 1 preflight unexpectedly failed: ${pre.revert?.formatted ?? pre.raw}`);
    const before = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "proposalCount" });
    const op = await sendUserOp(publicClient, submitter, executorSA, [{ to: manager, value: 0n, data: calldata }]);
    const after = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "proposalCount" });
    if (!op.success || after !== before + 1n) throw new Error(`case 1 failed: success=${op.success} count ${before}->${after}`);
    const proposal = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "getProposal", args: [after - 1n] });
    if (proposal.proposer.toLowerCase() !== voterSA.address.toLowerCase()) {
      throw new Error(`case 1: proposer ${proposal.proposer} is not the voter SA`);
    }
    console.log(`1. PASS  UX via full chain — proposal #${after - 1n} recorded, proposer = voter SA (tx ${op.txHash})`);
  }

  // ── 2. branding under the design root: delegate redeems [root] ──────────────────
  {
    const calldata = buildRedeemCalldata({
      chain: [root],
      witnesses: [[branding, design]],
      governor,
      domainId: branding,
      description: "branding proposal via design root",
    });
    const pre = await preflightRedeem(publicClient, delegateSA.address, calldata);
    if (!pre.ok) throw new Error(`case 2 preflight unexpectedly failed: ${pre.revert?.formatted ?? pre.raw}`);
    const op = await sendUserOp(publicClient, submitter, delegateSA, [{ to: manager, value: 0n, data: calldata }]);
    if (!op.success) throw new Error("case 2 user op failed");
    const count = await publicClient.readContract({ address: governor, abi: governorAbi, functionName: "proposalCount" });
    console.log(`2. PASS  branding under design root — proposal #${count - 1n} recorded (tx ${op.txHash})`);
  }

  // ── 3. legal under the same delegation: must fail with NotATriple ───────────────
  {
    const calldata = buildRedeemCalldata({
      chain: [root],
      witnesses: [[legal, design]],
      governor,
      domainId: legal,
      description: "legal proposal (must fail)",
    });
    const pre = await preflightRedeem(publicClient, delegateSA.address, calldata);
    if (pre.ok || pre.revert?.name !== "NotATriple") {
      throw new Error(`case 3 expected NotATriple, got ${pre.ok ? "success" : pre.revert?.formatted ?? pre.raw}`);
    }
    console.log(`3. PASS  legal rejected live — ${pre.revert.formatted}`);
  }

  // ── 4. narrowing: branding through the UX-narrowed chain must fail (ADR 0007) ───
  {
    const calldata = buildRedeemCalldata({
      chain: [leaf, root],
      witnesses: [[branding, ux], [branding, design]],
      governor,
      domainId: branding,
      description: "branding via UX chain (must fail)",
    });
    const pre = await preflightRedeem(publicClient, executorSA.address, calldata);
    if (pre.ok || pre.revert?.name !== "NotATriple") {
      throw new Error(`case 4 expected NotATriple, got ${pre.ok ? "success" : pre.revert?.formatted ?? pre.raw}`);
    }
    console.log(`4. PASS  narrowing blocks branding through the UX-scoped level — ${pre.revert.formatted}`);
  }

  // ── 5. maxDepth: logo (2 hops) under a maxDepth-1 variant must fail ─────────────
  {
    const shallow: Delegation = {
      delegate: delegateSA.address,
      delegator: voterSA.address,
      authority: root.authority,
      caveats: [
        {
          enforcer,
          terms: encodeTerms({
            rootDomainId: design,
            predicateId: manifest.vocabulary.predicate.termId,
            maxDepth: 1,
            expiry: 0n,
            attestor,
          }),
          args: "0x",
        },
      ],
      salt: root.salt,
      signature: "0x",
    };
    shallow.signature = await voterSA.signDelegation({ delegation: shallow });
    const calldata = buildRedeemCalldata({
      chain: [shallow],
      witnesses: [[logo, branding, design]],
      governor,
      domainId: logo,
      description: "logo under maxDepth 1 (must fail)",
    });
    const pre = await preflightRedeem(publicClient, delegateSA.address, calldata);
    if (pre.ok || pre.revert?.name !== "PathTooLong") {
      throw new Error(`case 5 expected PathTooLong, got ${pre.ok ? "success" : pre.revert?.formatted ?? pre.raw}`);
    }
    console.log(`5. PASS  maxDepth respected — ${pre.revert.formatted}`);
  }

  // ── 6. revocation: voter disables the root; both downstream accounts die ────────
  {
    const op = await sendUserOp(publicClient, submitter, voterSA, [
      { to: manager, value: 0n, data: buildDisableCalldata(root) },
    ]);
    if (!op.success) throw new Error(`revocation user op failed (tx ${op.txHash})`);

    const executorAfter = await preflightRedeem(
      publicClient,
      executorSA.address,
      buildRedeemCalldata({
        chain: [leaf, root],
        witnesses: [[ux], [ux, design]],
        governor,
        domainId: ux,
        description: "UX after revoke (must fail)",
      }),
    );
    const delegateAfter = await preflightRedeem(
      publicClient,
      delegateSA.address,
      buildRedeemCalldata({
        chain: [root],
        witnesses: [[branding, design]],
        governor,
        domainId: branding,
        description: "branding after revoke (must fail)",
      }),
    );
    const bothDead =
      !executorAfter.ok && executorAfter.revert?.name === "CannotUseADisabledDelegation" &&
      !delegateAfter.ok && delegateAfter.revert?.name === "CannotUseADisabledDelegation";
    if (!bothDead) {
      throw new Error(
        `case 6 not both dead: executor=${executorAfter.ok ? "success" : executorAfter.revert?.formatted} ` +
          `delegate=${delegateAfter.ok ? "success" : delegateAfter.revert?.formatted}`,
      );
    }
    console.log(
      `6. PASS  revocation kills the whole chain — executor AND delegate now revert CannotUseADisabledDelegation (revoke tx ${op.txHash})`,
    );
  }

  console.log("\nAll six acceptance flows verified live on 13579.");
  console.log("The signed chain is now revoked — run `bun run phase3:delegate` to sign a fresh one.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
