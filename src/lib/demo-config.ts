import type { Hex } from "viem";

import type { DomainEdge, DomainNode } from "./graph";
import type { Delegation } from "./delegation";

declare const __DEMO_SUBMITTER_KEY__: string;
declare const __DEMO_OWNER_KEYS__: Record<string, string>;
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

interface DelegationsFile {
  signedAt: string;
  maxDepth: number;
  attestor: `0x${string}`;
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
}

export type Role = "voter" | "delegate" | "executor";

const ROLES: Role[] = ["voter", "delegate", "executor"];

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
  /** Empty in a production build — writes are disabled there (ADR 0011). */
  ownerKeys: Partial<Record<Role, `0x${string}`>>;
  delegations: { root: Delegation & { hash: Hex }; leaf: Delegation & { hash: Hex }; signedAt: string; maxDepth: number };
  submitterKey: `0x${string}`;
  rpcUrl: string | undefined;
}

export type ConfigResult = { ok: true; config: DemoConfig } | { ok: false; missing: string; hint: string };

/**
 * Only non-secret artefacts may be bundled. `data/accounts.json` holds the owner private
 * keys and is deliberately NOT globbed — it reaches the app through the dev-only
 * `__DEMO_OWNER_KEYS__` define in vite.config.ts, so a production build carries no keys.
 */
const delegationFiles = import.meta.glob<{ default: unknown }>("/data/delegations.json", { eager: true });
const manifestFiles = import.meta.glob<{ default: unknown }>("/manifest/*.json", { eager: true });

function isHexKey(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
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
  const manifestModule = manifestFiles["/manifest/13579.json"];
  if (!manifestModule) {
    return { ok: false, missing: "manifest/13579.json", hint: "deploy the contracts first (Phase 1)" };
  }
  const manifest = manifestModule.default as ManifestShape;

  const delegationsModule = delegationFiles["/data/delegations.json"];
  if (!delegationsModule) {
    return { ok: false, missing: "data/delegations.json", hint: "run `bun run phase3:delegate` to sign the chain" };
  }
  const delegationsFile = delegationsModule.default as DelegationsFile;

  const attestor = manifest.attestation.orgAttestor;
  const curveId = manifest.attestation.curveId;
  if (!attestor || !curveId) {
    return { ok: false, missing: "manifest attestation", hint: "run `bun run seed` to stake the graph edges" };
  }

  const manifestAccounts = manifest.accounts;
  const accounts = {} as DemoConfig["accounts"];
  for (const role of ROLES) {
    const entry = manifestAccounts?.[role];
    if (!entry) return { ok: false, missing: `manifest accounts.${role}`, hint: "run `bun run phase3:setup`" };
    accounts[role] = entry;
  }

  // Missing owner keys are normal in a production build; they only gate write actions.
  const ownerKeys: DemoConfig["ownerKeys"] = {};
  for (const role of ROLES) {
    const key = __DEMO_OWNER_KEYS__[role];
    if (isHexKey(key)) ownerKeys[role] = key;
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
      accounts,
      ownerKeys,
      delegations: {
        root: delegationsFile.rootDelegation,
        leaf: delegationsFile.leafDelegation,
        signedAt: delegationsFile.signedAt,
        maxDepth: delegationsFile.maxDepth,
      },
      // Empty string in a production build — validated by canWrite() before any use.
      submitterKey: __DEMO_SUBMITTER_KEY__ as `0x${string}`,
      rpcUrl: __DEMO_RPC__ || undefined,
    },
  };
}

/** Write actions need a funded submitter and all three owner keys (dev only, ADR 0011). */
export function canWrite(config: DemoConfig): boolean {
  return isHexKey(config.submitterKey) && ROLES.every((role) => isHexKey(config.ownerKeys[role]));
}

/** A domain minted during the session — kept client-side so the demo needs no rebuild. */
export interface SessionDomain {
  label: string;
  termId: Hex;
  parent: string;
  tripleId: Hex;
}

const SESSION_KEY = "liquid-demo:session-domains";

function isSessionDomain(value: unknown): value is SessionDomain {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["label"] === "string" &&
    candidate["label"].length > 0 &&
    typeof candidate["parent"] === "string" &&
    typeof candidate["termId"] === "string" &&
    candidate["termId"].startsWith("0x") &&
    typeof candidate["tripleId"] === "string" &&
    candidate["tripleId"].startsWith("0x")
  );
}

export function readSessionDomains(): SessionDomain[] {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSessionDomain) : [];
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

/** Resets the session graph — use between rehearsals so a rehearsal domain does not
 *  linger in the pickers at showtime. */
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
