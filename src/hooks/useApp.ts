import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicClient } from "viem";

import { createChainClient } from "../lib/chain/network";
import { isDelegationDisabled } from "../lib/delegation/encoding";
import {
  canWrite,
  clearSessionDomains,
  loadAppConfig,
  readSessionDomains,
  readSessionGrants,
  saveSessionDomain,
  saveSessionGrant,
  saveSessionGrants,
  withSessionDomains,
  type ConfigResult,
  type AppConfig,
  type Role,
  type SessionDomain,
} from "../lib/config/app-config";
import {
  readDelegatedTo,
  readLendings,
  readGraphLimits,
  readProposals,
  readTokenHoldings,
  readWeights,
  type ProposalRecord,
} from "../lib/actions";
import { DelegationSet } from "../lib/delegation/delegation-set";
import { DomainGraph, type GraphLimits } from "../lib/graph/domain-graph";
import { baseGrants, type Grant } from "../lib/delegation/grant";
import { readEdgeStates, type EdgeState } from "../lib/graph/edges";

export interface AppState {
  configResult: ConfigResult;
  config: AppConfig | null;
  client: PublicClient | null;
  writable: boolean;
  edges: EdgeState[];
  /** The domain hierarchy, indexed once — every parent/child question goes through it. */
  graph: DomainGraph;
  /** What each identity holds of the governance token, and how much of it votes. */
  holdings: Record<Role, { balance: bigint; votes: bigint }>;
  /** What each account is lending, and where. A lending moves no tokens, so a balance
   *  alone cannot show it. */
  lent: Partial<Record<Role, { amount: bigint; scope: string }>>;
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
  revokeGrant: (from: Role, domain: string) => void;
  sessionDomainCount: number;
  /** Drops session-minted domains — use between rehearsals so they do not linger on stage. */
  resetSessionDomains: () => void;
}

/**
 * Owns every read the panels display: live edge authorization, delegation disabled
 * state, and the governor's proposals. One `refresh` re-reads all of it, so any action
 * can settle the UI by calling it.
 */
export function useApp(): AppState {
  const configResult = useMemo(() => loadAppConfig(), []);
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
  /** Who the governor has each account delegating to, per domain — the register, not the signature. */
  const [delegatedTo, setDelegatedTo] = useState<Record<string, Partial<Record<Role, Role>>>>({});
  const [holdings, setHoldings] = useState<Record<Role, { balance: bigint; votes: bigint }>>({
    A: { balance: 0n, votes: 0n },
    B: { balance: 0n, votes: 0n },
    C: { balance: 0n, votes: 0n },
  });
  // What each account is lending right now. A lending moves no tokens, so the balance
  // above says nothing about it.
  const [lent, setLent] = useState<Partial<Record<Role, { amount: bigint; scope: string }>>>({});
  const [rootDisabled, setRootDisabled] = useState(false);
  const [leafDisabled, setLeafDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const registerDomain = useCallback((domain: SessionDomain) => {
    setSessionDomains(saveSessionDomain(domain));
  }, []);
  // Signing a grant also records the weight transfer at the governor, so the weights on
  // screen are stale until they are read again. Without this the panel keeps showing what
  // everyone could cast before the delegation existed.
  const addGrant = useCallback(
    (grant: Grant) => {
      setSessionGrants(saveSessionGrant(grant));
      refresh();
    },
    [refresh],
  );
  // The seeded pair lives in a file, so a revocation of one is remembered here instead.
  /**
   * Grants taken back this session, keyed `signer|domain`.
   *
   * Keyed by the signer too, not the domain alone: A taking `treasury` back must not
   * touch what B signed on the same domain. What B lent out of A's voice dies with it —
   * DelegationSet derives that from the authority links — but B's own grant stands.
   */
  const [revokedGrants, setRevokedGrants] = useState<string[]>([]);
  const revokeGrant = useCallback((from: Role, domain: string) => {
    const key = `${from}|${domain}`;
    setSessionGrants((current) => {
      const next = current.map((grant) =>
        grant.from === from && grant.scope === domain ? { ...grant, revoked: true } : grant,
      );
      saveSessionGrants(next);
      return next;
    });
    setRevokedGrants((current) => (current.includes(key) ? current : [...current, key]));
    refresh();
  }, [refresh]);
  const resetSessionDomains = useCallback(() => {
    clearSessionDomains();
    setSessionDomains([]);
    setSessionGrants([]);
    setRevokedGrants([]);
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

        // What the governor actually has on its books. Read for every domain, not just
        // the seeded pair's: a grant signed in the browser is checked against this too, so
        // a domain missing from the query would hide a delegation that is genuinely live.
        const [register, tokens, lendings] = await Promise.all([
          readDelegatedTo(client, config, config.nodes.map((node) => node.label)),
          readTokenHoldings(client, config),
          readLendings(client, config, config.nodes.map((node) => node.label)),
        ]);
        if (cancelled) return;
        setHoldings(tokens);
        setLent(lendings);
        if (cancelled) return;
        setDelegatedTo(register);
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
    // A grant counts while the governor's register agrees, whichever list it came from.
    // Session grants used to skip this check, so one signed in the browser survived being
    // taken back on chain — and showed up beside the seeded pair as a second A → B.
    const inForce = (grant: Grant): boolean => delegatedTo[grant.scope]?.[grant.from] === grant.to;
    const all = config
      ? [
          ...baseGrants(config, rootDisabled, leafDisabled, (from, scope) => delegatedTo[scope]?.[from] ?? null),
          ...sessionGrants,
        ].map((grant) =>
          revokedGrants.includes(`${grant.from}|${grant.scope}`) || !inForce(grant)
            ? { ...grant, revoked: true }
            : grant,
        )
      : [];

    // The pre-signed pair covers the same grant the demo makes live — A hands treasury to
    // B in both — so once the register turns on, two signatures describe one handover and
    // the panel listed it twice. One live grant per (signer, recipient, domain, voice);
    // the one signed in front of the audience is the one to show.
    const seen = new Set<string>();
    const signed = [...all].reverse().map((grant) => {
      if (grant.revoked) return grant;
      const key = `${grant.from}|${grant.to}|${grant.scope}|${grant.principal}`;
      if (seen.has(key)) return { ...grant, revoked: true };
      seen.add(key);
      return grant;
    }).reverse();
    return new DelegationSet(signed, graph);
  }, [config, rootDisabled, leafDisabled, sessionGrants, revokedGrants, graph, delegatedTo]);
  const grants = delegations.all() as Grant[];

  return {
    configResult,
    config,
    client,
    writable: config ? canWrite(config) : false,
    edges,
    graph,
    holdings,
    lent,
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
