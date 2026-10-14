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
}: {
  address: `0x${string}` | null;
  connecting: boolean;
  onConnect: () => void;
}) {
  if (!hasWallet()) return null;

  if (address) {
    return (
      <a
        className="wallet wallet-on"
        href={addressUrl(address)}
        target="_blank"
        rel="noreferrer"
        title={`${address} — opens the explorer. Disconnecting is done in the wallet itself.`}
      >
        <span className="wallet-dot" aria-hidden="true" />
        <span className="wallet-address">{shortHex(address, 6, 4)}</span>
      </a>
    );
  }

  return (
    <button type="button" className="wallet" onClick={onConnect} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
