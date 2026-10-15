import type { DomainGraph } from "../lib/graph/domain-graph";

/**
 * The domain tree, drawn from the graph rather than typed out beside it.
 *
 * It used to be a hard-coded string, and it had drifted: thirteen leaves drawn against
 * seventeen real ones, with `fee-switch`, `rate-model` and `emergency-patches` collapsed
 * into the lines "parameters, upgrades" and "events, content". A picture of the data that
 * is not the data will always drift eventually — and on the one tab whose job is to
 * explain the thing, a tree that disagrees with the rail two clicks away is worse than no
 * tree. Drawn from the graph, it also picks up a domain added during the session.
 */
function drawTree(graph: DomainGraph): string {
  const lines: string[] = [];
  const walk = (label: string, prefix: string, last: boolean, root: boolean): void => {
    lines.push(root ? label : `${prefix}${last ? "└── " : "├── "}${label}`);
    const children = graph.childrenOf(label);
    const next = root ? "" : prefix + (last ? "    " : "│   ");
    children.forEach((child, index) => walk(child, next, index === children.length - 1, false));
  };
  for (const root of graph.roots()) walk(root, "", true, true);
  return lines.join("\n");
}

/**
 * The argument, for someone who governs but does not build.
 *
 * No chain vocabulary anywhere on this page. Not "on-chain", not "contract", not
 * "graph". Someone who runs a DAO recognises delegation and mandates already, and the
 * technical shape is what the other tab is for.
 */
export function LightPaper({ graph }: { graph: DomainGraph }) {
  return (
    <article className="paper">
      <header className="paper-head">
        <h1>Overview</h1>
        <p className="paper-standfirst">
          You can put someone else in charge of what you hold on one subject, and decide how
          much of it goes to them. Today neither choice exists: a delegation covers
          everything you vote on, or it does not happen.
        </p>
      </header>

      <section className="paper-section">
        <h2>The problem, in one sentence</h2>
        <p>
          Nobody is competent everywhere. You may know the treasury well, the protocol less,
          the legal side not at all. What you would want to say is: “I am handing you my vote
          on the treasury, and nothing else.”
        </p>
        <p>
          So people hand everything to someone they broadly trust, and that person votes in
          their name on subjects they would never have handed over. Or they hand over
          nothing, and a decision they cared about is taken without them.
        </p>
      </section>

      <section className="paper-section">
        <h2>What we did</h2>
        <p>
          The obvious fix is to list the permitted subjects when you sign. It does not hold:
          an organisation starts a new programme every quarter, and a list written today is
          wrong within three months.
        </p>
        <p>
          An organisation already describes its own structure somewhere, and we made that
          description the authority. So a delegation stopped carrying a list and started
          carrying a sentence one member says to another.
        </p>

        <p className="paper-pull">
          “On the protocol, I would rather delegate my vote to someone I trust in this
          matter.”
        </p>

        <p>
          Whoever receives it still votes for themselves, and now carries somebody else’s
          voice as well, on the one subject where that person judged them better placed.
          Backing someone on a subject does not mean going quiet on it.
        </p>

        <p>
          Subjects nest inside one another, and that is what decides how far a delegation
          reaches.
        </p>

        <pre className="paper-tree">{drawTree(graph)}</pre>

        <p>
          Take the deepest branch, since it shows the most. Give someone{" "}
          <strong>the treasury</strong>, and they vote on everything beneath it, micro-grants
          included, four levels down. But nothing on the protocol or the community: those
          are other branches, and a delegation on one says nothing about them.
        </p>
      </section>

      <section className="paper-section">
        <h2>How it is checked</h2>
        <p>
          Say <strong>A</strong> has delegated the treasury to <strong>B</strong>. When B
          votes with A’s voice, the system does not take B’s word for it. It walks the path
          again, step by step, and confirms each link genuinely exists in the organisation’s
          structure.
        </p>

        <div className="paper-verdicts">
          <div className="paper-verdict paper-verdict-yes">
            <span>
              B votes on <strong>micro-grants</strong>, carrying A’s voice
            </span>
            <span className="paper-verdict-out">allowed</span>
          </div>
          <div className="paper-verdict paper-verdict-no">
            <span>
              B votes on <strong>events</strong>, carrying the same delegation
            </span>
            <span className="paper-verdict-out">refused</span>
          </div>
        </div>

        <p>
          In the second case B is not silenced: B still votes with <em>their own</em> voice.
          It is A’s that stays behind, because events is not what A handed over.
        </p>
        <p>
          One detail makes this hold. A line in the structure only counts once the
          organisation has staked money behind it, so nobody can widen their own mandate by
          writing themselves a new one.
        </p>
      </section>

      <section className="paper-section">
        <h2>Taking back what you lent</h2>
        <p>
          Chains form naturally. <strong>A</strong> delegates the treasury to{" "}
          <strong>B</strong>, and B passes the grants programme on to <strong>C</strong>, who
          works on it every day. C now votes with three voices: their own, B’s, and A’s.
        </p>
        <p>
          Then A changes their mind and takes their voice back. The question is what that
          should do to C, who never dealt with A at all.
        </p>

        <div className="paper-scene">
          <span className="paper-scene-label">A takes their voice back</span>
          <div className="paper-beat paper-beat-no">
            <span className="paper-beat-mark">−</span>
            <span>
              C loses A’s voice. A had lent it, on that subject only, and a lender can ask
              for it back.
            </span>
          </div>
          <div className="paper-beat paper-beat-yes">
            <span className="paper-beat-mark">+</span>
            <span>
              C keeps B’s. B lent their own voice, on their own authority, and A never had
              any say over it.
            </span>
          </div>
          <p>
            C goes from three voices to two and carries on.
          </p>
        </div>
      </section>

      <section className="paper-section">
        <h2>What it changes</h2>
        <p>
          The organisation lays out the subjects and puts proposals to a vote. What happens
          between contributors is theirs: whoever knows finance ends up carrying the tokens
          lent to them on finance, whoever knows the protocol carries other people’s there,
          and each of them keeps voting with what they held back. Nobody has to follow every
          subject to take part in all of them.
        </p>
        <p>
          And the delegation stays alive: as the organisation changes, the scope follows.
        </p>
      </section>
    </article>
  );
}
