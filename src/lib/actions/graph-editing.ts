/**
 * Growing the graph: minting a domain atom, linking it under a parent, and staking it —
 * after which a delegation signed earlier covers a domain that did not exist at signing.
 */
import { formatEther, stringToHex, type Hex, type PublicClient } from "viem";

import { multiVaultAbi } from "../chain/abis";
import type { AppConfig } from "../config/app-config";

import { trackTransaction } from "../chain/tx-log";
import { submitterClient } from "./common";

export interface ExtendResult {
  label: string;
  atomId: Hex;
  tripleId: Hex;
  atomTx: Hex | null;
  tripleTx: Hex | null;
  stakeTx: Hex;
  shares: bigint;
}

/**
 * The money shot: create a brand-new domain atom, link it under an existing parent, and
 * stake it — after which a delegation signed earlier authorizes a domain that did not
 * exist at signing time. No redeploy, no re-signature. Idempotent per step.
 */
export async function extendGraph(
  client: PublicClient,
  config: AppConfig,
  label: string,
  parentLabel: string,
  stakeWei: bigint,
): Promise<ExtendResult> {
  // The MultiVault reverts on empty atom data, and the revert arrives as a viem dump
  // naming `decodeErrorResult` — which is what the form used to show. The form now checks
  // the label before offering the button (`checkDomainLabel`, which also refuses
  // duplicates and over-long names); this is here so no other caller can reach the revert.
  if (label.trim().length === 0) throw new Error("a domain needs a name");
  const parentId = config.nodes.find((node) => node.label === parentLabel)?.termId;
  if (!parentId) throw new Error(`unknown parent domain “${parentLabel}”`);

  const wallet = submitterClient(config);
  const vault = { address: config.multiVault, abi: multiVaultAbi } as const;
  const data = stringToHex(label);

  /**
   * Can the submitter afford all three before any of them is sent?
   *
   * Growing the graph is a mint, a link and a stake, each its own transaction. Running
   * out between the second and the third leaves an edge in the graph that nobody has
   * staked — which is a legitimate state the enforcer handles, and a thoroughly
   * confusing one to arrive at by accident in front of an audience: the domain appears
   * in the rail and authorises nothing, for no reason the screen explains.
   *
   * Checked here, in one read, where the answer is still "not yet" rather than "half".
   */
  const [atomPrice, triplePrice, balance] = await Promise.all([
    client.readContract({ ...vault, functionName: "getAtomCost" }),
    client.readContract({ ...vault, functionName: "getTripleCost" }),
    client.getBalance({ address: wallet.account.address }),
  ]);
  // A fifth of the deposit again for gas: three transactions on this chain cost well
  // under that, and over-asking here is cheaper than stopping half way.
  const needed = atomPrice + triplePrice + stakeWei + stakeWei / 5n;
  if (balance < needed) {
    throw new Error(
      `${wallet.account.address.slice(0, 6)}…${wallet.account.address.slice(-4)} holds ${formatEther(balance)} tTRUST and growing the graph costs about ${formatEther(needed)} — a mint, a link and a stake. Top it up, or lower the stake.`,
    );
  }

  // Can this wallet stake for the attestor at all, before anything is minted?
  //
  // Every edge is staked for the curator, because that is the attestor the signed
  // delegations name — stake it for anybody else and the new domain authorizes nothing.
  // But `deposit` refuses a receiver that is not the sender without the receiver's
  // approval, so a browser session, whose submitter is a burner, cannot stake at all
  // until the curator has approved it.
  //
  // Asked here rather than discovered at the third transaction. Finding out last is what
  // the session hit: the atom was minted, the edge was written, and then the stake
  // reverted — leaving a domain in the rail that authorizes nothing, which is a real
  // state the enforcer handles and an inexplicable one to reach by accident. The probe is
  // a simulation against an edge that already exists, so it costs nothing and changes
  // nothing; only the approval error is conclusive, since any other revert means the
  // approval was fine.
  if (wallet.account.address.toLowerCase() !== config.attestor.toLowerCase()) {
    const existing = config.edges[0]?.tripleId;
    if (existing) {
      const refused = await client
        .simulateContract({
          ...vault,
          functionName: "deposit",
          args: [config.attestor, existing, config.curveId, 0n],
          value: stakeWei,
          account: wallet.account.address,
        })
        .then(() => null)
        .catch((error: unknown) => error);
      if (refused && JSON.stringify(refused instanceof Error ? refused.message : refused).includes("SenderNotApproved")) {
        throw new Error(
          `this wallet cannot stake on the curator's behalf, so a new domain would authorize nothing. The curator ${config.attestor.slice(0, 6)}…${config.attestor.slice(-4)} has to approve ${wallet.account.address.slice(0, 6)}…${wallet.account.address.slice(-4)} on the MultiVault first — which the session does automatically when it is funded from the curator's own key.`,
        );
      }
    }
  }

  const atomId = await client.readContract({ ...vault, functionName: "calculateAtomId", args: [data] });
  let atomTx: Hex | null = null;
  if (!(await client.readContract({ ...vault, functionName: "isTermCreated", args: [atomId] }))) {
    atomTx = await trackTransaction(
      client,
      {
        actor: wallet.account.address,
        label: `the domain “${label}” is minted on Intuition`,
        detail:
          "An atom in the MultiVault. Creating a term forces a deposit, which is what makes a stake position readable proof later on.",
        calls: [
          {
            contract: "MultiVault",
            address: config.multiVault,
            fn: "createAtoms(bytes[],uint256[])",
            args: { label, atomId },
            value: atomPrice,
          },
        ],
      },
      () => wallet.writeContract({ ...vault, functionName: "createAtoms", args: [[data], [atomPrice]], value: atomPrice }),
    );
  }

  const tripleId = await client.readContract({
    ...vault,
    functionName: "calculateTripleId",
    args: [atomId, config.predicate.termId, parentId],
  });
  let tripleTx: Hex | null = null;
  if (!(await client.readContract({ ...vault, functionName: "isTermCreated", args: [tripleId] }))) {
    tripleTx = await trackTransaction(
      client,
      {
        actor: wallet.account.address,
        label: `“${label} — is a sub-domain of — ${parentLabel}” is written to the graph`,
        detail:
          "The edge itself. From this point a delegation on the parent, signed before this domain existed, reaches it — with no contract redeployed and no signature reissued.",
        calls: [
          {
            contract: "MultiVault",
            address: config.multiVault,
            fn: "createTriples(bytes32[],bytes32[],bytes32[],uint256[])",
            args: { subject: label, predicate: config.predicate.label, object: parentLabel, tripleId },
            value: triplePrice,
          },
        ],
      },
      () =>
        wallet.writeContract({
          ...vault,
          functionName: "createTriples",
          args: [[atomId], [config.predicate.termId], [parentId], [triplePrice]],
          value: triplePrice,
        }),
    );
  }

  const stakeTx = await trackTransaction(
    client,
    {
      actor: wallet.account.address,
      label: `the curator stakes on “${label} → ${parentLabel}”`,
      detail:
        "Triples are permissionless, so existence is not attestation: anyone can mint an edge for a fraction of a cent. The enforcer reads a named attestor's stake, which is why the edge counts for nothing until this lands.",
      calls: [
        {
          contract: "MultiVault",
          address: config.multiVault,
          fn: "deposit(address,bytes32,uint256,uint256)",
          args: { attestor: config.attestor, triple: tripleId, curve: config.curveId.toString() },
          value: stakeWei,
        },
      ],
    },
    () =>
      wallet.writeContract({
        ...vault,
        functionName: "deposit",
        args: [config.attestor, tripleId, config.curveId, 0n],
        value: stakeWei,
      }),
  );

  const shares = await client.readContract({
    ...vault,
    functionName: "getShares",
    args: [config.attestor, tripleId, config.curveId],
  });
  if (shares === 0n) throw new Error("stake did not register — the edge would authorize nothing");

  return { label, atomId, tripleId, atomTx, tripleTx, stakeTx, shares };
}
