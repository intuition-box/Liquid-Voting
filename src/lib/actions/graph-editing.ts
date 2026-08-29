/**
 * Growing the graph: minting a domain atom, linking it under a parent, and staking it —
 * after which a delegation signed earlier covers a domain that did not exist at signing.
 */
import { stringToHex, type Hex, type PublicClient } from "viem";

import { multiVaultAbi } from "../chain/abis";
import type { AppConfig } from "../config/app-config";

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
  const parentId = config.nodes.find((node) => node.label === parentLabel)?.termId;
  if (!parentId) throw new Error(`unknown parent domain “${parentLabel}”`);

  const wallet = submitterClient(config);
  const vault = { address: config.multiVault, abi: multiVaultAbi } as const;
  const data = stringToHex(label);

  const atomId = await client.readContract({ ...vault, functionName: "calculateAtomId", args: [data] });
  let atomTx: Hex | null = null;
  if (!(await client.readContract({ ...vault, functionName: "isTermCreated", args: [atomId] }))) {
    const atomCost = await client.readContract({ ...vault, functionName: "getAtomCost" });
    atomTx = await wallet.writeContract({ ...vault, functionName: "createAtoms", args: [[data], [atomCost]], value: atomCost });
    await client.waitForTransactionReceipt({ hash: atomTx });
  }

  const tripleId = await client.readContract({
    ...vault,
    functionName: "calculateTripleId",
    args: [atomId, config.predicate.termId, parentId],
  });
  let tripleTx: Hex | null = null;
  if (!(await client.readContract({ ...vault, functionName: "isTermCreated", args: [tripleId] }))) {
    const tripleCost = await client.readContract({ ...vault, functionName: "getTripleCost" });
    tripleTx = await wallet.writeContract({
      ...vault,
      functionName: "createTriples",
      args: [[atomId], [config.predicate.termId], [parentId], [tripleCost]],
      value: tripleCost,
    });
    await client.waitForTransactionReceipt({ hash: tripleTx });
  }

  const stakeTx = await wallet.writeContract({
    ...vault,
    functionName: "deposit",
    args: [config.attestor, tripleId, config.curveId, 0n],
    value: stakeWei,
  });
  await client.waitForTransactionReceipt({ hash: stakeTx });

  const shares = await client.readContract({
    ...vault,
    functionName: "getShares",
    args: [config.attestor, tripleId, config.curveId],
  });
  if (shares === 0n) throw new Error("stake did not register — the edge would authorize nothing");

  return { label, atomId, tripleId, atomTx, tripleTx, stakeTx, shares };
}
