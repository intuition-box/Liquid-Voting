/**
 * The argument, for someone who governs but does not build.
 *
 * No chain vocabulary anywhere on this page. Not "on-chain", not "contract", not
 * "graph". Someone who runs a DAO recognises delegation and mandates already, and the
 * technical shape is what the other tab is for.
 */
export function LightPaper() {
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

        <pre className="paper-tree">
{`governance
├── treasury
│   ├── grants
│   │   ├── builder grants
│   │   │   └── micro-grants
│   │   └── retro funding
│   └── payroll
│       └── contributor comp
├── protocol
│   └── parameters, upgrades
└── community
    └── events, content`}
        </pre>

        <p>
          Take the deepest branch, since it shows the most. Hand me{" "}
          <strong>the treasury</strong>, and I vote on everything beneath it, micro-grants
          included, four levels down. But nothing on the protocol or the community: those
          are other branches, and a delegation on one says nothing about them.
        </p>
      </section>

      <section className="paper-section">
        <h2>How it is checked</h2>
        <p>
          When you vote with my voice, the system does not take your word for it. It walks the
          path again, step by step, and confirms each link genuinely exists in the
          organisation’s structure.
        </p>

        <div className="paper-verdicts">
          <div className="paper-verdict paper-verdict-yes">
            <span>
              A vote on <strong>micro-grants</strong>, carrying the voice I handed over on the
              treasury
            </span>
            <span className="paper-verdict-out">allowed</span>
          </div>
          <div className="paper-verdict paper-verdict-no">
            <span>
              A vote on <strong>events</strong>, carrying the same delegation
            </span>
            <span className="paper-verdict-out">refused</span>
          </div>
        </div>

        <p>
          In the second case you are not silenced: you still vote with <em>your</em> voice. It
          is mine that stays with me, because that is not what I handed over.
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
          A chain forms naturally: I hand you the treasury, and you pass the grants programme
          to someone closer to it. That person now carries three voices: their own, yours,
          and mine.
        </p>

        <div className="paper-scene">
          <span className="paper-scene-label">What happens when I take my voice back</span>
          <div className="paper-beat paper-beat-no">
            <span className="paper-beat-mark">−</span>
            <span>Mine is withdrawn. It was only ever lent, and only for that subject.</span>
          </div>
          <div className="paper-beat paper-beat-yes">
            <span className="paper-beat-mark">+</span>
            <span>
              Yours stays. You gave it on your own authority, and I have no claim on it.
            </span>
          </div>
          <p>
            They go from three voices to two. Nobody is silenced, and each of us takes back
            only what we lent.
          </p>
        </div>
      </section>

      <section className="paper-section">
        <h2>What it changes</h2>
        <p>
          An organisation can finally delegate by competence rather than by broad trust. The
          person who knows finance carries the voices handed to them on finance. The one who
          knows the protocol carries theirs elsewhere. Nobody needs to understand everything
          to take part.
        </p>
        <p>
          And the delegation stays alive: as the organisation changes, the scope follows,
          because it was never a list, only a question put to a structure the organisation
          already keeps current.
        </p>
      </section>

      <p className="paper-close">
        All of this runs today, on a live network. A delegation signed before a meeting
        authorises, during that meeting, a subject that did not exist when it was signed.
      </p>
    </article>
  );
}
