import type { Role } from "../lib/demo-config";
import type { DomainGraph, TreeNode } from "../lib/domain-graph";
import { ROLE_CLASS, ROLE_LABELS } from "../lib/grants";

/** A delegation in force on one domain, and whose voice it carries. */
export interface Held {
  from: Role;
  to: Role;
  /** Whose voice travels through it — `from` itself unless the grant relays someone. */
  principal: Role;
}

/**
 * The domain graph as a tree. Selecting a branch lights it and everything under it,
 * because a delegation on a domain reaches every domain beneath it.
 *
 * A domain already handed over carries the pair that moved it, written from the viewer's
 * side: what they gave, what they were given, or a transfer between two other accounts.
 */
export function DomainTree({
  graph,
  selected,
  grantedTo,
  viewer,
  onSelect,
}: {
  graph: DomainGraph;
  /** The domain currently in scope; its whole subtree is highlighted. */
  selected: string;
  /** Every grant in force, by domain name — one entry per voice handed on. */
  grantedTo?: Map<string, Held[]>;
  /** Who the viewer is acting as. */
  viewer?: Role;
  onSelect?: (domain: string) => void;
}) {
  return (
    <ul className="tree">
      {graph.tree().map((node) => (
        <Branch
          key={node.label}
          node={node}
          depth={0}
          selected={selected}
          inScope={false}
          grantedTo={grantedTo}
          viewer={viewer}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function Branch({
  node,
  depth,
  selected,
  inScope,
  grantedTo,
  viewer,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  /** True once an ancestor is the selected domain — the whole subtree is in scope. */
  inScope: boolean;
  grantedTo?: Map<string, Held[]>;
  viewer?: Role;
  onSelect?: (domain: string) => void;
}) {
  const isSelected = node.label === selected;
  const covered = inScope || isSelected;
  const held = grantedTo?.get(node.label) ?? [];

  return (
    <li className="tree-node">
      <button
        type="button"
        className={[
          "tree-label",
          !node.usable ? "tree-label-dead" : "",
          isSelected ? "tree-label-on" : "",
          covered && !isSelected ? "tree-label-scope" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={onSelect ? () => onSelect(node.label) : undefined}
        disabled={!onSelect}
      >
        <span className="tree-name">{node.label}</span>
        {held.map((grant) => {
          const side = grant.from === viewer ? "gave" : grant.to === viewer ? "got" : "other";
          // A relayed voice shows where it started, so a chain reads A → B → C on the row
          // rather than as two badges nobody can connect.
          const relayed = grant.principal !== grant.from;
          return (
            <span
              key={`${grant.principal}-${grant.from}-${grant.to}`}
              className={`tree-holder tree-holder-${side}`}
              title={
                relayed
                  ? `${ROLE_LABELS[grant.from]} passed on ${ROLE_LABELS[grant.principal]}'s vote to ${ROLE_LABELS[grant.to]}`
                  : `${ROLE_LABELS[grant.from]} delegated its own vote to ${ROLE_LABELS[grant.to]}`
              }
            >
              {relayed ? (
                <>
                  <span className={ROLE_CLASS[grant.principal]}>{ROLE_LABELS[grant.principal]}</span>
                  <span className="tree-holder-arrow">→</span>
                </>
              ) : null}
              <span className={ROLE_CLASS[grant.from]}>{ROLE_LABELS[grant.from]}</span>
              <span className="tree-holder-arrow">→</span>
              <span className={ROLE_CLASS[grant.to]}>{ROLE_LABELS[grant.to]}</span>
            </span>
          );
        })}
        {node.usable ? null : <span className="tree-flag">unusable</span>}
      </button>
      {node.children.length > 0 ? (
        <ul className="tree">
          {node.children.map((child) => (
            <Branch
              key={child.label}
              node={child}
              depth={depth + 1}
              selected={selected}
              inScope={covered}
              grantedTo={grantedTo}
              viewer={viewer}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
