/**
 * The line saying these wallets are yours, docked with the transaction log.
 *
 * It sat between the identity cards and the workspace, where it pushed into the domain
 * tree and the proposals table and belonged to neither. It is not about governance at
 * all — it is about the machinery underneath, which is exactly what the transaction log
 * is about, so the two share a footing now.
 *
 * Deliberately says nothing the cards above already say. The addresses are up there, one
 * per identity, beside what each of them is doing with them.
 */
import { addressUrl } from "../lib/chain/network";
import type { Session } from "../lib/chain/session";

export function SessionStrip({ session, onForget }: { session: Session; onForget: () => void }) {
  return (
    <div className="session-strip">
      <span className="session-badge">your session</span>
      <span className="session-note">
        Three wallets made in this browser, funded by{" "}
        <a href={addressUrl(session.submitterAddress)} target="_blank" rel="noreferrer">
          a submitter
        </a>{" "}
        that pays for everything they do.
      </span>
      <button type="button" className="session-forget" onClick={onForget}>
        Forget these wallets
      </button>
    </div>
  );
}
