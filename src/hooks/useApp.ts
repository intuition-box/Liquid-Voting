import { useCallback, useEffect, useMemo, useState } from "react";
import type { Account, Chain, PublicClient, Transport, WalletClient } from "viem";

import { createChainClient } from "../lib/chain/network";
import { isDelegationDisabled } from "../lib/delegation/encoding";
import { BOOTSTRAP_STAGES, bootstrapSession } from "../lib/chain/bootstrap";
import { clearSession, readSession, type Session } from "../lib/chain/session";
import { forgetLogs } from "../lib/chain/logs";
import { logError } from "../lib/chain/tx-log";
import { connectWallet, disconnectWallet, hasWallet, restoreWallet, watchWallet } from "../lib/chain/wallet";
import {
  canWrite,
  clearSessionDomains,
  loadAppConfig,
  funderKind,
  isHexKey,
  resolveFunder,
  withSession,
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
  readRegister,
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

/**
 * How far back the proposal list reaches.
 *
 * `reset` lays out one proposal per domain, so this covers a whole fresh board with room
 * for a few left over from before. It used to read forty, and each one costs three reads
 * — its state, its tally and its domain — so most of a hundred and twenty reads went to
 * proposals nothing was ever going to show.
 */
const PROPOSAL_WINDOW = 20;

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
  /** Bumped by every `refresh`. A panel that owns a read of its own watches this so it
   *  settles with the rest of the page instead of going stale behind it. */
  tick: number;
  /** The handover just confirmed, for the moment it takes to draw it. The one event
   *  this whole demo exists to show, and until now it changed two numbers silently. */
  handover: { from: Role; to: Role; domain: string } | null;
  clearHandover: () => void;
  /** The domain the page is scoped to. Held here rather than in the view, because it
   *  decides which weights are worth reading at all. */
  domain: string;
  selectDomain: (domain: string) => void;
  /** The three wallets this browser owns, or null when it is driving the manifest's. */
  session: Session | null;
  /** Set while a session is being set up, for the loader. */
  bootstrapping: { stage: string; done: number; total: number } | null;
  bootstrapError: string | null;
  startSession: () => Promise<void>;
  endSession: () => void;
  /** The wallet connected in the header, if any. It is what pays for a session. */
  wallet: `0x${string}` | null;
  connectingWallet: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Whether this build can pay for a session at all. */
  canStartSession: boolean;
  /** Which way it would pay, so the offer can say so before anyone clicks. */
  funder: "key" | "wallet" | "faucet" | null;
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
  /**
   * The three wallets this browser owns, if it made any against this governor.
   *
   * Read once at mount rather than watched: a session is created by this tab and nothing
   * else writes it, so polling storage would only find what we already know.
   */
  const [session, setSession] = useState<Session | null>(() =>
    typeof window === "undefined" || !baseConfig ? null : readSession(baseConfig.governor),
  );
  const [domain, selectDomain] = useState("treasury");
  const [handover, setHandover] = useState<{ from: Role; to: Role; domain: string } | null>(null);
  /**
   * The connected wallet, held as the client rather than just the address: the bootstrap
   * needs something to send with, and connecting a second time inside it would open a
   * dialog for a wallet the header already shows as connected.
   */
  const [wallet, setWallet] = useState<WalletClient<Transport, Chain, Account> | null>(null);
  const [connectingWallet, setConnectingWallet] = useState(false);

  // Reconnect silently to whatever this browser authorised before, and follow the
  // visitor if they switch account in the wallet itself.
  useEffect(() => {
    let live = true;
    void restoreWallet().then((found) => {
      if (live && found) setWallet(found);
    });
    const stop = watchWallet((address) => {
      if (!address) setWallet(null);
      else void restoreWallet().then((found) => setWallet(found));
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    setConnectingWallet(true);
    try {
      setWallet(await connectWallet());
    } catch (cause) {
      logError("the wallet did not connect", cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnectingWallet(false);
    }
  }, []);

  /**
   * Forgets the wallet, and asks it to forget us.
   *
   * The session's own three accounts are untouched: they were funded by this wallet but
   * they are not it, and they go on working. Disconnecting ends who pays for the *next*
   * session, not the one already running — the same shape as a revoked delegation,
   * which stops the next vote and not the last one.
   */
  const disconnect = useCallback(async (): Promise<void> => {
    await disconnectWallet();
    setWallet(null);
  }, []);
  const clearHandover = useCallback(() => setHandover(null), []);
  const [bootstrapping, setBootstrapping] = useState<{ stage: string; done: number; total: number } | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const config = useMemo(() => {
    if (!baseConfig) return null;
    const scoped = withSessionDomains(baseConfig, sessionDomains);
    return session ? withSession(scoped, session) : scoped;
  }, [baseConfig, sessionDomains, session]);
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
      // Announced before the refresh, so the arc is already drawn while the reads that
      // will change the numbers underneath it are still in flight.
      setHandover({ from: grant.from, to: grant.to, domain: grant.scope });
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

    void (async () => {
      try {
        const [edgeStates, records, root, leaf, graphLimits] = await Promise.all([
          readEdgeStates(client, config.multiVault, config.edges, config.attestor, config.curveId),
          readProposals(client, config, PROPOSAL_WINDOW),
          isDelegationDisabled(client, config.delegations.root.hash),
          isDelegationDisabled(client, config.delegations.leaf.hash),
          readGraphLimits(client, config),
        ]);
        if (cancelled) return;
        setLimits(graphLimits);

        // What the governor actually has on its books. Read for every domain, not just
        // the seeded pair's: a grant signed in the browser is checked against this too, so
        // a domain missing from the query would hide a delegation that is genuinely live.
        const [register, tokens] = await Promise.all([
          readRegister(client, config, config.nodes.map((node) => node.label)),
          readTokenHoldings(client, config),
        ]);
        if (cancelled) return;
        setHoldings(tokens);
        setLent(register.lent);
        setDelegatedTo(register.delegatedTo);
        setEdges(edgeStates);
        setProposals(records);

        setRootDisabled(root);
        setLeafDisabled(leaf);
      } catch (cause) {
        // Into the log, not across the page. The public RPC's failure text is a wall —
        // method, full call arguments, contract, docs link — and a banner carrying it
        // pushed the whole interface down to say something nobody can act on.
        if (!cancelled) logError("a chain read failed", cause instanceof Error ? cause.message : String(cause));
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

  /**
   * What each identity would cast, for the domains the page is actually showing.
   *
   * Its own effect, and keyed on the selection, for two reasons. It is the most expensive
   * read in the app — the governor reverifies every hop of a domain path against the
   * MultiVault to answer it — and the panel only ever shows the selected domain and what
   * sits beneath it. Reading all seventeen meant paying for fourteen answers nobody
   * looked at. Keeping it apart from the main refresh is what lets changing the selection
   * cost those few reads instead of re-reading the whole board.
   */
  useEffect(() => {
    if (!config || !client) return;
    const selected = graph.termId(domain);
    const onScreen = [
      ...new Set([
        // The selected domain always, proposal or not: the identity cards report what
        // each account casts on it, and a domain nobody has proposed anything for would
        // otherwise sit on an ellipsis for ever.
        ...(selected ? [selected] : []),
        ...proposals
          .filter((proposal) => {
            const label = graph.labelOf(proposal.domainId);
            return label !== undefined && graph.isDescendantOf(label, domain);
          })
          .map((proposal) => proposal.domainId),
      ]),
    ];
    if (onScreen.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const read = await Promise.all(
          onScreen.map((id) => {
            const label = graph.labelOf(id);
            return readWeights(client, config, id, label ? graph.domainPathOf(label) : []);
          }),
        );
        if (cancelled) return;
        // Merged rather than replaced, so weights read for a domain visited earlier stay
        // on screen instead of blanking each time the selection moves.
        setWeights((current) => ({
          ...current,
          ...Object.fromEntries(onScreen.map((id, index) => [id.toLowerCase(), read[index]!])),
        }));
      } catch (cause) {
        if (!cancelled) logError("reading the weights failed", cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, client, graph, domain, proposals, tick]);

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

  /**
   * Makes this browser three wallets of its own: deployed, funded, holding weight that
   * counts. Every stage appears in the transaction log as it happens.
   */
  const startSession = useCallback(async (): Promise<void> => {
    if (!baseConfig || !client) return;
    // The header's wallet is what pays, when there is one. Connecting inside the
    // bootstrap would prompt for a wallet the header already shows as connected — but
    // somebody who presses this without having connected should not be refused for it,
    // so the connection happens here instead of becoming an error.
    let payer = wallet;
    if (!payer && !isHexKey(baseConfig.submitterKey) && hasWallet()) {
      setConnectingWallet(true);
      try {
        payer = await connectWallet();
        setWallet(payer);
      } catch (cause) {
        logError("the wallet did not connect", cause instanceof Error ? cause.message : String(cause));
        setBootstrapError("The wallet did not connect.");
        setConnectingWallet(false);
        return;
      }
      setConnectingWallet(false);
    }

    const funder = payer ? ({ kind: "wallet", wallet: payer } as const) : resolveFunder(baseConfig);
    if (!funder) {
      const said =
        "No wallet in this browser, no local key, and no faucet configured — so there is no way to pay for a session.";
      logError("the session could not be set up", said);
      setBootstrapError(said);
      return;
    }
    setBootstrapError(null);
    setBootstrapping({ stage: "starting", done: 0, total: BOOTSTRAP_STAGES });
    try {
      const made = await bootstrapSession({
        client,
        funder,
        governor: baseConfig.governor,
        votesToken: baseConfig.votesToken,
        multiVault: baseConfig.multiVault,
        attestor: baseConfig.attestor,
        rpcUrl: baseConfig.rpcUrl,
        onProgress: (stage, done, total) => setBootstrapping({ stage, done, total }),
      });
      setSession(made);
      // Everything on screen was read for the old identities; none of it is about these.
      setRevokedGrants([]);
      setSessionGrants([]);
      saveSessionGrants([]);
      refresh();
    } catch (cause) {
      const said = cause instanceof Error ? cause.message : String(cause);
      logError("the session could not be set up", said);
      setBootstrapError(said);
    } finally {
      setBootstrapping(null);
    }
  }, [baseConfig, client, refresh, wallet]);

  /** Forgets this browser's wallets. What they did stays on chain, as it should. */
  const endSession = useCallback((): void => {
    // Start the log reads over too. Nothing read so far is wrong, but forgetting the
    // session is the one moment that means "from the top", and a fresh read is cheap.
    forgetLogs();
    clearSession();
    setSession(null);
    setRevokedGrants([]);
    setSessionGrants([]);
    saveSessionGrants([]);
    refresh();
  }, [refresh]);

  return {
    tick,
    wallet: wallet?.account.address ?? null,
    connectingWallet,
    connect,
    disconnect,
    handover,
    clearHandover,
    domain,
    selectDomain,
    session,
    bootstrapping,
    bootstrapError,
    startSession,
    endSession,
    // `funderKind`, not `resolveFunder`. The latter deliberately omits the wallet case,
    // because a live connection is not derivable from config — so asking it here meant a
    // hosted build with MetaMask installed reported "no way to pay for a session" and
    // never offered the button the README is built around.
    canStartSession: baseConfig !== null && funderKind(baseConfig) !== null,
    funder: baseConfig ? funderKind(baseConfig) : null,
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
