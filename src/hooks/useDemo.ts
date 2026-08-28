import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicClient } from "viem";

import { createChainClient } from "../lib/chain";
import { decodeTerms, isDelegationDisabled, type Delegation } from "../lib/delegation";
import {
  canWrite,
  clearSessionDomains,
  loadDemoConfig,
  readSessionDomains,
  readSessionGrants,
  saveSessionDomain,
  saveSessionGrant,
  withSessionDomains,
  type ConfigResult,
  type DemoConfig,
  type Role,
  type SessionDomain,
} from "../lib/demo-config";
import { readProposals, readVotingPower, readWeights, type ProposalRecord } from "../lib/demo-actions";
import { baseGrants, type Grant } from "../lib/grants";
import { computePath, readEdgeStates, type EdgeState } from "../lib/graph";

export interface DemoState {
  configResult: ConfigResult;
  config: DemoConfig | null;
  client: PublicClient | null;
  writable: boolean;
  edges: EdgeState[];
  proposals: ProposalRecord[];
  votingPower: Record<Role, bigint>;
  /** The domain the root delegation is scoped to. */
  rootScope: string;
  /** The domain the leaf delegation narrows to. */
  leafScope: string;
  rootDisabled: boolean;
  leafDisabled: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Registers a domain minted this session so the graph and pickers pick it up at once. */
  registerDomain: (domain: SessionDomain) => void;
  /** Every delegation in force: the seeded pair plus anything signed this session. */
  grants: Grant[];
  /** What each role would cast on a domain, keyed by domain term id — read from the governor. */
  weights: Record<string, Record<Role, bigint>>;
  /** Records a delegation signed in the UI. */
  addGrant: (grant: Grant) => void;
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
  const [votingPower, setVotingPower] = useState<Record<Role, bigint>>({ voter: 0n, delegate: 0n, executor: 0n });
  const [weights, setWeights] = useState<Record<string, Record<Role, bigint>>>({});
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
  const resetSessionDomains = useCallback(() => {
    clearSessionDomains();
    setSessionDomains([]);
    setSessionGrants([]);
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
        const [edgeStates, records, powers, root, leaf] = await Promise.all([
          readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId),
          readProposals(client, config, 40),
          readVotingPower(client, config),
          isDelegationDisabled(client, config.delegations.root.hash),
          isDelegationDisabled(client, config.delegations.leaf.hash),
        ]);
        if (cancelled) return;
        setEdges(edgeStates);
        setProposals(records);
        setVotingPower(powers);

        // One read per domain that has a proposal — the governor is the authority on
        // weight. The path lets a grant on a parent domain count here; the governor
        // verifies every hop of it against the graph.
        const domainIds = [...new Set(records.map((record) => record.domainId))];
        const labelOf = new Map(config.nodes.map((node) => [node.termId.toLowerCase(), node.label]));
        const perDomain = await Promise.all(
          domainIds.map((id) => {
            const label = labelOf.get(id.toLowerCase());
            const toRoot = label ? computePath(edgeStates, config.nodes, label, "governance") : null;
            return readWeights(client, config, id, toRoot?.found ? toRoot.path : []);
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

  // The scopes each level granted: read from the signed terms, not hardcoded.
  const scopeOf = (delegation: Delegation | undefined): string => {
    const caveat = delegation?.caveats[0];
    if (!config || !caveat) return "";
    const termId = decodeTerms(caveat.terms).rootDomainId.toLowerCase();
    return config.nodes.find((node) => node.termId.toLowerCase() === termId)?.label ?? "";
  };
  const rootScope = scopeOf(config?.delegations.root);
  const leafScope = scopeOf(config?.delegations.leaf);

  // The seeded pair carries its on-chain revoked state; session grants are always live.
  const grants: Grant[] = config ? [...baseGrants(config, rootDisabled, leafDisabled), ...sessionGrants] : [];

  return {
    configResult,
    config,
    client,
    writable: config ? canWrite(config) : false,
    edges,
    proposals,
    votingPower,
    rootScope,
    leafScope,
    rootDisabled,
    leafDisabled,
    loading,
    error,
    refresh,
    registerDomain,
    grants,
    weights,
    addGrant,
    sessionDomainCount: sessionDomains.length,
    resetSessionDomains,
  };
}
