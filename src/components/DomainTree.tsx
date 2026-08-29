import { useEffect, useState } from "react";

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
 *
 * Branches fold, the way a file tree does. Five levels of a DAO ontology is more than a
 * rail can show at once, and the point of a hierarchy is being able to look at one part
 * of it without the rest in the way.
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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Selecting a domain the rail had folded away — from a proposal row, say — would leave
  // it invisible, so the path down to it opens. Anything folded elsewhere stays folded.
  useEffect(() => {
    const onPath = new Set([selected, ...graph.ancestorsOf(selected)]);
    setCollapsed((current) => {
      const next = new Set([...current].filter((label) => !onPath.has(label)));
      return next.size === current.size ? current : next;
    });
  }, [selected, graph]);

  const toggle = (label: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(label)) next.add(label);
      return next;
    });
  };

  return (
    <ul className="tree">
      {graph.tree().map((node) => (
        <Branch
          key={node.label}
          node={node}
          depth={0}
          selected={selected}
          inScope={false}
          collapsed={collapsed}
          onToggle={toggle}
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
  collapsed,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string;
  /** True once an ancestor is the selected domain — the whole subtree is in scope. */
  inScope: boolean;
  /** Domains whose children are folded away. */
  collapsed: ReadonlySet<string>;
  onToggle: (domain: string) => void;
  onSelect?: (domain: string) => void;
}) {
  const isSelected = node.label === selected;
  const covered = inScope || isSelected;
  const hasChildren = node.children.length > 0;
  const open = hasChildren && !collapsed.has(node.label);

  return (
    <li className="tree-node">
      <div className="tree-row" style={{ paddingLeft: depth * 16 }}>
        {hasChildren ? (
          <button
            type="button"
            className="tree-twisty"
            onClick={() => onToggle(node.label)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`}
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          </button>
        ) : (
          // Keeps every name on the same left edge, whether it folds or not.
          <span className="tree-twisty tree-twisty-empty" aria-hidden="true" />
        )}
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
          onClick={onSelect ? () => onSelect(node.label) : undefined}
          disabled={!onSelect}
        >
          <span className="tree-name">{node.label}</span>
          {/* What is hidden below, so a folded branch does not read as a leaf. */}
          {!open && hasChildren ? <span className="tree-count">{node.children.length}</span> : null}
          {node.usable ? null : <span className="tree-flag">unusable</span>}
        </button>
      </div>
      {open ? (
        <ul className="tree">
          {node.children.map((child) => (
            <Branch
              key={child.label}
              node={child}
              depth={depth + 1}
              selected={selected}
              inScope={covered}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
