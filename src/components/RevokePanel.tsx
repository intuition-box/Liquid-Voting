import { useState } from "react";
import type { PublicClient } from "viem";

import type { DelegationSet } from "../lib/delegation-set";
import type { DemoConfig } from "../lib/demo-config";
import type { DomainGraph } from "../lib/domain-graph";
import { ROLE_LABELS, ROLES } from "../lib/grants";
import { planVoteForcingWitness, preflightVote, revokeRoot, VOTE_FOR } from "../lib/demo-actions";
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
  graph,
  delegations,
  domain,
  writable,
  rootDisabled,
  onSettled,
}: {
  config: DemoConfig;
  client: PublicClient;
  graph: DomainGraph;
  delegations: DelegationSet;
  /** The domain in scope — where the probes look for a chain to re-simulate. */
  domain: string;
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
      // Re-simulate every account that held a chain, on the domain it actually held —
      // the probes follow the grants rather than two domain names written in here.
      // The manager rejects a disabled delegation before any caveat runs, so no real
      // proposal is needed: any id reaches the check that matters.
      const downstream = ROLES.flatMap((holder) => {
        const scope = delegations.chainFor(holder, domain)?.voices[0]?.scopes[0];
        return scope ? [{ holder, scope }] : [];
      });
      const probes = await Promise.all(
        downstream.map(async ({ holder, scope }) => {
          const resolved = delegations.chainFor(holder, scope);
          if (!resolved) return { holder, ok: true, reason: "no chain left" };
          const outcome = await preflightVote(
            client,
            config,
            planVoteForcingWitness(config, graph, resolved, scope, 0n, VOTE_FOR),
          );
          return { holder, ok: outcome.ok, reason: outcome.ok ? "still passes" : outcome.revert?.name ?? "rejected" };
        }),
      );
      const allDead = probes.every((probe) => !probe.ok);
      const detail = probes.map((probe) => `${ROLE_LABELS[probe.holder]}: ${probe.reason}`).join(", ");
      setOutcome({
        verdict: allDead ? "pass" : "fail",
        message: allDead
          ? `every downstream account is dead — ${detail}`
          : `unexpected — ${detail}`,
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
