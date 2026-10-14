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
import type { Session } from "../lib/chain/session";

export function SessionGate({
  session,
  bootstrapping,
  error,
  canStart,
  writable,
  onStart,
}: {
  session: Session | null;
  bootstrapping: { stage: string; done: number; total: number } | null;
  error: string | null;
  canStart: boolean;
  /** Whether the app can already write with the identities it has. */
  writable: boolean;
  onStart: () => void;
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

  // A live session is described by the identity cards, which say what each wallet is
  // doing as well as what it is called. Repeating the addresses here was the third place
  // the same three accounts appeared.
  if (session) return null;

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
