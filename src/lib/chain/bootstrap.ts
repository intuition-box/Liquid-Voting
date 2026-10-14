/**
 * Setting up a session: three smart accounts, deployed, funded, holding weight that
 * counts — and visible to the governor by the time the button finishes.
 *
 * Ten chain operations, and every one of them appears in the transaction log as it
 * happens. That is deliberate. A thirty-second spinner is dead time a visitor resents;
 * the same thirty seconds spent watching accounts be deployed, funded and given weight is
 * the clearest explanation of the stack the demo has to offer, and it happens before
 * anybody has to be told anything.
 *
 * Nothing here is novel — it is `bun run setup` and `bun run fund` performed in a browser
 * against addresses generated a moment earlier, and it deliberately mirrors them so the
 * two cannot drift.
 *
 * It is also written against a public RPC with a bandwidth allowance this demo has
 * exhausted more than once, so it is frugal on purpose: the accounts are derived once and
 * in parallel, the gas price is read once, the fixed-cost transactions declare their gas
 * instead of asking what it will be, and the mint rides along with the self-delegation in
 * a single operation rather than paying for a transaction of its own.
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
import type { HybridAccount } from "./smart-accounts";
import { logStep, recordStep, settleStep, trackTransaction } from "./tx-log";
import { defaultFees, sendUserOp } from "./user-op";
import { addressesOf, deriveAccounts, freshKeys, writeSession, type Session } from "./session";
import { ROLES, type Role } from "../roles";

/**
 * What the session submitter is given, out of which everything else is paid.
 *
 * Measured rather than guessed: a whole setup — three deployments, three top-ups, three
 * operations — costs about 0.0001 tTRUST in gas on 13579, and the rest of this is the
 * float the three accounts keep. 0.03 leaves roughly double what the run needs, and it is
 * a faucet's money: a visitor who wants to see the demo work has no use for more, and
 * every multiple of it is a session somebody else cannot have.
 */
const SESSION_BUDGET = parseEther("0.03");

/**
 * Gas target per smart account. Each pays for its own operations (ADR 0010).
 *
 * A delegation costs about 0.00002 tTRUST and a vote much the same, so this is several
 * hundred of either — far more than a session will use, and still small enough that three
 * of them fit comfortably inside the budget above.
 */
const ACCOUNT_GAS = parseEther("0.004");

/** The same footing for everyone: what differs is what they lend, not what they were given. */
const HOLDING = 100n;

/** Passes allowed per account. Each step is idempotent, so a retry repeats only what is
 *  actually missing. */
const ATTEMPTS = 2;

/**
 * Gas for the two fixed-cost transactions, declared rather than estimated.
 *
 * Measured at 187k and 26k. Over-provisioning costs nothing — unused gas is refunded —
 * and skipping the estimate saves two round trips per transaction, which across a setup
 * is a dozen calls against an allowance that has run out mid-session before.
 *
 * The user operation is left to estimate. Its own declared limits are what the EntryPoint
 * charges against, and a figure invented here could disagree with them.
 */
const GAS_DEPLOY = 400_000n;
const GAS_TRANSFER = 60_000n;

/** Where the session's first tTRUST comes from. */
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
export const BOOTSTRAP_STAGES = 3 + ROLES.length * 3 + 1;

/**
 * One sender, with the fees it read once.
 *
 * Nonces are deliberately left to the node. Counting them locally saved a dozen calls and
 * cost correctness: `sendUserOp` submits its own `handleOps` transaction from this same
 * account and asks for its own nonce, so a local counter and a queried one interleave and
 * collide — `nonce too low: tx 8, state 9`, three accounts into a run. Every transaction
 * here is awaited before the next begins, which is what makes asking reliable.
 */
