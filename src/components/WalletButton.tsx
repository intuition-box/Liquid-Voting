/**
 * The connected wallet, at the end of the navigation.
 *
 * It was buried inside "create three wallets" before, so the connection existed for an
 * instant and was never visible afterwards — you could not tell which account was about
 * to be asked to pay, or whether you were connected at all. That is the one piece of
 * state a dapp is expected to show, and the convention is not arbitrary: the account
 * that signs is the account that spends.
 *
 * It lives in the nav because the nav is pinned, so it stays on screen while you scroll
 * through proposals — which is exactly when you want to know whose wallet is in play.
 *
 * Disconnecting is best-effort by nature: EIP-1193 has no hang-up, so the page asks the
 * wallet to revoke its permission and forgets the connection either way. The session's
 * three accounts are untouched — they were funded by this wallet but they are not it.
 *
 * Renders nothing when the browser has no wallet at all. There is no honest button to
 * show somebody with nothing to connect, and a development build does not need one: it
 * pays from its own key.
 */
import { addressUrl, shortHex } from "../lib/chain/network";
import { hasWallet } from "../lib/chain/wallet";

export function WalletButton({
  address,
  connecting,
  onConnect,
  onDisconnect,
}: {
  address: `0x${string}` | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (!hasWallet()) return null;

  if (address) {
    // Two controls in one chip rather than one doing both: the address opens the
    // explorer, the cross disconnects. An anchor with a button inside it would be the
    // same nesting mistake the identity cards had to avoid.
    return (
      <span className="wallet wallet-on">
        <span className="wallet-dot" aria-hidden="true" />
        <a className="wallet-address" href={addressUrl(address)} target="_blank" rel="noreferrer" title={address}>
          {shortHex(address, 6, 4)}
        </a>
        <button
          type="button"
          className="wallet-off"
          onClick={onDisconnect}
          title="Disconnect this wallet"
          aria-label="Disconnect this wallet"
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <button type="button" className="wallet" onClick={onConnect} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
