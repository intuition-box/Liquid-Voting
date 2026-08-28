import type { DemoConfig, Role } from "../lib/demo-config";
import type { EdgeState } from "../lib/graph";
import { ROLE_CLASS, ROLE_LABELS } from "../lib/grants";

interface Node {
  label: string;
  children: Node[];
  usable: boolean;
}

/**
 * The domain graph as a tree. Selecting a branch lights it and everything under it,
 * because a delegation on a domain reaches every domain beneath it.
 *
 * A domain already handed to someone carries that identity's badge, so the existing
 * grants read off the tree instead of having to be looked up elsewhere.
 */
export function DomainTree({
  config,
  edges,
  selected,
  grantedTo,
  onSelect,
}: {
  config: DemoConfig;
  edges: EdgeState[];
  /** The domain currently in scope; its whole subtree is highlighted. */
  selected: string;
  /** Who holds each domain, by domain name — drawn as a badge on the row. */
  grantedTo?: Map<string, Role>;
  onSelect?: (domain: string) => void;
}) {
  const childrenOf = new Map<string, EdgeState[]>();
  for (const edge of edges) {
    childrenOf.set(edge.parent, [...(childrenOf.get(edge.parent) ?? []), edge]);
  }
  const hasParent = new Set(edges.map((edge) => edge.child));
  const roots = [...new Set(edges.map((edge) => edge.parent))].filter((name) => !hasParent.has(name));

  function build(name: string, usable: boolean): Node {
    return {
      label: name,
      usable,
      children: (childrenOf.get(name) ?? []).map((edge) => build(edge.child, edge.isAuthorizing)),
    };
  }

  const linked = new Set(edges.flatMap((edge) => [edge.child, edge.parent]));
  const orphans = config.nodes.filter((node) => !linked.has(node.label));
  const tree = [...roots.map((name) => build(name, true)), ...orphans.map((node) => build(node.label, true))];

  return (
    <ul className="tree">
      {tree.map((node) => (
        <Branch
          key={node.label}
          node={node}
          depth={0}
          selected={selected}
          inScope={false}
          grantedTo={grantedTo}
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
  onSelect,
}: {
  node: Node;
  depth: number;
  selected: string;
  /** True once an ancestor is the selected domain — the whole subtree is in scope. */
  inScope: boolean;
  grantedTo?: Map<string, Role>;
  onSelect?: (domain: string) => void;
}) {
  const isSelected = node.label === selected;
  const covered = inScope || isSelected;
  const holder = grantedTo?.get(node.label);
  const className = [
    "tree-label",
    !node.usable ? "tree-label-dead" : "",
    isSelected ? "tree-label-on" : "",
    covered && !isSelected ? "tree-label-scope" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="tree-node">
      <button
        type="button"
        className={className}
        style={{ paddingLeft: depth * 20 + 8 }}
        onClick={onSelect ? () => onSelect(node.label) : undefined}
        disabled={!onSelect}
      >
        <span className="tree-name">{node.label}</span>
        {holder ? (
          <span className={`tree-holder ${ROLE_CLASS[holder]}`}>
            <span className="tree-holder-dot" />
            {ROLE_LABELS[holder]}
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
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
