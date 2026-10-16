import { useState } from "react";
import type { PublicClient } from "viem";

import { DEFAULT_MAX_DEPTH, revokeWeight, signDelegation } from "../lib/actions";
import type { AppConfig, Role } from "../lib/config/app-config";
import type { DelegationSet } from "../lib/delegation/delegation-set";
import { ROLE_CLASS, ROLES, type Grant } from "../lib/delegation/grant";
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
  delegations,
  writable,
  role,
  domain,
  onSigned,
  onRevoked,
}: {
  config: AppConfig;
  client: PublicClient;
  /** The grants in force — who may still receive this domain, and who holds it. */
  delegations: DelegationSet;
  writable: boolean;
  /** Who the viewer is acting as — they can only delegate their own vote. */
  role: Role;
  /** The domain picked in the rail — what this grant would cover. */
  domain: string;
  onSigned: (grant: Grant) => void;
  onRevoked: (from: Role, domain: string) => void;
}) {
  const [to, setTo] = useState<Role | null>(null);
  const [depth, setDepth] = useState(DEFAULT_MAX_DEPTH);
  const [outcome, setOutcome] = useState<{ verdict: Verdict; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Both questions are per domain: granting `design` away says nothing about `legal`.
  const blocked = delegations.upstreamOf(role, domain);
  const candidates = delegations.candidatesFor(role, domain);
  const target = to && candidates.includes(to) ? to : (candidates[0] ?? null);

  const yours = delegations.grantedAway(role, domain);
  // Who *this* account handed the domain to. It used to be the first live grant on the
  // domain from anyone at all, and `grants` holds everybody's: with B lending `grants` to
  // C, A's own panel ticked C as holding it and told A to take back something A never
  // gave. The question the panel asks is "who did you give this to", so the answer comes
  // from this account's grant or not at all.
  const held = yours?.to;
  // Granting a parent gives its children away with it, so a domain under one you already
  // delegated cannot be granted again — the parent has to come back first.
  const coveredBy = delegations.coveredBy(role, domain);

  // A domain has one holder at a time, so while yours stands the only move is to revoke.
  const locked = yours !== null || coveredBy !== null;

  /**
   * Takes a domain back, whether it is the one selected or the parent that carries it.
   *
   * One function for both, because the two differ only in which scope they name: the
   * button under a covered domain revokes the parent that holds it, since that is what
   * has to come back first.
   */
  async function revoke(scope: string): Promise<void> {
    setBusy(true);
    setOutcome(null);
    try {
      // Every grant the signer made on that domain goes with the weight — its own voice
      // and any it was relaying — so nothing is left signed but unusable.
      const signed = delegations
        .all()
        .filter((grant) => !grant.revoked && grant.from === role && grant.scope === scope)
        .map((grant) => grant.delegation);
      const result = await revokeWeight(client, config, role, scope, signed);
      if (!result.success) throw new Error(result.revert?.formatted ?? "the revocation reverted");
      onRevoked(role, scope);
      setOutcome({ verdict: "pass", text: `you took “${scope}” back` });
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
      // One delegation per voice the signer carries: its own, plus one relaying each
      // voice lent to it. They are signed together and stand apart afterwards.
      const held = delegations.chainFor(role, domain);
      const signed = await signDelegation(
        client,
        config,
        role,
        target,
        domain,
        held?.voices.map((voice) => voice.chain[0]!) ?? [],
        depth,
      );
      // Whose voice each one carries is read from what it relays, not from position:
      // signDelegation only relays the grants it may chain to, so an index into the
      // voices we passed in would not line up with what came back.
      const principalOf = new Map(
        (held?.voices ?? []).map((voice) => [voice.chain[0]!.hash.toLowerCase(), voice.principal]),
      );
      signed.forEach(({ delegation, relays }) => {
        onSigned({
          from: role,
          to: target,
          principal: relays ? principalOf.get(relays.hash.toLowerCase()) ?? role : role,
          scope: domain,
          revoked: false,
          delegation,
        });
      });
      setOutcome({ verdict: "pass", text: `${role} handed “${domain}” to ${target}` });
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
                <span className="holder-badge">{candidate}</span>
                <span className="holder-note">{note}</span>
                {held === candidate ? <span className="holder-check">✓</span> : null}
              </button>
            </li>
          );
        })}
      </ul>


      {!coveredBy && !locked ? (
        <label className="depth">
          <span className="depth-label">how deep it reaches</span>
          <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level === 0 ? `“${domain}” only` : `${level} level${level > 1 ? "s" : ""} below`}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="actions">
        {coveredBy ? (
          <Button onClick={() => void revoke(coveredBy.scope)} busy={busy} disabled={!writable} variant="danger">
            take “{coveredBy.scope}” back
          </Button>
        ) : locked ? (
          <Button onClick={() => void revoke(domain)} busy={busy} disabled={!writable} variant="danger">
            take “{domain}” back
          </Button>
        ) : (
          <Button onClick={() => void grant()} busy={busy} disabled={!writable || !target} variant="primary">
            {target ? `hand it to ${target}` : "no one available"}
          </Button>
        )}
      </div>

      {coveredBy ? (
        <p className="muted">
          “{domain}” already went to {coveredBy.to} with “{coveredBy.scope}”. Take the parent back to
          split it out.
        </p>
      ) : yours ? (
        <p className="muted">
          “{domain}” is with {yours.to}. Take it back before handing it to anyone else.
        </p>
      ) : null}
      {!writable ? <p className="muted">read-only build</p> : null}
      {outcome ? <Status verdict={outcome.verdict}>{outcome.text}</Status> : null}
    </Panel>
  );
}
