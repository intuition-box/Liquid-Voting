import type { Hex } from "viem";

import { privateKeyToAddress } from "viem/accounts";

import type { Funder } from "../chain/bootstrap";
import type { Session } from "../chain/session";
import type { DomainEdge, DomainNode } from "../graph/edges";
import { parseEdgeKey } from "../graph/domain-graph";
import { ROLES, type Role } from "../roles";
import type { Delegation } from "../delegation/encoding";

/**
 * Dev-only secrets, injected by vite.config.ts. A production build receives empty
 * values, `canWrite()` turns false, and the write panels fall back to read-only
 * (ADR 0011).
 */
const DEMO_SUBMITTER_KEY: string = import.meta.env.DEMO_SUBMITTER_KEY ?? "";
const DEMO_RPC: string = import.meta.env.DEMO_RPC ?? "";
/**
 * Where a hosted build gets the gas for a visitor's session.
 *
 * Not a secret, which is the whole point of it: the key stays behind the endpoint, so a
 * build anyone can open carries no funded account. Unset in development, where
 * `DEMO_SUBMITTER_KEY` is present and no faucet is needed.
 */
const FAUCET_URL: string = import.meta.env.VITE_FAUCET_URL ?? "";
const DEMO_OWNER_KEYS: Record<string, string> = (() => {
  try {
    return JSON.parse(import.meta.env.DEMO_OWNER_KEYS ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
})();

interface ManifestShape {
  multiVault: `0x${string}`;
  contracts: {
    GraphDomainScope: { address: `0x${string}` };
    DemoGovernor: { address: `0x${string}` };
    OZGovernor: { address: `0x${string}` };
    OZGraphDomainScope: { address: `0x${string}` };
    ProposalDomains: { address: `0x${string}` };
    DemoVotes: { address: `0x${string}` };
  };
  vocabulary: {
    predicate: { label: string; termId: Hex };
    atoms: Record<string, Hex>;
    triples: Record<string, Hex>;
  };
  curation: { curator: `0x${string}` | null; curveId: string | null };
  accounts?: Record<string, { owner: `0x${string}`; smartAccount: `0x${string}` }>;
}

interface DelegationsFile {
  signedAt: string;
  maxDepth: number;
  attestor: `0x${string}`;
  rootDelegation: Delegation & { hash: Hex };
  leafDelegation: Delegation & { hash: Hex };
  /** The delegate's own voice, absent from files signed before it was split out. */
  ownDelegation?: Delegation & { hash: Hex };
}

export { ROLES, type Role } from "../roles";

export interface AppConfig {
  multiVault: `0x${string}`;
  enforcer: `0x${string}`;
  governor: `0x${string}`;
  /** Where a proposal's domain is recorded, since an OZ proposal carries none. */
  resolver: `0x${string}`;
  /** The ERC20Votes the governor reads weight from. */
  votesToken: `0x${string}`;
  predicate: { label: string; termId: Hex };
  nodes: DomainNode[];
  edges: DomainEdge[];
  attestor: `0x${string}`;
  curveId: bigint;
  accounts: Record<Role, { owner: `0x${string}`; smartAccount: `0x${string}` }>;
  /** Empty in a production build — writes are disabled there (ADR 0011). */
  ownerKeys: Partial<Record<Role, `0x${string}`>>;
  /** Set in a hosted build: where a visitor's session asks for its gas. */
  faucetUrl: string | undefined;
  delegations: {
    root: Delegation & { hash: Hex };
    /** The voice the delegate relays for the voter — chained to `root`. */
    leaf: Delegation & { hash: Hex };
    /** The delegate's own voice, standing on its own authority. */
    own?: Delegation & { hash: Hex };
    signedAt: string;
    maxDepth: number;
  };
  submitterKey: `0x${string}`;
  rpcUrl: string | undefined;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string; hint: string };

/**
 * Only non-secret artefacts may be bundled. `data/accounts.json` holds the owner private
 * keys and is deliberately NOT globbed — it reaches the app through the dev-only
 * `DEMO_OWNER_KEYS` env define in vite.config.ts, so a production build carries no keys.
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
    const { child, parent } = parseEdgeKey(key);
    return { child, parent, tripleId };
  });
  return { nodes, edges };
}

export function loadAppConfig(): ConfigResult {
  const manifestModule = manifestFiles["/manifest/13579.json"];
  if (!manifestModule) {
    return { ok: false, missing: "manifest/13579.json", hint: "deploy the contracts first (Phase 1)" };
  }
  const manifest = manifestModule.default as ManifestShape;

  const delegationsModule = delegationFiles["/data/delegations.json"];
  if (!delegationsModule) {
    return { ok: false, missing: "data/delegations.json", hint: "run `bun run delegate` to sign the chain" };
  }
  const delegationsFile = delegationsModule.default as DelegationsFile;

  const attestor = manifest.curation.curator;
  const curveId = manifest.curation.curveId;
  if (!attestor || !curveId) {
    return { ok: false, missing: "manifest curation", hint: "run `bun run seed` to stake the graph edges" };
  }

  const manifestAccounts = manifest.accounts;
  const accounts = {} as AppConfig["accounts"];
  for (const role of ROLES) {
    const entry = manifestAccounts?.[role];
    if (!entry) return { ok: false, missing: `manifest accounts.${role}`, hint: "run `bun run setup`" };
    accounts[role] = entry;
  }

  // Missing owner keys are normal in a production build; they only gate write actions.
  const ownerKeys: AppConfig["ownerKeys"] = {};
  for (const role of ROLES) {
    const key = DEMO_OWNER_KEYS[role];
    if (isHexKey(key)) ownerKeys[role] = key;
  }

  const { nodes, edges } = toGraph(manifest.vocabulary);
  return {
    ok: true,
    config: {
      multiVault: manifest.multiVault,
      enforcer: manifest.contracts.OZGraphDomainScope.address,
      governor: manifest.contracts.OZGovernor.address,
      resolver: manifest.contracts.ProposalDomains.address,
      votesToken: manifest.contracts.DemoVotes.address,
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
        ...(delegationsFile.ownDelegation ? { own: delegationsFile.ownDelegation } : {}),
        signedAt: delegationsFile.signedAt,
        maxDepth: delegationsFile.maxDepth,
      },
      // Empty string in a production build — validated by canWrite() before any use.
      submitterKey: DEMO_SUBMITTER_KEY as `0x${string}`,
      faucetUrl: FAUCET_URL || undefined,
      rpcUrl: DEMO_RPC || undefined,
    },
  };
}

/**
 * The same config, acting as a session's own three wallets instead of the manifest's.
 *
 * The manifest's accounts are the ones whose owner keys live in a gitignored file: they
 * work on the machine that made them and nowhere else. A session generated in the browser
 * replaces all three, plus the submitter, so a hosted build can be driven by whoever
 * opened it — and two visitors do not quietly share one set of identities.
 *
 * Everything else is untouched. The graph, the governor, the vocabulary and the staked
 * edges are shared on purpose: they are the thing being demonstrated, and they cost real
 * deposits to create.
 */
export function withSession(config: AppConfig, session: Session): AppConfig {
  const ownerKeys: AppConfig["ownerKeys"] = {};
  const accounts = {} as AppConfig["accounts"];
  for (const role of ROLES) {
    ownerKeys[role] = session.owners[role];
    accounts[role] = { owner: privateKeyToAddress(session.owners[role]), smartAccount: session.accounts[role] };
  }
  return { ...config, accounts, ownerKeys, submitterKey: session.submitterKey };
}

/**
 * How a session gets its first tTRUST, or null when this build has no way to.
 *
 * A development build was handed a key and uses it. A hosted build has none — shipping
 * one would publish a funded account to anyone who reads the bundle, which ADR 0011
 * exists to prevent — and uses the faucet, which holds its key server side.
 */
export function resolveFunder(config: AppConfig): Funder | null {
  if (isHexKey(config.submitterKey)) return { kind: "key", key: config.submitterKey };
  if (config.faucetUrl) return { kind: "faucet", url: config.faucetUrl };
  return null;
}

/** Write actions need a funded submitter and all three owner keys (dev only, ADR 0011). */
export function canWrite(config: AppConfig): boolean {
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
  window.localStorage.removeItem(GRANTS_KEY);
}

const GRANTS_KEY = "liquid-demo:session-grants";

/** Structural check only — enough to reject a stale or hand-edited entry. */
function isSessionGrant(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const delegation = candidate["delegation"];
  return (
    typeof candidate["from"] === "string" &&
    typeof candidate["to"] === "string" &&
    // Grants stored before voices were split out carry no principal. They would render
    // as a chain starting nowhere, so they are dropped rather than half-read.
    typeof candidate["principal"] === "string" &&
    typeof candidate["scope"] === "string" &&
    typeof delegation === "object" &&
    delegation !== null &&
    typeof (delegation as Record<string, unknown>)["signature"] === "string" &&
    typeof (delegation as Record<string, unknown>)["hash"] === "string"
  );
}

/**
 * Delegations signed in the UI, kept so a reload does not lose them. This is the local
 * stand-in for on-chain discovery: production would publish each signed object and let
 * the delegate find it, rather than parking it in one browser.
 */
export function readSessionGrants<T>(): T[] {
  try {
    const raw = window.localStorage.getItem(GRANTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(isSessionGrant) as T[]) : [];
  } catch {
    return [];
  }
}

/** Replaces the stored set outright — used when a grant is revoked rather than added. */
export function saveSessionGrants<T>(grants: T[]): void {
  window.localStorage.setItem(GRANTS_KEY, JSON.stringify(grants));
}

export function saveSessionGrant<T extends { delegation: { hash: string } }>(grant: T): T[] {
  const existing = readSessionGrants<T>().filter((entry) => entry.delegation.hash !== grant.delegation.hash);
  const next = [...existing, grant];
  window.localStorage.setItem(GRANTS_KEY, JSON.stringify(next));
  return next;
}

/** Manifest vocabulary + anything minted this session, as one graph. */
export function withSessionDomains(config: AppConfig, domains: SessionDomain[]): AppConfig {
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
