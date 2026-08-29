import type { Role } from "../lib/demo-config";
import type { DomainGraph, TreeNode } from "../lib/domain-graph";
import { ROLE_CLASS, ROLE_LABELS } from "../lib/grants";

/** A delegation in force on one domain. */
export interface Held {
  from: Role;
  to: Role;
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
  /** Who handed each domain to whom, by domain name. */
  grantedTo?: Map<string, Held>;
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
  grantedTo?: Map<string, Held>;
  viewer?: Role;
  onSelect?: (domain: string) => void;
}) {
  const isSelected = node.label === selected;
  const covered = inScope || isSelected;
  const grant = grantedTo?.get(node.label);
  const side = grant ? (grant.from === viewer ? "gave" : grant.to === viewer ? "got" : "other") : null;

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
        {grant ? (
          <span
            className={`tree-holder tree-holder-${side}`}
            title={`${ROLE_LABELS[grant.from]} delegated this domain to ${ROLE_LABELS[grant.to]}`}
          >
            <span className={ROLE_CLASS[grant.from]}>{ROLE_LABELS[grant.from]}</span>
            <span className="tree-holder-arrow">→</span>
            <span className={ROLE_CLASS[grant.to]}>{ROLE_LABELS[grant.to]}</span>
          </span>
        ) : null}
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
