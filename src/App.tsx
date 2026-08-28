import { useState } from "react";

import { useDemo } from "./hooks/useDemo";
import type { Role } from "./lib/demo-config";
import { ChainPanel } from "./components/ChainPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GraphPanel } from "./components/GraphPanel";
import { ProposalsPanel } from "./components/ProposalsPanel";
import { RevokePanel } from "./components/RevokePanel";
import { AddressLink } from "./components/primitives";

type TabId = "domains" | "delegations" | "proposals";

/** The three demo identities. Each carries one colour, used everywhere the role appears. */
const IDENTITIES: Array<{ role: Role; label: string; className: string }> = [
  { role: "voter", label: "A", className: "role-a" },
  { role: "delegate", label: "B", className: "role-b" },
  { role: "executor", label: "C", className: "role-c" },
];

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "domains", label: "Domains" },
  { id: "delegations", label: "Delegations" },
  { id: "proposals", label: "Proposals" },
];

export function App() {
  const demo = useDemo();
  const [tab, setTab] = useState<TabId>("domains");
  const [role, setRole] = useState<Role>("delegate");
  const { config, client } = demo;

  if (!demo.configResult.ok || !config || !client) {
    const missing = demo.configResult.ok ? "chain client" : demo.configResult.missing;
    const hint = demo.configResult.ok
      ? "the RPC could not be initialised — check the network"
      : demo.configResult.hint;
    return (
      <main className="shell">
        <Masthead />
        <section className="panel">
          <h2>Not set up yet</h2>
          <p>
            Missing <code>{missing}</code>.
          </p>
          <p className="muted">{hint}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <Masthead />

      {demo.error ? <p className="status status-fail">chain read failed: {demo.error}</p> : null}

      <div className="identity" role="group" aria-label="acting as">
        {IDENTITIES.map((entry) => (
          <button
            key={entry.role}
            type="button"
            className={role === entry.role ? `identity-option identity-on ${entry.className}` : "identity-option"}
            onClick={() => setRole(entry.role)}
            aria-pressed={role === entry.role}
          >
            <span className={`identity-dot ${entry.className}`} />
            {entry.label}
          </button>
        ))}
      </div>
      <p className="identity-note">
        acting as <strong>{IDENTITIES.find((entry) => entry.role === role)?.label}</strong> — your weight on a proposal
        depends on what you were delegated, and on what you delegated away
      </p>

      <nav className="tabs" aria-label="sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? "tab tab-on" : "tab"}
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <ErrorBoundary>
        {tab === "domains" ? (
          <GraphPanel
            config={config}
            client={client}
            edges={demo.edges}
            loading={demo.loading}
            writable={demo.writable}
            sessionDomainCount={demo.sessionDomainCount}
            onRegistered={demo.registerDomain}
            onResetSession={demo.resetSessionDomains}
          />
        ) : null}

        {tab === "delegations" ? (
          <div className="stack">
            <ChainPanel
              config={config}
              client={client}
              writable={demo.writable}
              role={role}
              edges={demo.edges}
              grants={demo.grants}
              onSigned={demo.addGrant}
            />
            <RevokePanel
              config={config}
              client={client}
              edges={demo.edges}
              writable={demo.writable}
              rootDisabled={demo.rootDisabled}
              onSettled={demo.refresh}
            />
          </div>
        ) : null}

        {tab === "proposals" ? (
          <ProposalsPanel
            config={config}
            client={client}
            edges={demo.edges}
            proposals={demo.proposals}
            votingPower={demo.votingPower}
            grants={demo.grants}
            role={role}
            writable={demo.writable}
            onSettled={demo.refresh}
          />
        ) : null}

      </ErrorBoundary>

      <footer className="footer">
        <span>Intuition testnet · chain 13579</span>
        <span>
          enforcer <AddressLink address={config.enforcer} />
        </span>
        <span>
          governor <AddressLink address={config.governor} />
        </span>
        <span>
          MultiVault <AddressLink address={config.multiVault} />
        </span>
      </footer>
    </main>
  );
}

function Masthead() {
  return (
    <header className="masthead">
      <h1>Voting authority scoped by a graph</h1>
      <p>
        A three-level ERC-7710 delegation chain whose domain scope is resolved by traversing the Intuition graph. Add an
        edge to the graph and every delegation above it widens .
        No redeploy, No new signature.
      </p>
    </header>
  );
}
