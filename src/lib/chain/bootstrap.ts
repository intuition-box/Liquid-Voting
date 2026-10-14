/**
 * Setting up a session: three smart accounts, deployed, funded, holding weight that
 * counts.
 *
 * Thirteen chain operations, and every one of them appears in the transaction log as it
 * happens. That is deliberate. A thirty-second spinner is dead time a visitor resents;
 * the same thirty seconds spent watching accounts be deployed, funded, given tokens and
 * self-delegated is the clearest explanation of the stack the demo has to offer, and it
 * happens before anybody has to be told anything.
 *
 * Nothing here is novel — it is `bun run setup` and `bun run fund` performed in a browser
 * against addresses generated a moment earlier, and it deliberately mirrors them step for
 * step so the two cannot drift.
 */
import {
  createWalletClient,
  encodeFunctionData,
  formatEther,
  http,
  parseEther,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { votesTokenAbi } from "./abis";
import { intuitionTestnet } from "./network";
import { toHybridAccount } from "./smart-accounts";
import { logStep, recordStep, settleStep, trackTransaction } from "./tx-log";
import { sendUserOp } from "./user-op";
import { deriveAccounts, freshKeys, writeSession, type Session } from "./session";
import { ROLES, type Role } from "../roles";

/**
 * What the session submitter is given, out of which everything else is paid.
 *
 * Measured rather than guessed: a whole setup — three factory deployments, three top-ups,
 * three mints, three user operations — costs about 0.0001 tTRUST in gas on 13579, and the
 * rest of this is the float the three accounts keep. 0.03 leaves roughly double what the
 * run needs, and it is a faucet's money: a visitor who wants to see the demo work has no
 * use for more, and every multiple of it is a session somebody else cannot have.
 */
const SESSION_BUDGET = parseEther("0.03");

/**
 * Gas target per smart account. Each pays for its own operations (ADR 0010).
 *
 * A delegation costs about 0.00002 tTRUST and a vote much the same, so this is several
 * hundred of either — far more than a session will ever use, and still small enough that
 * three of them fit comfortably inside the budget above.
 */
const ACCOUNT_GAS = parseEther("0.004");

/** The same footing for everyone: what differs is what they lend, not what they were given. */
const HOLDING = 100n;

/** Passes allowed per account before giving up. Each one is idempotent, so a retry
 *  repeats only what is actually missing. */
const ATTEMPTS = 2;

/** Where the session’s first tTRUST comes from. */
export type Funder =
  /** A key this build was given — the local development path. */
  | { kind: "key"; key: Hex }
  /** An endpoint that holds the key server side, for a build anyone can open. */
  | { kind: "faucet"; url: string };

export interface BootstrapParams {
  client: PublicClient;
  funder: Funder;
  governor: `0x${string}`;
  votesToken: `0x${string}`;
  rpcUrl?: string | undefined;
  /** Called as each stage begins, for the loader. */
  onProgress?: (stage: string, done: number, total: number) => void;
}

/** Stage count, so the loader can show a real fraction rather than an indeterminate bar. */
export const BOOTSTRAP_STAGES = 2 + 1 + ROLES.length * 4;

export async function bootstrapSession({
  client,
  funder,
  governor,
  votesToken,
  rpcUrl,
  onProgress,
}: BootstrapParams): Promise<Session> {
  let done = 0;
  const stage = (label: string): void => {
    // Clamped, because a step that has to be retried calls this again and a loader
    // showing "17 of 15" reads like a bug in the thing it is reporting on.
    done = Math.min(done + 1, BOOTSTRAP_STAGES);
    onProgress?.(label, done, BOOTSTRAP_STAGES);
  };

  // ── 1. Keys, in this browser and nowhere else ────────────────────────────────────
  stage("generating keys");
  const { submitterKey, owners } = freshKeys();
  const submitter = privateKeyToAccount(submitterKey);
  recordStep(
    {
      kind: "local",
      label: "four keys are generated in this browser",
      detail:
        "Three owners for the accounts under demonstration, and one submitter to put their operations on chain. Burner keys on a testnet, kept in this browser and sent nowhere.",
      calls: [{ contract: "viem", fn: "generatePrivateKey()", args: { keys: "A, B, C, submitter" } }],
    },
    { status: "done" },
  );

  // ── 2. Addresses, before any of them exists ──────────────────────────────────────
  stage("deriving account addresses");
  const accounts = await deriveAccounts(client, owners);
  recordStep(
    {
      kind: "local",
      label: "their smart-account addresses are derived",
      detail:
        "A HybridDeleGator's address follows from its owner and its factory, so it is known before there is any code at it — which is what lets all three be funded and delegated to in one pass and deployed in another.",
      calls: ROLES.map((role) => ({
        contract: "HybridDeleGator",
        fn: `counterfactual address for ${role}`,
        args: { owner: privateKeyToAccount(owners[role]).address, account: accounts[role] },
      })),
    },
    { status: "done" },
  );

  // ── 3. The session's budget ──────────────────────────────────────────────────────
  stage("asking for gas");
  await fundSubmitter(client, funder, submitter.address, rpcUrl);

  const wallet = createWalletClient({
    chain: intuitionTestnet,
    transport: http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0]),
    account: submitter,
  });

  // ── 4. Deploy, fund, mint, self-delegate — per account ───────────────────────────
  for (const role of ROLES) {
    await setUpAccount({ client, wallet, role, ownerKey: owners[role], votesToken, stage });
  }

  const session: Session = {
    submitterKey,
    submitterAddress: submitter.address,
    owners,
    accounts,
    governor,
    createdAt: new Date().toISOString(),
  };
  writeSession(session);
  return session;
}

