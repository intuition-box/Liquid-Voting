/**
 * Paying for a session with the visitor's own wallet.
 *
 * The alternative was a faucet: an endpoint holding a funded key, rate-limited, capped,
 * and needing to be topped up by somebody. This is better on every axis that matters. No
 * key exists anywhere — not in the bundle, not on a server — so ADR 0011's rule holds by
 * construction rather than by arrangement. There is no infrastructure to run, nothing to
 * refill, and no empty state to explain. And a DAO's engineering team opening a
 * governance demo expects to connect a wallet; being handed tokens says "toy" in a way
 * that is hard to talk your way out of.
 *
 * The visitor signs exactly one transaction. It funds the session's own submitter, and
 * everything after that — three deployments, three top-ups, three operations — is paid
 * for out of it without another prompt. One signature, then watch.
 *
 * The cost is honest: connecting a wallet is a step, and the Intuition Box review asked
 * for none. A visitor with no tTRUST has to visit Intuition's faucet first. Against a
 * funded key that has to live somewhere, that is the better trade.
 */
import { createWalletClient, custom, type Account, type Chain, type Transport, type WalletClient } from "viem";

import { intuitionTestnet } from "./network";

/** The slice of EIP-1193 this needs. Typed here rather than depended on. */
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (payload: unknown) => void): void;
  removeListener?(event: string, handler: (payload: unknown) => void): void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/** Whether this browser has anything to connect to. */
export function hasWallet(): boolean {
  try {
    return typeof window !== "undefined" && window.ethereum !== undefined;
  } catch {
    return false;
  }
}

/** Thrown with a sentence the interface shows as written. */
export class WalletError extends Error {}

/**
 * The wallet this browser already authorised, without prompting for anything.
 *
 * `eth_accounts` answers from what the visitor granted before; `eth_requestAccounts`
 * asks. Reconnecting on load has to use the first, or every reload opens a dialog
 * nobody pressed a button for.
 *
 * It deliberately does not switch the chain either. Nagging about the network before
 * anyone has asked to do anything is the same discourtesy in a different costume — the
 * switch happens when the wallet is actually needed.
 */
export async function restoreWallet(): Promise<WalletClient<Transport, Chain, Account> | null> {
  const provider = window.ethereum;
  if (!provider) return null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
    const address = accounts[0];
    if (!address) return null;
    return createWalletClient({
      chain: intuitionTestnet,
      transport: custom(provider),
      account: address as `0x${string}`,
    });
  } catch {
    return null;
  }
}

/**
 * Calls back when the visitor switches account or disconnects in the wallet itself.
 *
 * Without this the header would go on naming an address that is no longer in charge,
 * which is worse than naming none: the next transaction would come from somewhere the
 * page never mentioned.
 */
export function watchWallet(onAccount: (address: `0x${string}` | null) => void): () => void {
  const provider = window.ethereum;
  if (!provider?.on) return () => {};
  const handler = (accounts: unknown): void => {
    const first = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;
    onAccount((first as `0x${string}`) ?? null);
  };
  provider.on("accountsChanged", handler);
  return () => provider.removeListener?.("accountsChanged", handler);
}

/**
 * Connects, puts the wallet on Intuition testnet, and hands back a client.
 *
 * The chain switch is attempted before the add, because a wallet that already knows the
 * network should not be asked to add it again — and `wallet_addEthereumChain` on a
 * network already present is a prompt the visitor has no way to make sense of.
 */
export async function connectWallet(): Promise<WalletClient<Transport, Chain, Account>> {
  const provider = window.ethereum;
  if (!provider) {
    throw new WalletError(
      "No wallet found in this browser. Install MetaMask, Rabby or another EVM wallet, then try again.",
    );
  }

  const accounts = (await provider.request({ method: "eth_requestAccounts" }).catch((cause: unknown) => {
    throw new WalletError(rejected(cause) ? "The connection was declined." : describe(cause));
  })) as string[];
  const address = accounts[0];
  if (!address) throw new WalletError("The wallet connected but offered no account.");

  return createWalletClient({
    chain: intuitionTestnet,
    transport: custom(provider),
    account: address as `0x${string}`,
  });
}

/**
 * Puts the already-connected wallet on 13579, for the moment it is actually needed.
 *
 * Separate from connecting, because those are now two moments: the header connects, and
 * the chain only has to be right when something is about to be sent. Asking somebody to
 * switch network before they have asked to do anything is a prompt they cannot place.
 */
export async function ensureWalletChain(): Promise<void> {
  const provider = window.ethereum;
  if (!provider) throw new WalletError("The wallet went away. Reconnect and try again.");
  await ensureChain(provider);
}

/** Puts the wallet on 13579, adding the network if it does not know it. */
async function ensureChain(provider: Eip1193Provider): Promise<void> {
  const chainId = `0x${intuitionTestnet.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return;
  } catch (cause) {
    // 4902 is "unrecognised chain", which is the one case worth recovering from. A
    // decline is a decline.
    if (rejected(cause)) throw new WalletError("The network switch was declined.");
    if (!unrecognised(cause)) throw new WalletError(describe(cause));
  }

  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: intuitionTestnet.name,
          nativeCurrency: intuitionTestnet.nativeCurrency,
          rpcUrls: [...intuitionTestnet.rpcUrls.default.http],
          blockExplorerUrls: [intuitionTestnet.blockExplorers.default.url],
        },
      ],
    });
  } catch (cause) {
    throw new WalletError(
      rejected(cause)
        ? "Adding Intuition testnet was declined. The demo needs it to read anything."
        : describe(cause),
    );
  }
}

/** EIP-1193's "user rejected" code, and the shape wallets actually send it in. */
function rejected(cause: unknown): boolean {
  return code(cause) === 4001;
}

function unrecognised(cause: unknown): boolean {
  // 4902 is the standard; MetaMask has also been seen to nest -32603 around it.
  return code(cause) === 4902 || describe(cause).includes("Unrecognized chain");
}

function code(cause: unknown): number | undefined {
  const value = (cause as { code?: unknown })?.code;
  return typeof value === "number" ? value : undefined;
}

function describe(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String((cause as { message: unknown }).message).split("\n")[0] ?? "the wallet refused";
  }
  return String(cause);
}
