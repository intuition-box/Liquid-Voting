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
      how: "delegateWeight(B, domain, amount). A keeps whatever it did not lend, and B counts for the rest.",
    },
    {
      where: "browser",
      kind: "sign",
      what: "B votes: the path is found client-side",
      how: "micro-grants → builder-grants → grants → treasury, attached to the redemption.",
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
      what: "GraphDomainScope checks every hop, during the redemption",
      how: "Recomputes each triple id and demands both a positive link and the curator's stake. The supplied path proves nothing. It says where to look.",
    },
    {
      where: "governor",
      kind: "gov",
      what: "The vote is recorded as B's, carrying A's weight",
      how: "OpenZeppelin's own _castVote counts it. The tally, the double-vote guard and the event are the audited ones.",
    },
  ];

  const ours = [
    {
      name: "GraphDomainScope",
      role: "The caveat. Checks scope against the graph, hop by hop. Ours.",
      address: config.enforcer,
    },
    {
      name: "OZGovernor",
      role: "OpenZeppelin's Governor, inherited as published. We override _getVotes, and add castVoteFor so a redeemed vote is recorded under the delegate rather than the lender.",
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
        <h2>Three design decisions</h2>

        <h3 className="howto-sub">The scope is a question, not a list</h3>
        <p>
          A caveat could hold the domains it permits, and checking one would be a membership
          test. It would also be wrong within a quarter, because an organisation opens
          programmes and closes them, and a delegation signed in March cannot be expected to
          know about a branch created in June. So the terms hold a single domain and the
          check asks whether the proposal's domain sits under it, which is a question the
          graph answers at the time it is asked. Add a branch and every delegation already
          signed covers it, with nobody signing anything again.
        </p>

        <h3 className="howto-sub">The voter announces the path, the contract rechecks it</h3>
        <p>
          The MultiVault stores a triple by its own id and offers no way to ask which
          triples name a given subject, so a contract holding <code>micro-grants</code>{" "}
          cannot walk upwards to <code>treasury</code> on its own. Iterating to find out is
          not an option either, since the set is unbounded and the gas is not.
        </p>
        <p>
          The voter therefore supplies the path, and the enforcer treats it as a claim rather
          than as evidence. It recomputes each triple id from the two domains and the
          predicate, and looks that id up. A path that does not exist produces an id nothing
          is stored under, so an invented route fails on the first hop it invents. Supplying
          the path is a convenience for the contract, never a permission for the voter.
        </p>

        <h3 className="howto-sub">Authorization follows the stake, not existence</h3>
        <p>
          Anyone can write a triple, and it costs a fraction of a cent. If the enforcer
          accepted a link because it existed, a delegate holding <code>events</code> would
          mint <code>treasury is a sub-domain of events</code> and vote on the treasury with
          borrowed weight, having paid almost nothing to widen a delegation somebody else
          signed.
        </p>
        <p>
          So existence is not the test. The enforcer reads the curator's stake on the triple
          and requires it to be positive, which makes an attack cost whatever the curator
          committed rather than a gas fee. It also gives the organisation a way to disown a
          link without deleting anything, since withdrawing the stake stops it authorising
          while the claim remains on chain for anyone to read.
        </p>
      </section>

      <section className="howto-section">
        <h2>Two questions, answered in two places</h2>
        <p>
          Scope and weight are not the same question, and nothing here answers both. The
          caveat decides whether a voice may be used on this subject at all, and it does that
          during the redemption, before the governor is ever reached. The governor then
          decides what that voice is worth, through <code>_getVotes</code>, the method{" "}
          <code>Governor</code> declares virtual for exactly this purpose.
        </p>
        <p>
          The audited code is inherited as published. Beside it we add one entry point,{" "}
          <code>castVoteFor</code>, and it exists for a reason worth stating plainly:
          OpenZeppelin reads the voter from the caller, while a redemption executes from the
          lender's account. Without it, a vote B redeemed from A would be recorded as A's. The
          caveat is bound to that entry point and refuses a declared voter who is not the one
          redeeming, so a delegation cannot be turned into a vote under someone else's name.
        </p>
        <p className="muted">
          Exercised on this same testnet: a vote on a domain under the delegated one carries
          both voices, and the same delegation on another branch carries only your own.
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
