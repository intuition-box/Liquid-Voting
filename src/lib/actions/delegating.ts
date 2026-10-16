/**
 * Handing a domain on, and taking it back: signing the delegations and recording the
 * weight transfer at the governor.
 */
import { encodeFunctionData, toHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";

import { delegationManagerAbi, ozGovernorAbi, votesTokenAbi } from "../chain/abis";
import { FRAMEWORK } from "../chain/network";
import { toHybridAccount } from "../chain/smart-accounts";
import { sendUserOp, type UserOpResult } from "../chain/user-op";
import type { AppConfig } from "../config/app-config";
import { buildDisableCalldata, encodeTerms, type Delegation } from "../delegation/encoding";
import type { Role } from "../roles";

import { recordStep } from "../chain/tx-log";
import { DEFAULT_MAX_DEPTH, requireOwnerKey, submitterClient } from "./common";

/**
 * The most an account can lend, read at the timepoint the governor will check it against.
 *
 * `delegateWeight` validates the amount against `getPastVotes(sender, clock() - 1)`, so
 * that is what has to be asked here. It used to read `getVotes` — the live figure — and
 * the two are not the same number on this chain: `clock()` is the parent chain's height
 * (ADR 0026), it moves about once a second, and a checkpoint written since the last tick
 * is invisible to the past read while being plainly visible to the live one. Lending
 * "everything" right after a mint or a transfer therefore offered an amount the governor
 * refused, as `AmountExceedsBalance`, for no reason the screen could explain.
 */
async function ownWeight(client: PublicClient, config: AppConfig, role: Role): Promise<bigint> {
  // The token's clock, which is the governor's: `GovernorVotes.clock()` forwards to the
  // token when it implements ERC-6372, and this one does.
  const clock = await client.readContract({
    address: config.votesToken,
    abi: votesTokenAbi,
    functionName: "clock",
  });
  return client.readContract({
    address: config.votesToken,
    abi: votesTokenAbi,
    functionName: "getPastVotes",
    args: [config.accounts[role].smartAccount, BigInt(clock) - 1n],
  });
}

export async function signDelegation(
  client: PublicClient,
  config: AppConfig,
  from: Role,
  to: Role,
  domainLabel: string,
  /** The delegations the signer already holds on this domain, one per voice it carries. */
  upstream: (Delegation & { hash: Hex })[] = [],
  /** How many hops below the domain the grant reaches. Signed into the terms, so it is
   *  fixed for the life of the delegation. */
  maxDepth: number = DEFAULT_MAX_DEPTH,
  /** How much weight to lend. Undefined lends the whole balance, which is what a grant
   *  meant everything before an amount could be named. */
  amount?: bigint,
): Promise<{ delegation: Delegation & { hash: Hex }; relays: (Delegation & { hash: Hex }) | null }[]> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);

  const delegator = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  const signerAccount = config.accounts[from].smartAccount;

  // The manager walks a chain leaf to root and requires each link's delegator to be the
  // next one's delegate, so only an upstream that hands over to this signer can be relayed.
  const relayable = upstream.filter(
    (held) => held.delegate.toLowerCase() === signerAccount.toLowerCase(),
  );

  // One delegation per voice: the signer's own, plus one relaying each voice it was
  // lent. Bundling them into a single object would tie the signer's own voice to
  // authority it merely borrowed — revoking upstream would then silence a voice that
  // was never the upstream's to take back. A voice keeps belonging to whoever cast it.
  const authorities: Hex[] = [ROOT_AUTHORITY, ...relayable.map((held) => held.hash)];

  const signed: { delegation: Delegation & { hash: Hex }; relays: (Delegation & { hash: Hex }) | null }[] = [];
  for (const [index, authority] of authorities.entries()) {
    const delegation: Delegation = {
      delegate: config.accounts[to].smartAccount,
      delegator: signerAccount,
      authority,
      caveats: [
        {
          enforcer: config.enforcer,
          terms: encodeTerms({
            rootDomainId: domainId,
            predicateId: config.predicate.termId,
            maxDepth,
            expiry: 0n,
            attestor: config.attestor,
          }),
          args: "0x",
        },
      ],
      // disableDelegation blacklists a hash forever, so every delegation needs its own
      // salt — including the siblings signed in this same call.
      salt: toHex(BigInt(Date.now()) * 1000n + BigInt(index)),
      signature: "0x",
    };
    delegation.signature = await delegator.signDelegation({ delegation });
    const hash = await client.readContract({
      address: FRAMEWORK.delegationManager,
      abi: delegationManagerAbi,
      functionName: "getDelegationHash",
      args: [{ ...delegation, salt: BigInt(delegation.salt) }],
    });
    recordStep(
      {
        kind: "signature",
        actor: from,
        label:
          index === 0
            ? `${from} signs a delegation of “${domainLabel}” to ${to}`
            : `${from} signs a relay of the “${domainLabel}” voice it was lent`,
        detail:
          "An EIP-712 signature. Free, and nothing is sent: a delegation is an object that sits in a file until somebody redeems it.",
        calls: [
          {
            contract: "GraphDomainScope",
            address: config.enforcer,
            fn: "caveat terms — signed into the delegation, immutable from here",
            args: {
              // Named exactly as the redemption row names it, so the two can be matched
              // by eye when the delegate finally spends this signature.
              "delegation hash": hash,
              "signed scope": `“${domainLabel}”`,
              "hops allowed": String(maxDepth),
              attestor: config.attestor,
              authority: index === 0 ? "ROOT_AUTHORITY — stands on its own" : `${authority} — derives from it`,
            },
          },
        ],
      },
      { status: "done" },
    );
    // index 0 is the signer's own voice; the rest relay `relayable` in the same order.
    signed.push({ delegation: { ...delegation, hash }, relays: index === 0 ? null : (relayable[index - 1] ?? null) });
  }

  // The signatures say the delegate MAY vote on this domain; the governor's register says
  // how much weight it carries. Recording the transfer is what makes the delegator stop
  // counting on this domain and the delegate count for both. One transfer, however many
  // voices moved: the register tracks the holder, the signatures track the authority.
  const lending = amount ?? (await ownWeight(client, config, from));
  const op = await sendUserOp(
    client,
    submitterClient(config),
    delegator,
    [
      {
        to: config.governor,
        value: 0n,
        data: encodeFunctionData({
          abi: ozGovernorAbi,
          functionName: "delegateWeight",
          args: [config.accounts[to].smartAccount, domainId, lending],
        }),
      },
    ],
    {
      actor: from,
      label: `${from} hands its weight on “${domainLabel}” to ${to}`,
      detail:
        "The signatures say the delegate MAY vote; this says whose weight it carries. One transfer however many voices moved.",
      calls: [
        {
          contract: "OZGovernor",
          address: config.governor,
          fn: "delegateWeight(address,bytes32,uint256)",
          args: { delegate: `${to} · ${config.accounts[to].smartAccount}`, domain: domainLabel, amount: lending.toString() },
        },
      ],
    },
  );
  if (!op.success) {
    throw new Error(op.revert ? `weight transfer reverted: ${op.revert.formatted}` : "weight transfer reverted");
  }

  return signed;
}

