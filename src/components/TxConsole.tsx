/**
 * The transcript at the foot of the page: every signature, operation and transaction the
 * demo produced, in order, with what it cost and where to check it.
 *
 * Without it the app is numbers changing for no visible reason. Everything of consequence
 * here goes through a self-bundled user operation, which from the outside is one opaque
 * `EntryPoint.handleOps` call — so the interesting part, the delegation being redeemed and
 * the caveat rechecking the graph, left no trace a reader could follow. The machinery is
 * the product; this is where it shows its work.
 *
 * Collapsed to a single line by default, because the page is about governance and not
 * about plumbing. Open it and the plumbing is all there.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { txUrl, addressUrl, shortHex } from "../lib/chain/network";
import { clearLog, readLog, subscribeLog, type LogCall, type LogKind, type LogStep } from "../lib/chain/tx-log";
import { ROLE_CLASS, ROLES, type Role } from "../lib/delegation/grant";

/** How each kind is named in the bar, and what it is worth knowing about it. */
const KINDS: Record<LogKind, { badge: string; title: string }> = {
  signature: { badge: "signed", title: "An EIP-712 signature. Free, and nothing was sent to the chain." },
  userop: { badge: "user op", title: "A self-bundled ERC-4337 operation: the smart account signed it, a funded EOA submitted it." },
  tx: { badge: "tx", title: "A plain transaction, sent by an EOA in its own name." },
  local: { badge: "local", title: "Computed in the browser. Nothing left it." },
};

export function TxConsole() {
  const steps = useSyncExternalStore(subscribeLog, readLog, readLog);
  const [open, setOpen] = useState(false);
  const [seenFailures, setSeenFailures] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const tail = useRef<HTMLDivElement | null>(null);

  const pending = steps.filter((step) => step.status === "pending").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const latest = steps[steps.length - 1];

  // Follow the transcript while it is open, so a run of steps does not scroll away
  // unwatched. Only on a new step, so expanding a row does not yank the view.
  useEffect(() => {
    if (open) tail.current?.scrollIntoView({ block: "end" });
  }, [open, steps.length]);

  // Errors live here now rather than in a banner across the page, so the panel has to
  // announce itself when one arrives — otherwise moving them out of the way would have
  // moved them out of sight.
  useEffect(() => {
    if (failed > seenFailures) {
      setOpen(true);
      setSeenFailures(failed);
    } else if (failed < seenFailures) {
      // The log was cleared; forget what we had already shown for.
      setSeenFailures(failed);
    }
  }, [failed, seenFailures]);

  const toggle = (id: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className={open ? "console console-open" : "console"} aria-label="transaction log">
      <button
        type="button"
        className="console-bar"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="console-body"
      >
        <span className="console-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="console-title">Transaction log</span>
        <span className="console-count">
          {steps.length === 0 ? "nothing yet" : `${steps.length} step${steps.length === 1 ? "" : "s"}`}
        </span>
        {pending > 0 ? <span className="console-live">{pending} in flight</span> : null}
        {failed > 0 ? <span className="console-failed">{failed} failed</span> : null}
        {/* Collapsed, the bar still says what just happened — which is most of the value
            for a reader who is not here to audit, only to follow. */}
        {!open && latest ? <span className="console-latest">{latest.label}</span> : null}
      </button>

      {open ? (
        <div className="console-body" id="console-body">
          {steps.length === 0 ? (
            <p className="console-empty">
              Delegate a domain, add a sub-domain or cast a vote, and every signature and transaction it takes
              appears here with its cost and a link to the explorer.
            </p>
          ) : (
            <ol className="console-list">
              {steps.map((step) => (
                <Row key={step.id} step={step} open={expanded.has(step.id)} onToggle={() => toggle(step.id)} />
              ))}
            </ol>
          )}
          <div ref={tail} />
          {steps.length > 0 ? (
            <div className="console-foot">
              <button type="button" className="console-clear" onClick={clearLog}>
                Clear the log
              </button>
              <span className="console-note">
                Clearing empties this panel only. Nothing on chain is undone — that is rather the point of it
                being on chain.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}

function Row({ step, open, onToggle }: { step: LogStep; open: boolean; onToggle: () => void }) {
  const kind = KINDS[step.kind];
  const role = ROLES.includes(step.actor as Role) ? (step.actor as Role) : null;
  const detailed = step.calls.length > 0 || step.detail !== undefined;

  return (
    <li className={`console-row console-row-${step.status}`}>
      <div className="console-head">
        <span className={`console-dot console-dot-${step.status}`} aria-hidden="true" />

        {detailed ? (
          <button
            type="button"
            className="console-toggle"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} the detail of: ${step.label}`}
          >
            {open ? "–" : "+"}
          </button>
        ) : (
          <span className="console-toggle console-toggle-off" aria-hidden="true" />
        )}

        <span className="console-kind" title={kind.title}>
          {kind.badge}
        </span>

        {step.actor ? (
          <span className={`console-actor ${role ? ROLE_CLASS[role] : ""}`}>
            {role ?? shortHex(step.actor)}
          </span>
        ) : null}

        <span className="console-label">{step.label}</span>

        <span className="console-meta">
          {step.status === "pending" ? <span className="console-waiting">waiting for the chain…</span> : null}
          {step.gasUsed !== undefined ? <span>{formatGas(step.gasUsed)} gas</span> : null}
          {step.cost !== undefined ? <span>{formatCost(step.cost)}</span> : null}
          {step.kind === "signature" ? <span className="console-free">no gas</span> : null}
          {step.took !== undefined && step.kind !== "signature" ? <span>{formatTook(step.took)}</span> : null}
          {/* The link appears only once there is a hash to link to, which is the moment
              the transaction actually landed. */}
          {step.hash ? (
            <a className="console-link" href={txUrl(step.hash)} target="_blank" rel="noreferrer">
              {shortHex(step.hash)} ↗
            </a>
          ) : null}
        </span>
      </div>

      {step.error ? <p className="console-error">{step.error}</p> : null}

      {open ? (
        <div className="console-detail">
          {step.detail ? <p className="console-why">{step.detail}</p> : null}
          {step.calls.map((call, index) => (
            <Call key={`${step.id}-${index}`} call={call} />
          ))}
          {step.block !== undefined ? (
            <p className="console-block">block {step.block.toString()}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Call({ call }: { call: LogCall }) {
  return (
    <div className="console-call">
      <p className="console-callsig">
        {call.address ? (
          <a className="console-contract" href={addressUrl(call.address)} target="_blank" rel="noreferrer">
            {call.contract}
          </a>
        ) : (
          <span className="console-contract">{call.contract}</span>
        )}
        <span className="console-fn">.{call.fn}</span>
        {call.value !== undefined && call.value > 0n ? (
          <span className="console-value">{formatCost(call.value)}</span>
        ) : null}
      </p>
      {call.args ? (
        <dl className="console-args">
          {Object.entries(call.args).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function formatGas(gas: bigint): string {
  return gas >= 1000n ? `${(Number(gas) / 1000).toFixed(1)}k` : gas.toString();
}

/**
 * Wei as tTRUST, to four decimals.
 *
 * Gas here costs small fractions of a token, and the point of showing it is that the
 * whole demo runs on almost nothing — so it is rounded to something a reader can hold in
 * their head rather than printed to the wei.
 */
function formatCost(wei: bigint): string {
  const tTRUST = Number(wei) / 1e18;
  if (tTRUST === 0) return "0 tTRUST";
  if (tTRUST < 0.0001) return "<0.0001 tTRUST";
  return `${tTRUST.toFixed(4)} tTRUST`;
}

function formatTook(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
