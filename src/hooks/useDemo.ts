import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicClient } from "viem";

import { createChainClient } from "../lib/chain";
import { isDelegationDisabled } from "../lib/delegation";
import {
  canWrite,
  clearSessionDomains,
  loadDemoConfig,
  readSessionDomains,
  readSessionGrants,
  saveSessionDomain,
  saveSessionGrant,
  saveSessionGrants,
  withSessionDomains,
  type ConfigResult,
  type DemoConfig,
  type Role,
  type SessionDomain,
} from "../lib/demo-config";
import { readGraphLimits, readProposals, readWeights, type ProposalRecord } from "../lib/demo-actions";
import { DelegationSet } from "../lib/delegation-set";
import { DomainGraph, type GraphLimits } from "../lib/domain-graph";
import { baseGrants, type Grant } from "../lib/grants";
import { readEdgeStates, type EdgeState } from "../lib/graph";

export interface DemoState {
  configResult: ConfigResult;
  config: DemoConfig | null;
  client: PublicClient | null;
  writable: boolean;
  edges: EdgeState[];
  /** The domain hierarchy, indexed once — every parent/child question goes through it. */
  graph: DomainGraph;
  proposals: ProposalRecord[];
  rootDisabled: boolean;
  leafDisabled: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Registers a domain minted this session so the graph and pickers pick it up at once. */
  registerDomain: (domain: SessionDomain) => void;
  /** Every delegation in force: the seeded pair plus anything signed this session. */
  grants: Grant[];
  /** The grants as an object: who may delegate what, and which signed chain to redeem. */
  delegations: DelegationSet;
  /** What each role would cast on a domain, keyed by domain term id — read from the governor. */
  weights: Record<string, Record<Role, bigint>>;
  /** Records a delegation signed in the UI. */
  addGrant: (grant: Grant) => void;
  /** Marks a grant on a domain revoked, so it can be handed to someone else. */
  revokeGrant: (domain: string) => void;
  sessionDomainCount: number;
  /** Drops session-minted domains — use between rehearsals so they do not linger on stage. */
  resetSessionDomains: () => void;
}

/**
 * Owns every read the panels display: live edge authorization, delegation disabled
 * state, and the governor's proposals. One `refresh` re-reads all of it, so any action
 * can settle the UI by calling it.
 */
export function useDemo(): DemoState {
  const configResult = useMemo(() => loadDemoConfig(), []);
  const baseConfig = configResult.ok ? configResult.config : null;

  const [sessionDomains, setSessionDomains] = useState<SessionDomain[]>(() =>
    typeof window === "undefined" ? [] : readSessionDomains(),
  );
  const [sessionGrants, setSessionGrants] = useState<Grant[]>(() =>
    typeof window === "undefined" ? [] : readSessionGrants(),
  );
  const config = useMemo(
    () => (baseConfig ? withSessionDomains(baseConfig, sessionDomains) : null),
    [baseConfig, sessionDomains],
  );
  const client = useMemo(() => (baseConfig ? createChainClient(baseConfig.rpcUrl) : null), [baseConfig]);

  const [edges, setEdges] = useState<EdgeState[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [weights, setWeights] = useState<Record<string, Record<Role, bigint>>>({});
  const [limits, setLimits] = useState<GraphLimits | null>(null);
  const [rootDisabled, setRootDisabled] = useState(false);
  const [leafDisabled, setLeafDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const registerDomain = useCallback((domain: SessionDomain) => {
    setSessionDomains(saveSessionDomain(domain));
  }, []);
  const addGrant = useCallback((grant: Grant) => {
    setSessionGrants(saveSessionGrant(grant));
  }, []);
  // The seeded pair lives in a file, so a revocation of one is remembered here instead.
  const [revokedScopes, setRevokedScopes] = useState<string[]>([]);
  const revokeGrant = useCallback((domain: string) => {
    setSessionGrants((current) => {
      const next = current.map((grant) => (grant.scope === domain ? { ...grant, revoked: true } : grant));
      saveSessionGrants(next);
      return next;
    });
    setRevokedScopes((current) => (current.includes(domain) ? current : [...current, domain]));
  }, []);
  const resetSessionDomains = useCallback(() => {
    clearSessionDomains();
    setSessionDomains([]);
    setSessionGrants([]);
    setRevokedScopes([]);
  }, []);

  useEffect(() => {
    if (!config || !client) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [edgeStates, records, root, leaf, graphLimits] = await Promise.all([
          readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId),
          readProposals(client, config, 40),
          isDelegationDisabled(client, config.delegations.root.hash),
          isDelegationDisabled(client, config.delegations.leaf.hash),
          readGraphLimits(client, config),
        ]);
        if (cancelled) return;
        setLimits(graphLimits);
        setEdges(edgeStates);
        setProposals(records);

        // One read per domain that has a proposal — the governor is the authority on
        // weight. The path lets a grant on a parent domain count here; the governor
        // verifies every hop of it against the graph.
        const domainIds = [...new Set(records.map((record) => record.domainId))];
        const fresh = DomainGraph.from(config.nodes, edgeStates, graphLimits);
        const perDomain = await Promise.all(
          domainIds.map((id) => {
            const label = fresh.labelOf(id);
            return readWeights(client, config, id, label ? fresh.domainPathOf(label) : []);
          }),
        );
        if (cancelled) return;
        setWeights(Object.fromEntries(domainIds.map((id, index) => [id.toLowerCase(), perDomain[index]!])));
        setRootDisabled(root);
        setLeafDisabled(leaf);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config, client, tick]);

  // Indexed once per (nodes, edges) change, so panels ask rather than re-walk.
  const graph = useMemo(
    () => DomainGraph.from(config?.nodes ?? [], edges, limits ?? undefined),
    [config?.nodes, edges, limits],
  );

  // The seeded pair carries its on-chain revoked state; session grants are always live.
  // DelegationSet settles the cascade on top: a grant chained to a revoked one dies too.
  const delegations = useMemo(() => {
    const signed = config
      ? [...baseGrants(config, rootDisabled, leafDisabled), ...sessionGrants].map((grant) =>
          revokedScopes.includes(grant.scope) ? { ...grant, revoked: true } : grant,
        )
      : [];
    return new DelegationSet(signed, graph);
  }, [config, rootDisabled, leafDisabled, sessionGrants, revokedScopes, graph]);
  const grants = delegations.all() as Grant[];

  return {
    configResult,
    config,
    client,
    writable: config ? canWrite(config) : false,
    edges,
    graph,
    proposals,
    rootDisabled,
    leafDisabled,
    loading,
    error,
    refresh,
    registerDomain,
    grants,
    delegations,
    weights,
    addGrant,
    revokeGrant,
    sessionDomainCount: sessionDomains.length,
    resetSessionDomains,
  };
}