/**
 * Clears a weight delegation on one domain, so it can be granted elsewhere.
 *
 * A domain has one holder at a time: the governor refuses a second grant while the first
 * stands, which is what stops weight being moved out from under a delegate silently.
 * Revoking is the way back.
 */
export async function revokeWeight(
  client: PublicClient,
  config: AppConfig,
  from: Role,
  domainLabel: string,
  /** Delegations to disable alongside the transfer — everything the signer granted here. */
  signatures: (Delegation & { hash: Hex })[] = [],
): Promise<UserOpResult> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  // One user operation for both halves. Clearing the register alone would leave the
  // signature usable, and disabling the signature alone would leave the weight parked
  // with the delegate — taking a domain back means both, so they travel together.
  return sendUserOp(
    client,
    submitterClient(config),
    account,
    [
      ...signatures.map((delegation) => ({
        to: FRAMEWORK.delegationManager,
        value: 0n,
        data: buildDisableCalldata(delegation),
      })),
      {
        to: config.governor,
        value: 0n,
        data: encodeFunctionData({
          abi: ozGovernorAbi,
          functionName: "delegateWeight",
          args: ["0x0000000000000000000000000000000000000000", domainId, 0n],
        }),
      },
    ],
    {
      actor: from,
      label: `${from} takes “${domainLabel}” back`,
      detail:
        "Both halves in one operation. Clearing the register alone would leave the signature usable; disabling the signature alone would leave the weight parked with the delegate. It does not un-cast a vote the delegate already made.",
      calls: [
        ...signatures.map((delegation) => ({
          contract: "DelegationManager",
          address: FRAMEWORK.delegationManager,
          fn: "disableDelegation(Delegation)",
          args: { hash: delegation.hash },
        })),
        {
          contract: "OZGovernor",
          address: config.governor,
          fn: "delegateWeight(address,bytes32,uint256)",
          args: { delegate: "0x0 — taken back", domain: domainLabel, amount: "0" },
        },
      ],
    },
  );
}


