import { useState } from "react";

import { useDemo } from "./hooks/useDemo";
import type { Role } from "./lib/demo-config";
import { ROLES, ROLE_CLASS, ROLE_LABELS } from "./lib/grants";
import { ChainPanel } from "./components/ChainPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DomainNav } from "./components/DomainNav";
import { ProposalsPanel } from "./components/ProposalsPanel";
import { RevokePanel } from "./components/RevokePanel";
import { AddressLink } from "./components/primitives";

type TabId = "proposals" | "delegations";

/** The three demo identities. Each carries one colour, used everywhere the role appears. */
const IDENTITIES = ROLES.map((role) => ({
  role,
  label: ROLE_LABELS[role],
  className: ROLE_CLASS[role],
}));

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "proposals", label: "Proposals" },
  { id: "delegations", label: "Delegations" },
];

export function App() {
  const demo = useDemo();
  const [tab, setTab] = useState<TabId>("proposals");
  const [domain, setDomain] = useState("design");
  const [role, setRole] = useState<Role>("delegate");
  const { config, client } = demo;

  // Who handed each domain to whom, so the rail can badge the grants in force.
  const grantedTo = new Map<string, { from: Role; to: Role }>();
  for (const entry of demo.grants) {
    if (!entry.revoked) grantedTo.set(entry.scope, { from: entry.from, to: entry.to });
  }

  if (!demo.configResult.ok || !config || !client) {
    const missing = demo.configResult.ok ? "chain client" : demo.configResult.missing;
    const hint = demo.configResult.ok
      ? "the RPC could not be initialised — check the network"
      : demo.configResult.hint;
    return (
      <main className="shell">
        <Masthead role={role} onRole={setRole} />
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
      <Masthead role={role} onRole={setRole} />

      {demo.error ? <p className="status status-fail">chain read failed: {demo.error}</p> : null}

      <div className="workspace">
        <DomainNav
          config={config}
          client={client}
          graph={demo.graph}
          edges={demo.edges}
          loading={demo.loading}
          writable={demo.writable}
          selected={domain}
          grantedTo={grantedTo}
          viewer={role}
          sessionDomainCount={demo.sessionDomainCount}
          onSelect={setDomain}
          onRegistered={demo.registerDomain}
          onResetSession={demo.resetSessionDomains}
        />

        <div className="workspace-main">
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
            {tab === "proposals" ? (
              <ProposalsPanel
                config={config}
                client={client}
                graph={demo.graph}
                delegations={demo.delegations}
                proposals={demo.proposals}
                weights={demo.weights}
                domain={domain}
                role={role}
                writable={demo.writable}
                onSettled={demo.refresh}
              />
            ) : null}

            {tab === "delegations" ? (
              <div className="stack">
                <ChainPanel
                  config={config}
                  client={client}
                  graph={demo.graph}
                  writable={demo.writable}
                  role={role}
                  grants={demo.grants}
                  domain={domain}
                  onSigned={demo.addGrant}
                  onRevoked={demo.revokeGrant}
                />
                <RevokePanel
                  config={config}
                  client={client}
                  graph={demo.graph}
                  delegations={demo.delegations}
                  domain={domain}
                  writable={demo.writable}
                  rootDisabled={demo.rootDisabled}
                  onSettled={demo.refresh}
                />
              </div>
            ) : null}
          </ErrorBoundary>
        </div>
      </div>

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

function Masthead({ role, onRole }: { role: Role; onRole: (role: Role) => void }) {
  return (
    <header className="masthead">
      <div className="masthead-text">
        <h1>Voting authority scoped by a graph</h1>
        <p>
          A three-level ERC-7710 delegation chain whose domain scope is resolved by traversing the Intuition graph. Add
          an edge to the graph and every delegation above it widens.
          No redeploy, No new signature.
        </p>
      </div>

      <div className="identity" role="group" aria-label="acting as">
        <span className="identity-label">acting as</span>
        {IDENTITIES.map((entry) => (
          <button
            key={entry.role}
            type="button"
            className={role === entry.role ? `identity-option identity-on ${entry.className}` : "identity-option"}
            onClick={() => onRole(entry.role)}
            aria-pressed={role === entry.role}
          >
            <span className={`identity-dot ${entry.className}`} />
            {entry.label}
          </button>
        ))}
      </div>
    </header>
  );
}
