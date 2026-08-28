import { useState } from "react";
import type { PublicClient } from "viem";

import { signDelegation } from "../lib/demo-actions";
import type { DemoConfig, Role } from "../lib/demo-config";
import { candidatesFor, upstreamOf, ROLE_CLASS, ROLE_LABELS, type Grant } from "../lib/grants";
import type { EdgeState } from "../lib/graph";
import { AddressLink, Button, Field, Panel, Status, type Verdict } from "./primitives";

/**
 * Who delegated what to whom — and where a new delegation is signed.
 *
 * Signing sends nothing to the chain: a delegation is a signed object that only reaches
 * the DelegationManager when the delegate redeems it.
 */
export function ChainPanel({
  config,
  client,
  writable,
  role,
  edges,
  grants,
  onSigned,
}: {
  config: DemoConfig;
  client: PublicClient;
  writable: boolean;
  edges: EdgeState[];
  /** Who the viewer is acting as — they can only delegate their own vote. */
  role: Role;
  /** Every delegation signed so far, revoked ones included. */
  grants: Grant[];
  onSigned: (grant: Grant) => void;
}) {
  const [domain, setDomain] = useState(config.nodes[0]?.label ?? "");
  const [to, setTo] = useState<Role | null>(null);
  const [outcome, setOutcome] = useState<{ verdict: Verdict; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Both questions are per domain: granting `design` away says nothing about `legal`.
  const blocked = upstreamOf(config, edges, grants, role, domain);
  const candidates = candidatesFor(config, edges, grants, role, domain);
  const target = to && candidates.includes(to) ? to : (candidates[0] ?? null);

  async function grant(): Promise<void> {
    if (!target) return;
    setBusy(true);
    setOutcome(null);
    try {
      const signed = await signDelegation(client, config, role, target, domain);
      onSigned({ from: role, to: target, scope: domain, revoked: false, delegation: signed });
      setOutcome({
        verdict: "pass",
        text: `${ROLE_LABELS[role]} delegated “${domain}” to ${ROLE_LABELS[target]} — signed, nothing sent to the chain`,
      });
    } catch (error) {
      setOutcome({ verdict: "fail", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <ol className="levels">
        {grants.map((entry) => (
          <li key={entry.delegation.hash} className={entry.revoked ? "level level-dead" : "level"}>
            <div className="level-head">
              <h3>
                <span className={`role-badge ${ROLE_CLASS[entry.from]}`}>{ROLE_LABELS[entry.from]}</span>{" "}
                <span className="muted">delegates to</span>{" "}
                <span className={`role-badge ${ROLE_CLASS[entry.to]}`}>{ROLE_LABELS[entry.to]}</span>
              </h3>
              <span className={entry.revoked ? "tag tag-bad" : "tag tag-ok"}>
                {entry.revoked ? "revoked" : "active"}
              </span>
            </div>
            <p className="level-scope">
              can vote on <strong>{entry.scope}</strong>
            </p>
            <p className="muted">
              <AddressLink address={config.accounts[entry.from].smartAccount} /> →{" "}
              <AddressLink address={config.accounts[entry.to].smartAccount} />
            </p>
          </li>
        ))}
      </ol>

      <h4 className="section-label">delegate your vote</h4>
      {candidates.length === 0 ? (
        <p className="note">
          On “{domain}”, everyone else already delegates to you. Delegating back would send the weight in a circle —
          pick another domain.
        </p>
      ) : (
        <>
          <div className="form-row">
            <Field label="to">
              {/* Safe: options are Role members, filtered by candidatesFor. */}
              <select value={target ?? ""} onChange={(event) => setTo(event.target.value as Role)}>
                {candidates.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {ROLE_LABELS[candidate]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="on">
              <select value={domain} onChange={(event) => setDomain(event.target.value)}>
                {config.nodes.map((node) => (
                  <option key={node.termId} value={node.label}>
                    {node.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {blocked.size > 0 ? (
            <p className="muted note-inline">
              On “{domain}”, {[...blocked].map((entry) => ROLE_LABELS[entry]).join(" and ")} already delegate
              {blocked.size > 1 ? "" : "s"} to you, so they are not offered.
            </p>
          ) : null}
          <div className="actions">
            <Button onClick={() => void grant()} busy={busy} disabled={!writable} variant="primary">
              sign delegation
            </Button>
            {!writable ? <span className="muted">read-only build</span> : null}
          </div>
          {outcome ? <Status verdict={outcome.verdict}>{outcome.text}</Status> : null}
        </>
      )}
    </Panel>
  );
}