/**
 * One account: deployed, funded, holding weight that counts.
 *
 * Every step checks the chain before acting and checks it again afterwards, so running
 * this twice costs nothing and fixes whatever did not take the first time. That is not
 * defensiveness for its own sake — a mint reverted once in testing with no reason the
 * node would admit to, which left an account holding nothing and voting with nothing. A
 * visitor who clicks a button has no way to diagnose that, so a second pass is attempted
 * rather than leaving them with a broken session.
 */
async function setUpAccount({
  client,
  wallet,
  role,
  ownerKey,
  votesToken,
  stage,
}: {
  client: PublicClient;
  wallet: WalletClient<Transport, Chain, Account>;
  role: Role;
  ownerKey: Hex;
  votesToken: `0x${string}`;
  stage: (label: string) => void;
}): Promise<void> {
  const account = await toHybridAccount(client, privateKeyToAccount(ownerKey));
  const held = (): Promise<bigint> =>
    client.readContract({ address: votesToken, abi: votesTokenAbi, functionName: "balanceOf", args: [account.address] });
  const counts = (): Promise<bigint> =>
    client.readContract({ address: votesToken, abi: votesTokenAbi, functionName: "getVotes", args: [account.address] });

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      stage(`deploying ${role}`);
      const code = await client.getCode({ address: account.address });
      if (!code || code === "0x") {
        const { factory, factoryData } = await account.getFactoryArgs();
        if (!factory || !factoryData) throw new Error(`${role}: the factory gave no deployment args`);
        await trackTransaction(
          client,
          {
            actor: role,
            label: `${role}'s smart account is deployed`,
            detail:
              "Through the framework's canonical factory, at the address derived a moment ago. Deployed by the session submitter, since an account with no code cannot pay for its own creation.",
            calls: [
              { contract: "HybridDeleGatorFactory", address: factory, fn: "deploy(owner)", args: { account: account.address } },
            ],
          },
          () => wallet.sendTransaction({ to: factory, data: factoryData }),
        );
        const deployed = await client.getCode({ address: account.address });
        if (!deployed || deployed === "0x") throw new Error(`${role}: no code at the account after deploying it`);
      }

      stage(`funding ${role}`);
      const balance = await client.getBalance({ address: account.address });
      if (balance < ACCOUNT_GAS) {
        const topUp = ACCOUNT_GAS - balance;
        await trackTransaction(
          client,
          {
            actor: role,
            label: `${role} is funded with ${formatEther(topUp)} tTRUST for gas`,
            detail:
              "There is no bundler on 13579 and no paymaster, so each account pre-pays for its own user operations. The submitter is refunded as beneficiary (ADR 0010).",
            calls: [{ contract: "—", address: account.address, fn: "transfer", value: topUp }],
          },
          () => wallet.sendTransaction({ to: account.address, value: topUp }),
        );
      }

      stage(`minting ${role}'s weight`);
      // Read first, so a second pass does not hand out a second hundred.
      if ((await held()) < HOLDING) {
        await trackTransaction(
          client,
          {
            actor: role,
            label: `${role} is given ${HOLDING} DVOTE`,
            detail:
              "The same hundred for everyone. An equal footing is what a demo about delegation wants to show: what should differ between accounts is what they lent and to whom, not an endowment nobody chose.",
            calls: [
              {
                contract: "DemoVotes",
                address: votesToken,
                fn: "mint(address,uint256)",
                args: { to: `${role} · ${account.address}`, amount: HOLDING.toString() },
              },
            ],
          },
          () =>
            wallet.writeContract({
              address: votesToken,
              abi: votesTokenAbi,
              functionName: "mint",
              args: [account.address, HOLDING],
            }),
        );
        if ((await held()) < HOLDING) throw new Error(`${role}: the mint did not land`);
      }

      stage(`self-delegating ${role}`);
      // A balance is not voting power on ERC20Votes, so this is the step that decides
      // whether the account can vote at all — and the one worth checking by its effect.
      if ((await counts()) === 0n) {
        const self = await sendUserOp(
          client,
          wallet,
          account,
          [
            {
              to: votesToken,
              value: 0n,
              data: encodeFunctionData({ abi: votesTokenAbi, functionName: "delegate", args: [account.address] }),
            },
          ],
          {
            actor: role,
            label: `${role} self-delegates, so its balance counts`,
            detail:
              "A balance is not voting power on ERC20Votes: weight comes from a checkpoint, and none exists until the holder calls delegate — even to itself. An account holding a token it never self-delegated votes with zero, which is a miserable thing to diagnose from the outside.",
            calls: [
              { contract: "DemoVotes", address: votesToken, fn: "delegate(address)", args: { delegatee: `${role} itself` } },
            ],
          },
        );
        if (!self.success) {
          throw new Error(`${role} could not self-delegate: ${self.revert?.formatted ?? "the operation reverted"}`);
        }
      }

      if ((await counts()) < HOLDING) throw new Error(`${role}: holds weight that does not count`);
      return;
    } catch (cause) {
      if (attempt === ATTEMPTS) throw cause;
      recordStep(
        {
          kind: "local",
          actor: role,
          label: `setting ${role} up did not take — trying once more`,
          detail:
            "Every step reads the chain before acting, so a second pass repeats only what is actually missing.",
          calls: [],
        },
        { status: "failed", error: cause instanceof Error ? cause.message : String(cause) },
      );
    }
  }
}

