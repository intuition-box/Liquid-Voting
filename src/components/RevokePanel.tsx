import { useState } from "react";
import type { PublicClient } from "viem";

import type { DelegationSet } from "../lib/delegation/delegation-set";
import type { AppConfig } from "../lib/config/app-config";
import type { DomainGraph } from "../lib/graph/domain-graph";
import { ROLES } from "../lib/delegation/grant";
import { planVoteForcingWitness, preflightVote, revokeRoot, VOTE_FOR } from "../lib/actions";
import { Button, Panel, Status, TxLink, type Verdict } from "./primitives";

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
        setOutcome({ verdict: "fail", message: "the transaction did not go through", txHash: result.txHash });
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
          return { holder, ok: outcome.ok };
        }),
      );
      // Every account that was passing this voice along should now be refused.
      const stopped = probes.filter((probe) => !probe.ok).map((probe) => probe.holder);
      const stillWorking = probes.filter((probe) => probe.ok).map((probe) => probe.holder);
      setOutcome({
        verdict: stillWorking.length === 0 ? "pass" : "fail",
        message:
          stillWorking.length === 0
            ? stopped.length > 0
              ? `Signature cancelled. ${stopped.join(" and ")} can no longer vote with A’s voice.`
              : "Signature cancelled. It can never be used again."
            : `Unexpected: ${stillWorking.join(" and ")} can still use it.`,
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
    <Panel title="Cancel a signature">
      <p>
        Taking a domain back — in the panel above — stops your weight counting there. This does something
        stronger: it tears up a signature, so it can never be used again by anyone.
      </p>
      <p className="muted">
        A pre-signed delegation from A to B is kept for this. It is not in force — nothing is delegated until
        someone hands a domain over — but cancelling it here shows what happens to everything below: anything
        passing A’s voice along stops working too, while a vote B lent out of its own is untouched. You cancel
        what you lent, not what others gave.
      </p>
      <div className="actions">
        <Button onClick={() => void revoke()} busy={busy} disabled={!writable || rootDisabled} variant="danger">
          {rootDisabled ? "already cancelled" : "cancel A’s signature"}
        </Button>
        {rootDisabled ? (
          <span className="muted">sign a fresh one with `bun run delegate`</span>
        ) : (
          <span className="muted">permanent — this signature can never be reused</span>
        )}
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
