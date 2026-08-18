import type { ReactNode } from "react";

import { addressUrl, shortHex, txUrl } from "../lib/chain";

export function Panel({ index, title, subtitle, children }: { index: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="panel-index">{index}</span>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
        </div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Mono({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <span className={dim ? "mono dim" : "mono"}>{children}</span>;
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a className="mono link" href={addressUrl(address)} target="_blank" rel="noreferrer" title={address}>
      {label ?? shortHex(address)}
    </a>
  );
}

export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a className="mono link" href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
      {label ?? shortHex(hash, 10, 6)}
    </a>
  );
}

export type Verdict = "pass" | "fail";

export function Status({ verdict, children }: { verdict: Verdict; children: ReactNode }) {
  return (
    <p className={`status status-${verdict}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {children}
    </p>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Button({
  onClick,
  disabled,
  busy,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "danger";
  children: ReactNode;
}) {
  return (
    <button className={`button ${variant ?? ""}`} onClick={onClick} disabled={disabled || busy} type="button">
      {busy ? "working…" : children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
