/**
 * Three wallets of one's own, made in the browser.
 *
 * The demo shipped with three accounts whose owner keys live in a gitignored file, which
 * works on the machine that generated them and nowhere else. Hosting it meant either
 * publishing three funded keys — which is what ADR 0011 exists to prevent — or handing
 * every visitor a read-only page. So a visitor gets their own set instead: generated
 * here, kept in this browser, funded once, and never sent anywhere.
 *
 * Four keys, not three. The three role owners control the smart accounts that hold weight
 * and sign delegations; the fourth is the session's submitter, the funded EOA that puts
 * every user operation on chain (ADR 0010). Keeping it separate means the accounts under
 * demonstration never pay for each other, which is the thing the transaction log is
 * meant to make legible.
 *
 * These are burner keys for a testnet, generated fresh and worth nothing. They are kept
 * in `localStorage` so a reload does not strand funded accounts — which also means they
 * are readable by anything that can run script on this origin, and are not to be reused
 * for anything that matters.
 */
import type { Hex, PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { toHybridAccount } from "./smart-accounts";
import { ROLES, type Role } from "../roles";

/** One session's worth of identity. */
export interface Session {
  /** The EOA that submits every user operation and pays for the setup. */
  submitterKey: Hex;
  submitterAddress: `0x${string}`;
  /** Owner key per role, and the HybridDeleGator address it controls. */
  owners: Record<Role, Hex>;
  accounts: Record<Role, `0x${string}`>;
  /** Which governor this session was set up against, so a redeploy invalidates it
   *  rather than leaving accounts pointing at a register that no longer exists. */
  governor: `0x${string}`;
  createdAt: string;
}

const STORAGE_KEY = "liquid-demo.session.v1";

/** Fresh keys. Addresses are not known yet — the smart account ones are derived. */
export function freshKeys(): { submitterKey: Hex; owners: Record<Role, Hex> } {
  const owners = {} as Record<Role, Hex>;
  for (const role of ROLES) owners[role] = generatePrivateKey();
  return { submitterKey: generatePrivateKey(), owners };
}

/**
 * The counterfactual address of each smart account, before any of them is deployed.
 *
 * A HybridDeleGator's address is determined by its owner and its factory, so it can be
 * known — and funded, and delegated to — before there is any code at it. That is what
 * lets the whole set be planned in one pass and deployed in another.
 */
export async function deriveAccounts(
  client: PublicClient,
  owners: Record<Role, Hex>,
): Promise<Record<Role, `0x${string}`>> {
  const accounts = {} as Record<Role, `0x${string}`>;
  for (const role of ROLES) {
    const account = await toHybridAccount(client, privateKeyToAccount(owners[role]));
    accounts[role] = account.address;
  }
  return accounts;
}

/**
 * The session in this browser, if there is one for this governor.
 *
 * A session recorded against an older governor is discarded rather than repaired: its
 * accounts are funded and its delegations may still be signed, but the register they
 * refer to is gone, so every weight it reports would be a fiction.
 */
export function readSession(governor: `0x${string}`): Session | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked site data both throw here. No session is a fine answer.
    return null;
  }
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (!isComplete(session)) return null;
    if (session.governor.toLowerCase() !== governor.toLowerCase()) return null;
    return session;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Not fatal: the session still works for as long as the page stays open. It is worth
    // not failing a funded setup over a storage quota.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — see writeSession.
  }
}

/** Whether a stored object is a session and not something from an older shape. */
function isComplete(session: Session): boolean {
  if (typeof session?.submitterKey !== "string" || typeof session?.governor !== "string") return false;
  return ROLES.every((role) => typeof session.owners?.[role] === "string" && typeof session.accounts?.[role] === "string");
}
