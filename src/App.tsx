import { useDemo } from "./hooks/useDemo";
import { ChainPanel } from "./components/ChainPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ExtendPanel } from "./components/ExtendPanel";
import { GraphPanel } from "./components/GraphPanel";
import { ProposePanel } from "./components/ProposePanel";
import { RevokePanel } from "./components/RevokePanel";
import { AddressLink } from "./components/primitives";

export function App() {
  const demo = useDemo();
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

      <ErrorBoundary>
        <div className="grid">
          <div className="column">
            <GraphPanel
              config={config}
              edges={demo.edges}
              loading={demo.loading}
              sessionDomainCount={demo.sessionDomainCount}
              onResetSession={demo.resetSessionDomains}
            />
            <ChainPanel config={config} rootDisabled={demo.rootDisabled} leafDisabled={demo.leafDisabled} />
          </div>
          <div className="column">
            <ProposePanel
              config={config}
              client={client}
              edges={demo.edges}
              writable={demo.writable}
              proposals={demo.proposals}
              onSettled={demo.refresh}
            />
            <ExtendPanel config={config} client={client} writable={demo.writable} onRegistered={demo.registerDomain} />
            <RevokePanel
              config={config}
              client={client}
              edges={demo.edges}
              writable={demo.writable}
              rootDisabled={demo.rootDisabled}
              onSettled={demo.refresh}
            />
          </div>
        </div>
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
      <h1>Voting authority scoped by a knowledge graph</h1>
      <p>
        A three-level ERC-7710 delegation chain whose domain scope is resolved by traversing the Intuition graph. Add an
        edge to the graph and every delegation above it widens — no redeploy, no new signature.
      </p>
    </header>
  );
}
