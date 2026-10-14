/**
 * Three wallets of one's own, and the thirty seconds it takes to make them.
 *
 * The demo used to need owner keys from a gitignored file, which meant it only ever ran
 * on the machine that generated them. Anywhere else it opened read-only, and the one
 * thing a visitor wants to do — hand a domain over and watch somebody else vote with it —
 * was the one thing they could not.
 *
 * The wait is shown rather than hidden. Thirteen operations go by with their costs and
 * their hashes, and by the time the button finishes a reader has seen accounts deployed,
 * funded, given tokens and self-delegated. That is a better explanation of the stack than
 * any paragraph, and it costs nothing but the time that was being spent anyway.
 */
import type { Role } from "../lib/config/app-config";
import { ROLE_CLASS, ROLES } from "../lib/delegation/grant";
import type { Session } from "../lib/chain/session";
import { AddressLink } from "./primitives";

export function SessionGate({
  session,
  bootstrapping,
  error,
  canStart,
  writable,
  onStart,
  onEnd,
}: {
  session: Session | null;
  bootstrapping: { stage: string; done: number; total: number } | null;
  error: string | null;
  canStart: boolean;
  /** Whether the app can already write with the identities it has. */
  writable: boolean;
  onStart: () => void;
  onEnd: () => void;
}) {
  if (bootstrapping) {
    const percent = Math.round((bootstrapping.done / bootstrapping.total) * 100);
    return (
      <section className="gate gate-busy" aria-live="polite">
        <div className="gate-progress">
          <div className="gate-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="gate-busy-text">
          <strong>{bootstrapping.stage}</strong>
          <span className="gate-step">
            step {bootstrapping.done} of {bootstrapping.total}
          </span>
        </div>
        <p className="gate-hint">
          Three accounts are being deployed, funded, given tokens and self-delegated. Open the transaction log
          at the foot of the page to watch each one land.
        </p>
      </section>
    );
  }

  if (session) {
    return (
      <section className="gate gate-live">
        <span className="gate-badge">your session</span>
        <span className="gate-accounts">
          {ROLES.map((role: Role) => (
            <span key={role} className="gate-account">
              <span className={`gate-who ${ROLE_CLASS[role]}`}>{role}</span>
              <AddressLink address={session.accounts[role]} />
            </span>
          ))}
        </span>
        <button type="button" className="gate-end" onClick={onEnd}>
          Forget these wallets
        </button>
      </section>
    );
  }

  // Nothing to offer, and nothing already working: say which it is.
  if (!canStart) {
    return writable ? null : (
      <section className="gate gate-shut">
        <strong>Read-only.</strong>{" "}
        <span>
          This build has no way to pay for a session — no local key, and no faucet configured. Everything on
          chain is still readable: the graph, the delegations, every vote and who carried it.
        </span>
      </section>
    );
  }

  return (
    <section className="gate gate-offer">
      <div className="gate-offer-text">
        <strong>Try it with wallets of your own.</strong>
        <p>
          Three accounts, generated in this browser and funded for you. About thirty seconds, and every step
          of it shows in the transaction log. {writable ? "The accounts already loaded stay where they are." : ""}
        </p>
      </div>
      <button type="button" className="gate-start" onClick={onStart}>
        Create three wallets
      </button>
      {error ? <p className="gate-error">{error}</p> : null}
    </section>
  );
}
