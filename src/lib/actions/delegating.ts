/**
 * Handing a domain on, and taking it back: signing the delegations and recording the
 * weight transfer at the governor.
 */
import { encodeFunctionData, toHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROOT_AUTHORITY } from "@metamask/smart-accounts-kit";

import { delegationManagerAbi, governorAbi } from "../chain/abis";
import { FRAMEWORK } from "../chain/network";
import { toHybridAccount } from "../chain/smart-accounts";
import { sendUserOp, type UserOpResult } from "../chain/user-op";
import type { AppConfig } from "../config/app-config";
import { buildDisableCalldata, encodeTerms, type Delegation } from "../delegation/encoding";
import type { Role } from "../roles";

import { DEFAULT_MAX_DEPTH, requireOwnerKey, submitterClient } from "./common";

export async function signDelegation(
  client: PublicClient,
  config: AppConfig,
  from: Role,
  to: Role,
  domainLabel: string,
  /** The domain and its parents, so the governor can refuse one already covered. */
  domainPath: Hex[] = [],
  /** The delegations the signer already holds on this domain, one per voice it carries. */
  upstream: (Delegation & { hash: Hex })[] = [],
): Promise<(Delegation & { hash: Hex })[]> {
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

  const signed: (Delegation & { hash: Hex })[] = [];
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
            maxDepth: DEFAULT_MAX_DEPTH,
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
    signed.push({ ...delegation, hash });
  }

  // The signatures say the delegate MAY vote on this domain; the governor's register says
  // whose weight it carries. Recording the transfer is what makes the delegator stop
  // counting on this domain and the delegate count for both. One transfer, however many
  // voices moved: the register tracks the holder, the signatures track the authority.
  const op = await sendUserOp(client, submitterClient(config), delegator, [
    {
      to: config.governor,
      value: 0n,
      data: encodeFunctionData({
        abi: governorAbi,
        functionName: "delegateWeight",
        args: [config.accounts[to].smartAccount, domainId, domainPath],
      }),
    },
  ]);
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
): Promise<UserOpResult> {
  const domainId = config.nodes.find((node) => node.label === domainLabel)?.termId;
  if (!domainId) throw new Error(`unknown domain “${domainLabel}”`);
  const account = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, from)));
  return sendUserOp(client, submitterClient(config), account, [
    {
      to: config.governor,
      value: 0n,
      data: encodeFunctionData({
        abi: governorAbi,
        functionName: "delegateWeight",
        args: ["0x0000000000000000000000000000000000000000", domainId, []],
      }),
    },
  ]);
}

/** The voter disables its root delegation — framework-native, kills the whole chain. */
export async function revokeRoot(client: PublicClient, config: AppConfig): Promise<UserOpResult> {
  const voter = await toHybridAccount(client, privateKeyToAccount(requireOwnerKey(config, "voter")));
  return sendUserOp(client, submitterClient(config), voter, [
    { to: FRAMEWORK.delegationManager, value: 0n, data: buildDisableCalldata(config.delegations.root) },
  ]);
}


/** Lifecycle states, in the governor's enum order. */
