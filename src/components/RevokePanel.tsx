import { useState } from "react";
import type { PublicClient } from "viem";

import type { DemoConfig } from "../lib/demo-config";
import { planVoteForcingWitness, preflightVote, revokeRoot, VOTE_FOR } from "../lib/demo-actions";
import type { EdgeState } from "../lib/graph";
import { Button, Mono, Panel, Status, TxLink, type Verdict } from "./primitives";

interface Outcome {
  verdict: Verdict;
  message: string;
  txHash?: `0x${string}`;
}

/**
 * Revocation is framework-native: the voter calls `disableDelegation` and the
 * DelegationManager refuses the whole downstream chain. We wrote no code for it — this
 * panel proves it by re-simulating both levels afterwards.
 */
export function RevokePanel({
  config,
  client,
  edges,
  writable,
  rootDisabled,
  onSettled,
}: {
  config: DemoConfig;
  client: PublicClient;
  edges: EdgeState[];
  writable: boolean;
  rootDisabled: boolean;
  onSettled: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function revoke(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await revokeRoot(client, config);
      if (!result.success) {
        setOutcome({ verdict: "fail", message: "the revocation user operation reverted", txHash: result.txHash });
        return;
      }
      // The manager rejects a disabled delegation before any caveat runs, so the probe
      // needs no real proposal — any id reaches the check that matters.
      const [viaChain, viaRoot] = await Promise.all([
        preflightVote(client, config, planVoteForcingWitness(config, edges, "full", "UX", 0n, VOTE_FOR)),
        preflightVote(client, config, planVoteForcingWitness(config, edges, "root", "branding", 0n, VOTE_FOR)),
      ]);
      const executorReason = viaChain.ok ? "still passes" : viaChain.revert?.name ?? "rejected";
      const delegateReason = viaRoot.ok ? "still passes" : viaRoot.revert?.name ?? "rejected";
      const bothDead = !viaChain.ok && !viaRoot.ok;
      setOutcome({
        verdict: bothDead ? "pass" : "fail",
        message: bothDead
          ? `both downstream accounts are dead — executor: ${executorReason}, delegate: ${delegateReason}`
          : `unexpected: executor ${executorReason}, delegate ${delegateReason}`,
        txHash: result.txHash,
      });
      onSettled();
    } catch (error) {
      setOutcome({ verdict: "fail", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Revoke">
      <p>
        The voter disables its root delegation at the DelegationManager. The delegate's authority derives from that hash,
        so both the delegate and the executor stop working in the same transaction.
      </p>
      <dl className="kv">
        <dt>root hash</dt>
        <dd>
          <Mono dim>{config.delegations.root.hash}</Mono>
        </dd>
        <dt>state</dt>
        <dd>{rootDisabled ? <span className="tag tag-bad">revoked</span> : <span className="tag tag-ok">active</span>}</dd>
      </dl>
      <div className="actions">
        <Button onClick={() => void revoke()} busy={busy} disabled={!writable || rootDisabled} variant="danger">
          revoke root delegation
        </Button>
        {rootDisabled ? <span className="muted">already revoked — re-sign with `bun run phase3:delegate`</span> : null}
      </div>
      {outcome ? (
        <Status verdict={outcome.verdict}>
          {outcome.message}
          {outcome.txHash ? (
            <>
              {" · "}
              <TxLink hash={outcome.txHash} />
            </>
          ) : null}
        </Status>
      ) : null}
    </Panel>
  );
}