interface Sender {
  wallet: WalletClient<Transport, Chain, Account>;
  fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
}

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
        args: { owner: privateKeyToAccount(owners[role]).address, account: accounts[role].address },
      })),
    },
    { status: "done" },
  );

  // ── 3. The session's budget ──────────────────────────────────────────────────────
  stage("asking for gas");
  await fundSubmitter(client, funder, submitter.address, rpcUrl);

  const sender: Sender = {
    wallet: createWalletClient({
      chain: intuitionTestnet,
      transport: http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0]),
      account: submitter,
    }),
    fees: await defaultFees(client),
  };

  // ── 4. Deploy, fund, endow — per account ─────────────────────────────────────────
  for (const role of ROLES) {
    await setUpAccount({ client, sender, role, account: accounts[role], votesToken, stage });
  }

  // ── 5. And make sure the governor can see it ─────────────────────────────────────
  await settleWeight({ client, sender, accounts, votesToken, stage });

  const session: Session = {
    submitterKey,
    submitterAddress: submitter.address,
    owners,
    accounts: addressesOf(accounts),
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
 * defensiveness for its own sake — a mint reverted once in testing with no reason the node
 * would admit to, which left an account holding nothing and voting with nothing. A visitor
 * who clicks a button has no way to diagnose that.
 *
 * The mint and the self-delegation travel together in one operation. They had been two
 * transactions, which was one more than the work needs: `mint` is open on this token, so
 * the account can call it itself, and batching is what `encodeCalls` is for.
 */
async function setUpAccount({
  client,
  sender,
  role,
  account,
  votesToken,
  stage,
}: {
  client: PublicClient;
  sender: Sender;
  role: Role;
  account: HybridAccount;
  votesToken: `0x${string}`;
  stage: (label: string) => void;
}): Promise<void> {
  const token = { address: votesToken, abi: votesTokenAbi } as const;

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
          () =>
            sender.wallet.sendTransaction({
              to: factory,
              data: factoryData,
              gas: GAS_DEPLOY,
              ...sender.fees,
            }),
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
          () =>
            sender.wallet.sendTransaction({
              to: account.address,
              value: topUp,
              gas: GAS_TRANSFER,
              ...sender.fees,
            }),
        );
      }

      stage(`endowing ${role}`);
      // Read both first, so a second pass does not hand out a second hundred.
      const [held, counts] = await Promise.all([
        client.readContract({ ...token, functionName: "balanceOf", args: [account.address] }),
        client.readContract({ ...token, functionName: "getVotes", args: [account.address] }),
      ]);

      const calls = [];
      if (held < HOLDING) {
        calls.push({
          to: votesToken,
          value: 0n,
          data: encodeFunctionData({ abi: votesTokenAbi, functionName: "mint", args: [account.address, HOLDING] }),
        });
      }
      if (counts === 0n) {
        calls.push({
          to: votesToken,
          value: 0n,
          data: encodeFunctionData({ abi: votesTokenAbi, functionName: "delegate", args: [account.address] }),
        });
      }

      if (calls.length > 0) {
        const endowed = await sendUserOp(
          client,
          sender.wallet,
          account,
          calls,
          {
            actor: role,
            label: `${role} is given ${HOLDING} DVOTE and self-delegates`,
            detail:
              "A balance is not voting power on ERC20Votes: weight comes from a checkpoint, and none exists until the holder calls delegate — even to itself. An account holding a token it never self-delegated votes with zero, which is a miserable thing to diagnose from the outside, so both happen in one operation.",
            calls: [
              {
                contract: "DemoVotes",
                address: votesToken,
                fn: "mint(address,uint256)",
                args: { to: `${role} · ${account.address}`, amount: HOLDING.toString() },
              },
              { contract: "DemoVotes", address: votesToken, fn: "delegate(address)", args: { delegatee: `${role} itself` } },
            ],
          },
          sender.fees,
        );
        if (!endowed.success) {
          throw new Error(`${role} could not be given its weight: ${endowed.revert?.formatted ?? "the operation reverted"}`);
        }
      }

      const after = await client.readContract({ ...token, functionName: "getVotes", args: [account.address] });
      if (after < HOLDING) throw new Error(`${role}: holds weight that does not count`);
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
 * Waits until the governor can see the weight, not merely until the token has it.
 *
 * Three facts have to line up here and none of them is obvious.
 *
 * First, `getVotes` is the token's current answer and the governor never asks it. It reads
 * `getPastVotes(account, clock() - 1)`, because ERC-5805 refuses to report voting power for
 * the current timepoint at all. A checkpoint written moments ago is therefore invisible to
 * the governor until the clock has moved past it.
 *
 * Second, `clock()` on this chain is not `eth_blockNumber`. Intuition testnet is an
 * Arbitrum Nitro chain, where `block.number` inside the EVM reports the parent chain's
 * height — around 48,100,000 while the L2 is around 9,372,000. Asking `getPastVotes` about
 * an L2 block number is asking about a timepoint five times too early, which answers zero
 * every time and looks exactly like a failure that never happened (ADR 0026).
 *
 * Third, the clock is only resampled when an L2 block is produced, and this chain produces
 * none without traffic. So waiting alone never helps and neither does a burst of
 * transactions: the parent advances about once a second, and two operations sent back to
 * back read the very same height.
 *
 * Which produced a genuinely baffling symptom. Every step reported success, the token
 * agreed each account held a hundred, and the app showed the accounts set up last with no
 * weight and no way to vote. Nothing had failed. The clock had not moved past their
 * checkpoints, and nothing the setup did was going to move it.
 *
 * So: one cheap transaction to resample, a moment for the parent to advance, and the
 * token's own clock as the timepoint. It matters beyond the display — `delegateWeight`
 * checks the balance at `clock() - 1` too, so until this settles a session cannot delegate
 * anything.
 */
