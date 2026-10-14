import { useState } from "react";

import { useApp } from "./hooks/useApp";
import type { Role } from "./lib/config/app-config";
import { ChainPanel } from "./components/ChainPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DomainNav } from "./components/DomainNav";
import { ProposalsPanel } from "./components/ProposalsPanel";
import { GrantList } from "./components/GrantList";
import { HowItWorks } from "./components/HowItWorks";
import { LightPaper } from "./components/LightPaper";
import { IdentityBar } from "./components/IdentityBar";
import { SessionGate } from "./components/SessionGate";
import { SessionStrip } from "./components/SessionStrip";
import { TxConsole } from "./components/TxConsole";
import { VoiceTrail } from "./components/VoiceTrail";
import { AddressLink, Panel } from "./components/primitives";

type TabId = "proposals" | "delegations" | "paper" | "how";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "proposals", label: "Proposals" },
  { id: "delegations", label: "Delegations" },
  { id: "paper", label: "Overview" },
  { id: "how", label: "How it works" },
];

/**
 * The reading tabs stand alone. Neither the domain rail nor the identity cards scope a
 * document: picking `treasury` or acting as B changes nothing on a page of prose, so a
 * control that does nothing is a control that teaches people the controls do nothing.
 *
 * The rail was already suppressed here and the cards were not — the same class of
 * control, treated two ways.
 */
const READING: TabId[] = ["paper", "how"];

export function App() {
  const demo = useApp();
  const [tab, setTab] = useState<TabId>("proposals");
  const [role, setRole] = useState<Role>("B");
  // The selection lives in the hook, because it decides which weights are worth reading.
  const { domain, selectDomain } = demo;
  const { config, client } = demo;
  const reading = READING.includes(tab);

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
      <nav className="topnav" aria-label="sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={tab === entry.id ? "topnav-tab topnav-tab-on" : "topnav-tab"}
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <Masthead />

      {reading ? null : (
        <IdentityBar
          config={config}
          role={role}
          onRole={setRole}
          domain={domain}
          graph={demo.graph}
          delegations={demo.delegations}
          holdings={demo.holdings}
          lent={demo.lent}
          weights={demo.weights}
          handover={demo.handover}
          onHandoverShown={demo.clearHandover}
        />
      )}

      <SessionGate
        session={demo.session}
        bootstrapping={demo.bootstrapping}
        error={demo.bootstrapError}
        canStart={demo.canStartSession}
        writable={demo.writable}
        onStart={() => void demo.startSession()}
      />

      {demo.error ? <p className="status status-fail">chain read failed: {demo.error}</p> : null}

      <div className={reading ? "workspace workspace-reading" : "workspace"}>
        {reading ? null : (
        <DomainNav
          config={config}
          client={client}
          graph={demo.graph}
          edges={demo.edges}
          loading={demo.loading}
          writable={demo.writable}
          selected={domain}
          sessionDomainCount={demo.sessionDomainCount}
          onSelect={selectDomain}
          onRegistered={demo.registerDomain}
          onResetSession={demo.resetSessionDomains}
        />
        )}

        <div className="workspace-main">
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
                <Panel title={`Who holds “${domain}”`}>
                  <GrantList delegations={demo.delegations} viewer={role} domain={domain} />
                </Panel>
                <ChainPanel
                  config={config}
                  client={client}
                  delegations={demo.delegations}
                  writable={demo.writable}
                  role={role}
                  grants={demo.grants}
                  domain={domain}
                  onSigned={demo.addGrant}
                  onRevoked={demo.revokeGrant}
                />
                {/* What came of handing it over, which completes the reading this tab
                    starts. Not on Proposals: that tab names every voter on every row. */}
                <VoiceTrail
                  config={config}
                  client={client}
                  role={role}
                  proposals={demo.proposals}
                  tick={demo.tick}
                />
              </div>
            ) : null}

            {tab === "paper" ? <LightPaper graph={demo.graph} /> : null}
            {tab === "how" ? <HowItWorks config={config} /> : null}
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

      {/* The machinery, docked together: whose wallets these are, and what they did. */}
      <div className="dock">
        {demo.session ? <SessionStrip session={demo.session} onForget={demo.endSession} /> : null}
        <TxConsole />
      </div>
    </main>
  );
}

/** The title, and one sentence saying what the page is. Nothing else lives here now. */
function Masthead() {
  return (
    <header className="masthead">
      <h1>Voting authority scoped by a graph</h1>
      <p>
        A three-level ERC-7710 delegation chain whose scope is resolved by traversing the Intuition graph.
        Add an edge and every delegation above it widens — no redeploy, no new signature.
      </p>
    </header>
  );
}
