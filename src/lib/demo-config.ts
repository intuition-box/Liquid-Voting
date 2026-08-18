import type { Hex } from "viem";

import type { DomainEdge, DomainNode } from "./graph";
import type { Delegation } from "./delegation";

declare const __DEMO_SUBMITTER_KEY__: string;
declare const __DEMO_RPC__: string;

interface ManifestShape {
  multiVault: `0x${string}`;
  contracts: {
    GraphDomainCaveatEnforcer: { address: `0x${string}` };
    MockGovernor: { address: `0x${string}` };
  };
  vocabulary: {
    predicate: { label: string; termId: Hex };
    atoms: Record<string, Hex>;
    triples: Record<string, Hex>;
  };
  attestation: { orgAttestor: `0x${string}` | null; curveId: string | null };
  accounts?: Record<string, { owner: `0x${string}`; smartAccount: `0x${string}` }>;
}

interface AccountsFile {
  keys: Record<string, `0x${string}`>;
}

interface DelegationsFile {
  signedAt: string;
  maxDepth: number;
  attestor: `0x${string}`;
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
}

export type Role = "voter" | "delegate" | "executor";

export interface DemoConfig {
  multiVault: `0x${string}`;
  enforcer: `0x${string}`;
  governor: `0x${string}`;
  predicate: { label: string; termId: Hex };
  nodes: DomainNode[];
  edges: DomainEdge[];
  attestor: `0x${string}`;
  curveId: bigint;
  accounts: Record<Role, { owner: `0x${string}`; smartAccount: `0x${string}` }>;
  ownerKeys: Record<Role, `0x${string}`>;
  delegations: { root: Delegation & { hash: Hex }; leaf: Delegation & { hash: Hex }; signedAt: string; maxDepth: number };
  submitterKey: `0x${string}`;
  rpcUrl: string | undefined;
}

export type ConfigResult = { ok: true; config: DemoConfig } | { ok: false; missing: string; hint: string };

/** Locally generated demo state lives outside git; a fresh clone has none of it yet. */
const localFiles = import.meta.glob<{ default: unknown }>("/data/*.json", { eager: true });
const manifestFiles = import.meta.glob<{ default: unknown }>("/manifest/*.json", { eager: true });

function readLocal<T>(name: string): T | null {
  const found = localFiles[`/data/${name}`] ?? manifestFiles[`/manifest/${name}`];
  return found ? (found.default as T) : null;
}

/** Derives the domain graph shape from the manifest's `child->parent` triple keys. */
function toGraph(vocabulary: ManifestShape["vocabulary"]): { nodes: DomainNode[]; edges: DomainEdge[] } {
  const nodes: DomainNode[] = Object.entries(vocabulary.atoms).map(([label, termId]) => ({ label, termId }));
  const edges: DomainEdge[] = Object.entries(vocabulary.triples).map(([key, tripleId]) => {
    const [child = "", parent = ""] = key.split("->");
    return { child, parent, tripleId };
  });
  return { nodes, edges };
}

export function loadDemoConfig(): ConfigResult {
  const manifest = readLocal<ManifestShape>("13579.json");
  if (!manifest) {
    return { ok: false, missing: "manifest/13579.json", hint: "deploy the contracts first (Phase 1)" };
  }
  const accountsFile = readLocal<AccountsFile>("accounts.json");
  if (!accountsFile) {
    return { ok: false, missing: "data/accounts.json", hint: "run `bun run phase3:setup` to create the three accounts" };
  }
  const delegationsFile = readLocal<DelegationsFile>("delegations.json");
  if (!delegationsFile) {
    return { ok: false, missing: "data/delegations.json", hint: "run `bun run phase3:delegate` to sign the chain" };
  }
  const attestor = manifest.attestation.orgAttestor;
  const curveId = manifest.attestation.curveId;
  if (!attestor || !curveId) {
    return { ok: false, missing: "manifest attestation", hint: "run `bun run seed` to stake the graph edges" };
  }
  const accounts = manifest.accounts;
  if (!accounts?.["voter"] || !accounts["delegate"] || !accounts["executor"]) {
    return { ok: false, missing: "manifest accounts", hint: "run `bun run phase3:setup`" };
  }

  const { nodes, edges } = toGraph(manifest.vocabulary);
  return {
    ok: true,
    config: {
      multiVault: manifest.multiVault,
      enforcer: manifest.contracts.GraphDomainCaveatEnforcer.address,
      governor: manifest.contracts.MockGovernor.address,
      predicate: manifest.vocabulary.predicate,
      nodes,
      edges,
      attestor,
      curveId: BigInt(curveId),
      accounts: {
        voter: accounts["voter"],
        delegate: accounts["delegate"],
        executor: accounts["executor"],
      },
      ownerKeys: {
        voter: accountsFile.keys["voter"] as `0x${string}`,
        delegate: accountsFile.keys["delegate"] as `0x${string}`,
        executor: accountsFile.keys["executor"] as `0x${string}`,
      },
      delegations: {
        root: delegationsFile.rootDelegation,
        leaf: delegationsFile.leafDelegation,
        signedAt: delegationsFile.signedAt,
        maxDepth: delegationsFile.maxDepth,
      },
      submitterKey: __DEMO_SUBMITTER_KEY__ as `0x${string}`,
      rpcUrl: __DEMO_RPC__ || undefined,
    },
  };
}

/** Write actions need a funded submitter; a production build never carries one (ADR 0011). */
export function canWrite(config: DemoConfig): boolean {
  return typeof config.submitterKey === "string" && config.submitterKey.startsWith("0x") && config.submitterKey.length === 66;
}

/** A domain minted during the session — kept client-side so the demo needs no rebuild. */
export interface SessionDomain {
  label: string;
  termId: Hex;
  parent: string;
  tripleId: Hex;
}

const SESSION_KEY = "liquid-demo:session-domains";

export function readSessionDomains(): SessionDomain[] {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionDomain[]) : [];
  } catch {
    return [];
  }
}

export function saveSessionDomain(domain: SessionDomain): SessionDomain[] {
  const existing = readSessionDomains().filter((entry) => entry.termId !== domain.termId);
  const next = [...existing, domain];
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}

export function clearSessionDomains(): void {
  window.localStorage.removeItem(SESSION_KEY);
}

/** Manifest vocabulary + anything minted this session, as one graph. */
export function withSessionDomains(config: DemoConfig, domains: SessionDomain[]): DemoConfig {
  if (domains.length === 0) return config;
  const knownNodes = new Set(config.nodes.map((node) => node.termId.toLowerCase()));
  const knownEdges = new Set(config.edges.map((edge) => edge.tripleId.toLowerCase()));
  return {
    ...config,
    nodes: [
      ...config.nodes,
      ...domains
        .filter((domain) => !knownNodes.has(domain.termId.toLowerCase()))
        .map((domain) => ({ label: domain.label, termId: domain.termId })),
    ],
    edges: [
      ...config.edges,
      ...domains
        .filter((domain) => !knownEdges.has(domain.tripleId.toLowerCase()))
        .map((domain) => ({ child: domain.label, parent: domain.parent, tripleId: domain.tripleId })),
    ],
  };
}