async function settleWeight({
  client,
  sender,
  accounts,
  votesToken,
  stage,
}: {
  client: PublicClient;
  sender: Sender;
  accounts: Record<Role, HybridAccount>;
  votesToken: `0x${string}`;
  stage: (label: string) => void;
}): Promise<void> {
  stage("letting the weight come into view");
  const step = logStep({
    kind: "tx",
    label: "the clock is moved past the new weight",
    detail:
      "ERC-5805 will not report voting power for the current timepoint, so the governor reads the one before it. On an Arbitrum chain that timepoint is the parent chain's height, resampled only when an L2 block is produced — so this nudges one out and waits for the parent to move.",
    calls: [{ contract: "DemoVotes", address: votesToken, fn: "getPastVotes(account, clock() - 1)" }],
  });

  const token = { address: votesToken, abi: votesTokenAbi } as const;

  for (let attempt = 1; attempt <= 6; attempt++) {
    const clock = await client.readContract({ ...token, functionName: "clock" });
    if (clock > 1) {
      // One request for all three, folded into a single POST by the batching transport.
      const seen = await Promise.all(
        ROLES.map((role) =>
          client.readContract({
            ...token,
            functionName: "getPastVotes",
            args: [accounts[role].address, BigInt(clock) - 1n],
          }),
        ),
      );
      if (seen.every((weight) => weight >= HOLDING)) {
        settleStep(step, {
          status: "done",
          label: `all three accounts count for ${HOLDING} as of timepoint ${(BigInt(clock) - 1n).toString()}`,
        });
        return;
      }
    }

    // A moment first: the parent chain moves about once a second, and resampling twice
    // inside the same second reads the same height and achieves nothing.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const hash = await sender.wallet.sendTransaction({
      to: sender.wallet.account.address,
      value: 0n,
      gas: GAS_TRANSFER,
      ...sender.fees,
    });
    await client.waitForTransactionReceipt({ hash });
  }

  // Not fatal, and deliberately not thrown: the accounts are set up and funded, and the
  // next transaction anybody makes will bring the weight into view. Discarding a working
  // session over a clock that is a second behind would be the worse outcome.
  settleStep(step, {
    status: "failed",
    error:
      "The accounts are ready, but the governor has not caught up to their weight yet. One more transaction on this chain will do it — refresh in a moment.",
  });
}

/**
 * Puts the session's budget in the submitter's hands.
 *
 * Two paths, one shape. A development build was handed a key and transfers directly. A
 * build anyone can open has no key — publishing one would hand a funded account to whoever
 * reads the bundle, which is what ADR 0011 exists to prevent — so it asks an endpoint that
 * holds the key server side and can rate-limit.
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
    calls: [
      {
        contract: funder.kind === "key" ? "local funder" : "faucet",
        fn: "transfer",
        args: { to: submitter },
        value: SESSION_BUDGET,
      },
    ],
  };

  if (funder.kind === "key") {
    const wallet = createWalletClient({
      chain: intuitionTestnet,
      transport: http(rpcUrl ?? intuitionTestnet.rpcUrls.default.http[0]),
      account: privateKeyToAccount(funder.key),
    });
    await trackTransaction(client, intent, () =>
      wallet.sendTransaction({ to: submitter, value: SESSION_BUDGET, gas: GAS_TRANSFER }),
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
