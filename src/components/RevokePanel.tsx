import { useState } from "react";
import type { PublicClient } from "viem";

import type { DelegationSet } from "../lib/delegation/delegation-set";
import type { AppConfig } from "../lib/config/app-config";
import type { DomainGraph } from "../lib/graph/domain-graph";
import { ROLE_LABELS, ROLES } from "../lib/delegation/grant";
import { planVoteForcingWitness, preflightVote, revokeRoot, VOTE_FOR } from "../lib/actions";
import { Button, Mono, Panel, Status, TxLink, type Verdict } from "./primitives";

interface Outcome {
  verdict: Verdict;
  message: string;
  txHash?: `0x${string}`;
}

/**
 * Revocation is framework-native: the voter calls `disableDelegation` and the
 * DelegationManager refuses every chain whose authority derives from that hash. We wrote
 * no code for it — this panel proves it by re-simulating each chain afterwards.
 *
 * What dies is what was borrowed. A delegation relaying the voter's voice is chained to
 * this hash and goes with it; one an account signed on its own authority is untouched, so
 * the delegate keeps handing on its own vote. Taking a voice back is not a mute button.
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
  config: AppConfig;
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
          ? `every chain relaying this voice is dead — ${detail}`
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
        The voter disables its root delegation at the DelegationManager. Every delegation relaying that voice derives
        from this hash, so all of them stop in the same transaction — and any grant an account signed on its own
        authority keeps standing. You take back what you lent, not what others gave.
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
        {rootDisabled ? <span className="muted">already revoked — re-sign with `bun run delegate`</span> : null}
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
