import { decodeTerms } from "../lib/delegation";
import type { DemoConfig } from "../lib/demo-config";
import { AddressLink, Mono, Panel } from "./primitives";

/** The live delegation chain: each hop's scope, attestor, depth cap, and status. */
export function ChainPanel({
  config,
  rootDisabled,
  leafDisabled,
}: {
  config: DemoConfig;
  rootDisabled: boolean;
  leafDisabled: boolean;
}) {
  const labelOf = new Map(config.nodes.map((node) => [node.termId.toLowerCase(), node.label]));
  const levels = [
    { name: "voter → delegate", from: "voter" as const, to: "delegate" as const, delegation: config.delegations.root, disabled: rootDisabled },
    { name: "delegate → executor", from: "delegate" as const, to: "executor" as const, delegation: config.delegations.leaf, disabled: leafDisabled || rootDisabled },
  ];

  return (
    <Panel index="02" title="Delegation chain" subtitle={`signed ${new Date(config.delegations.signedAt).toLocaleString()} · off-chain, EIP-712`}>
      <ol className="levels">
        {levels.map((level) => {
          const terms = decodeTerms(level.delegation.caveats[0]?.terms ?? "0x");
          const scope = labelOf.get(terms.rootDomainId.toLowerCase()) ?? terms.rootDomainId.slice(0, 12);
          return (
            <li key={level.name} className={level.disabled ? "level level-dead" : "level"}>
              <div className="level-head">
                <h3>{level.name}</h3>
                <span className={level.disabled ? "tag tag-bad" : "tag tag-ok"}>
                  {level.disabled ? (rootDisabled && level.from !== "voter" ? "dead — root revoked" : "revoked") : "active"}
                </span>
              </div>
              <dl className="kv">
                <dt>scope</dt>
                <dd>
                  <strong>{scope}</strong> <span className="muted">and everything attested beneath it</span>
                </dd>
                <dt>accounts</dt>
                <dd>
                  <AddressLink address={config.accounts[level.from].smartAccount} /> →{" "}
                  <AddressLink address={config.accounts[level.to].smartAccount} />
                </dd>
                <dt>attestor</dt>
                <dd>
                  <AddressLink address={terms.attestor} />
                </dd>
                <dt>max depth</dt>
                <dd>
                  <Mono>{terms.maxDepth}</Mono> hops · expiry{" "}
                  <Mono>{terms.expiry === 0n ? "none" : new Date(Number(terms.expiry) * 1000).toLocaleString()}</Mono>
                </dd>
                <dt>hash</dt>
                <dd>
                  <Mono dim>{level.delegation.hash}</Mono>
                </dd>
              </dl>
            </li>
          );
        })}
      </ol>
      <p className="note">
        Both caveats run on every redemption through the full chain, so a proposal must sit under
        <strong> UX</strong> and under <strong>design</strong>. The narrowing is emergent — there is no narrowing code.
      </p>
    </Panel>
  );
}
