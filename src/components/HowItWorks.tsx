import { FRAMEWORK } from "../lib/chain/network";
import type { AppConfig } from "../lib/config/app-config";
import { AddressLink } from "./primitives";

/**
 * The mechanism, for someone who does build.
 *
 * Addresses come from the manifest the app is already running against rather than being
 * written out here, so this page cannot drift from what is deployed.
 */
export function HowItWorks({ config }: { config: AppConfig }) {
  const steps = [
    {
      where: "off chain",
      kind: "sign",
      what: "A signs a delegation to B, scoped to a domain",
      how: "An EIP-712 object. Nothing is sent, only a signature.",
    },
    {
      where: "governor",
      kind: "gov",
      what: "The weight transfer is recorded",
      how: "delegateWeight(B, domain). A stops counting there, and B counts for both.",
    },
    {
      where: "browser",
      kind: "sign",
      what: "B votes: the path is found client-side",
      how: "micro-grants → builder-grants → grants → treasury, attached to the vote.",
    },
    {
      where: "framework",
      kind: "sign",
      what: "The DelegationManager validates the chain",
      how: "Signatures, links, revocation. Inherited code, and we wrote none of it.",
    },
    {
      where: "our caveat",
      kind: "graph",
      what: "GraphDomainScope checks every hop",
      how: "Recomputes each triple id and demands both a positive link and the curator's stake. The supplied path proves nothing. It says where to look.",
    },
    {
      where: "governor",
      kind: "gov",
      what: "The vote is recorded as B's, carrying A's weight",
      how: "One VoteCastOnBehalf per principal, so the split stays auditable.",
    },
  ];

  const ours = [
    {
      name: "GraphDomainScope",
      role: "The caveat. Checks scope against the graph, hop by hop. Ours.",
      address: config.enforcer,
    },
    {
      name: "DemoGovernor",
      role: "The governor this app talks to. Proposals, votes, delegation register.",
      address: config.governor,
    },
  ];

  const inherited = [
    {
      name: "DelegationManager",
      role: "ERC-7710 v1.3.0. Signatures, chains, revocation.",
      address: FRAMEWORK.delegationManager,
    },
    {
      name: "MultiVault",
      role: "The Intuition graph. The authority on what a domain contains.",
      address: config.multiVault,
    },
  ];

  return (
    <article className="howto">
      <header className="howto-head">
        <h1>How it works</h1>
        <p className="howto-standfirst">
          What happens between signing a delegation and a vote being counted, and which part
          of it we wrote.
        </p>
      </header>

      <section className="howto-section">
        <h2>One delegated vote, end to end</h2>
        <ol className="flow">
          {steps.map((step, index) => (
            <li key={index} className="flow-step">
              <span className={`flow-tag flow-tag-${step.kind}`}>{step.where}</span>
              <div className="flow-body">
                <span className="flow-what">{step.what}</span>
                <span className="flow-how">{step.how}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="howto-section">
        <h2>The contracts</h2>

        <h3 className="howto-label">What we wrote</h3>
        <ul className="contracts">
          {ours.map((entry) => (
            <li key={entry.name} className="contract">
              <span className="contract-name">{entry.name}</span>
              <span className="contract-role">{entry.role}</span>
              <AddressLink address={entry.address} />
            </li>
          ))}
        </ul>

        <h3 className="howto-label">What we inherited</h3>
        <ul className="contracts">
          {inherited.map((entry) => (
            <li key={entry.name} className="contract">
              <span className="contract-name">{entry.name}</span>
              <span className="contract-role">{entry.role}</span>
              <AddressLink address={entry.address} />
            </li>
          ))}
        </ul>
      </section>

      <section className="howto-section">
        <h2>Three sentences that carry it</h2>
        <ol className="claims">
          <li>
            A delegation does not carry a <em>list</em> of domains. It carries a{" "}
            <strong>question</strong> put to the graph. Add a branch, and every delegation
            already signed covers it.
          </li>
          <li>
            The graph cannot be walked from a contract, because there is no reverse index. The
            voter announces the path; the contract <strong>rechecks every hop</strong>.
          </li>
          <li>
            Writing a claim costs a fraction of a cent, so authorization follows the{" "}
            <strong>stake</strong>, not existence. Without that, a delegate would widen its own
            delegation.
          </li>
        </ol>
      </section>

      <section className="howto-section">
        <h2>It is not tied to our governor</h2>
        <p>
          The caveat is bound to a domain resolver, not to a governor. The same scheme runs on
          an unmodified OpenZeppelin Governor: the audited contracts are inherited as
          published, and one method is overridden. That method is <code>_getVotes</code>, which{" "}
          <code>Governor</code> declares virtual for exactly this. Weight still comes from an{" "}
          <code>ERC20Votes</code> snapshot; the domain register only decides who may exercise
          it where.
        </p>
        <p className="muted">
          Deployed and exercised on this same testnet: a vote on a domain under the delegated
          one counts both voices, the same vote outside it counts one.
        </p>
      </section>

      <section className="howto-section">
        <h2>Where each piece lives</h2>
        <ul className="storage">
          <li>
            <strong>The signed delegation</strong> stays in the browser. A signature costs
            nothing to make and only reaches the chain when someone redeems it. In production it
            would be published so the delegate can find it, rather than parked in one browser.
          </li>
          <li>
            <strong>The weight transfer</strong> is on chain, in the governor's register. That
            is what decides whose voice a vote carries.
          </li>
          <li>
            <strong>The revocation</strong> is on chain too, at the DelegationManager, which is
            what makes it binding on everyone.
          </li>
        </ul>
      </section>
    </article>
  );
}