/**
 * Puts the session's budget in the submitter's hands.
 *
 * Two paths, one shape. A development build was handed a key and transfers directly. A
 * build anyone can open has no key — publishing one would hand a funded account to
 * whoever reads the bundle, which is what ADR 0011 exists to prevent — so it asks an
 * endpoint that holds the key server side and can rate-limit.
 */
async function fundSubmitter(
  client: PublicClient,
  funder: Funder,
  submitter: `0x${string}`,
  rpcUrl: string | undefined,
): Promise<void> {
  const intent = {
    actor: submitter,
    label: `the session submitter is funded with ${formatEther(SESSION_BUDGET)} tTRUST`,
    detail:
      funder.kind === "key"
        ? "From the key this development build was given. A hosted build has none and asks a faucet instead."
        : "From a faucet that holds its key server side and rate-limits by caller, so no funded key has to ship in the bundle (ADR 0011).",
    calls: [{ contract: funder.kind === "key" ? "local funder" : "faucet", fn: "transfer", args: { to: submitter }, value: SESSION_BUDGET }],
  };

  if (funder.kind === "key") {
    const wallet = createWalletClient({
      chain: intuitionTestnet,
      transport: http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0]),
      account: privateKeyToAccount(funder.key),
    });
    await trackTransaction(client, intent, () =>
      wallet.sendTransaction({ to: submitter, value: SESSION_BUDGET }),
    );
    return;
  }

  const step = logStep({ ...intent, kind: "tx" });
  let hash: Hex;
  try {
    const response = await fetch(funder.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: submitter }),
    });
    if (!response.ok) {
      // A faucet that is empty or rate-limiting says so in words a visitor can act on,
      // and that is more useful than a status code.
      const said = await response.text().catch(() => "");
      throw new Error(said.slice(0, 200) || `the faucet answered ${response.status}`);
    }
    const body = (await response.json()) as { txHash?: Hex };
    if (!body.txHash) throw new Error("the faucet answered without a transaction hash");
    hash = body.txHash;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    settleStep(step, { status: "failed", error: reason });
    throw new Error(`no gas for this session: ${reason}`);
  }

  const receipt = await client.waitForTransactionReceipt({ hash });
  settleStep(step, {
    status: receipt.status === "success" ? "done" : "failed",
    hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  });
  if (receipt.status !== "success") throw new Error("the faucet's funding transaction reverted");
}
