import { useState } from "react";
import type { PublicClient } from "viem";

import { revokeWeight, signDelegation } from "../lib/demo-actions";
import type { DemoConfig, Role } from "../lib/demo-config";
import type { DelegationSet } from "../lib/delegation-set";
import type { DomainGraph } from "../lib/domain-graph";
import { ROLE_CLASS, ROLE_LABELS, ROLES, type Grant } from "../lib/grants";
import { Button, Panel, Status, type Verdict } from "./primitives";

/**
 * Delegating a vote: pick a domain in the tree, pick who gets it, sign.
 *
 * The tree carries a badge on every domain already handed to someone, so the grants in
 * force are visible where the choice is made rather than listed apart from it.
 */
export function ChainPanel({
  config,
  client,
  graph,
  delegations,
  writable,
  role,
  grants,
  domain,
  onSigned,
  onRevoked,
}: {
  config: DemoConfig;
  client: PublicClient;
  graph: DomainGraph;
  /** The grants in force — who may still receive this domain, and who holds it. */
  delegations: DelegationSet;
  writable: boolean;
  /** Who the viewer is acting as — they can only delegate their own vote. */
  role: Role;
  /** Every delegation signed so far, revoked ones included. */
  grants: Grant[];
  /** The domain picked in the rail — what this grant would cover. */
  domain: string;
  onSigned: (grant: Grant) => void;
  onRevoked: (domain: string) => void;
}) {
  const [to, setTo] = useState<Role | null>(null);
  const [outcome, setOutcome] = useState<{ verdict: Verdict; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Both questions are per domain: granting `design` away says nothing about `legal`.
  const blocked = delegations.upstreamOf(role, domain);
  const candidates = delegations.candidatesFor(role, domain);
  const target = to && candidates.includes(to) ? to : (candidates[0] ?? null);

  const held = grants.find((grant) => !grant.revoked && grant.scope === domain)?.to;
  const yours = delegations.grantedAway(role, domain);
  // Granting a parent gives its children away with it, so a domain under one you already
  // delegated cannot be granted again — the parent has to come back first.
  const coveredBy = delegations.coveredBy(role, domain);

  // A domain has one holder at a time, so while yours stands the only move is to revoke.
  const locked = yours !== null || coveredBy !== null;

  async function revokeParent(): Promise<void> {
    if (!coveredBy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await revokeWeight(client, config, role, coveredBy.scope);
      if (!result.success) throw new Error(result.revert?.formatted ?? "the revocation reverted");
      onRevoked(coveredBy.scope);
      setOutcome({ verdict: "pass", text: `you took “${coveredBy.scope}” back` });
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await revokeWeight(client, config, role, domain);
      if (!result.success) throw new Error(result.revert?.formatted ?? "the revocation reverted");
      onRevoked(domain);
      setOutcome({ verdict: "pass", text: `you took “${domain}” back` });
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function grant(): Promise<void> {
    if (!target) return;
    setBusy(true);
    setOutcome(null);
    try {
      const signed = await signDelegation(
        client,
        config,
        role,
        target,
        domain,
        graph.domainPathOf(domain),
      );
      onSigned({ from: role, to: target, scope: domain, revoked: false, delegation: signed });
      setOutcome({ verdict: "pass", text: `${ROLE_LABELS[role]} handed “${domain}” to ${ROLE_LABELS[target]}` });
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h4>hand “{domain}” to</h4>
      <ul className="holders">
        {ROLES.map((candidate) => {
          const self = candidate === role;
          const unavailable = self || blocked.has(candidate);
          const chosen = candidate === target && !unavailable;
          const note = coveredBy
            ? candidate === coveredBy.to
              ? `holds it, through “${coveredBy.scope}”`
              : "not yours to give"
            : locked
            ? held === candidate
              ? "holds it now"
              : "take it back first"
            : self
            ? "that is you"
            : blocked.has(candidate)
              ? "already gives you this domain"
              : held === candidate
                ? "holds it now"
                : "can take it";
          return (
            <li key={candidate}>
              <button
                type="button"
                disabled={unavailable || locked}
                aria-pressed={chosen}
                className={["holder", ROLE_CLASS[candidate], chosen ? "holder-on" : "", unavailable ? "holder-off" : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setTo(candidate)}
              >
                <span className="holder-badge">{ROLE_LABELS[candidate]}</span>
                <span className="holder-note">{note}</span>
                {held === candidate ? <span className="holder-check">✓</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="actions">
        {coveredBy ? (
          <Button onClick={() => void revokeParent()} busy={busy} disabled={!writable} variant="danger">
            take “{coveredBy.scope}” back
          </Button>
        ) : locked ? (
          <Button onClick={() => void revoke()} busy={busy} disabled={!writable} variant="danger">
            take “{domain}” back
          </Button>
        ) : (
          <Button onClick={() => void grant()} busy={busy} disabled={!writable || !target} variant="primary">
            {target ? `hand it to ${ROLE_LABELS[target]}` : "no one available"}
          </Button>
        )}
      </div>

      {coveredBy ? (
        <p className="muted">
          “{domain}” already went to {ROLE_LABELS[coveredBy.to]} with “{coveredBy.scope}”. Take the parent back to
          split it out.
        </p>
      ) : yours ? (
        <p className="muted">
          “{domain}” is with {ROLE_LABELS[yours.to]}. Take it back before handing it to anyone else.
        </p>
      ) : null}
      {!writable ? <p className="muted">read-only build</p> : null}
      {outcome ? <Status verdict={outcome.verdict}>{outcome.text}</Status> : null}
    </Panel>
  );
}
