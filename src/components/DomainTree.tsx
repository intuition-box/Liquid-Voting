import type { Role } from "../lib/config/app-config";
import type { DomainGraph, TreeNode } from "../lib/graph/domain-graph";

/** A delegation in force on one domain, and whose voice it carries. */
export interface Held {
  from: Role;
  to: Role;
  /** Whose voice travels through it — `from` itself unless the grant relays someone. */
  principal: Role;
}

/**
 * The domain graph as a tree, and nothing else — this is the navigation.
 *
 * Selecting a branch lights it and everything under it, because a delegation on a domain
 * reaches every domain beneath it. Who handed what to whom is a list of its own, in the
 * Delegations tab: badges on the rows could not show a chain without crowding out the
 * names they hung off.
 */
export function DomainTree({
  graph,
  selected,
  onSelect,
}: {
  graph: DomainGraph;
  /** The domain currently in scope; its whole subtree is highlighted. */
  selected: string;
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
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  /** True once an ancestor is the selected domain — the whole subtree is in scope. */
  inScope: boolean;
  onSelect?: (domain: string) => void;
}) {
  const isSelected = node.label === selected;
  const covered = inScope || isSelected;

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
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
