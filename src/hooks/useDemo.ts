import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicClient } from "viem";

import { createChainClient } from "../lib/chain";
import { isDelegationDisabled } from "../lib/delegation";
import {
  canWrite,
  clearSessionDomains,
  loadDemoConfig,
  readSessionDomains,
  saveSessionDomain,
  withSessionDomains,
  type ConfigResult,
  type DemoConfig,
  type SessionDomain,
} from "../lib/demo-config";
import { readProposals, type ProposalRecord } from "../lib/demo-actions";
import { readEdgeStates, type EdgeState } from "../lib/graph";

export interface DemoState {
  configResult: ConfigResult;
  config: DemoConfig | null;
  client: PublicClient | null;
  writable: boolean;
  edges: EdgeState[];
  proposals: ProposalRecord[];
  rootDisabled: boolean;
  leafDisabled: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Registers a domain minted this session so the graph and pickers pick it up at once. */
  registerDomain: (domain: SessionDomain) => void;
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
  const config = useMemo(
    () => (baseConfig ? withSessionDomains(baseConfig, sessionDomains) : null),
    [baseConfig, sessionDomains],
  );
  const client = useMemo(() => (baseConfig ? createChainClient(baseConfig.rpcUrl) : null), [baseConfig]);

  const [edges, setEdges] = useState<EdgeState[]>([]);
  const [proposals, setProposals] = useState<ProposalRecord[]>([]);
  const [rootDisabled, setRootDisabled] = useState(false);
  const [leafDisabled, setLeafDisabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const registerDomain = useCallback((domain: SessionDomain) => {
    setSessionDomains(saveSessionDomain(domain));
  }, []);
  const resetSessionDomains = useCallback(() => {
    clearSessionDomains();
    setSessionDomains([]);
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
        const [edgeStates, records, root, leaf] = await Promise.all([
          readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId),
          readProposals(client, config),
          isDelegationDisabled(client, config.delegations.root.hash),
          isDelegationDisabled(client, config.delegations.leaf.hash),
        ]);
        if (cancelled) return;
        setEdges(edgeStates);
        setProposals(records);
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

  return {
    configResult,
    config,
    client,
    writable: config ? canWrite(config) : false,
    edges,
    proposals,
    rootDisabled,
    leafDisabled,
    loading,
    error,
    refresh,
    registerDomain,
    sessionDomainCount: sessionDomains.length,
    resetSessionDomains,
  };
}
