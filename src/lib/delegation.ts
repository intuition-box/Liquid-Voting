import {
  decodeAbiParameters,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  type PublicClient,
} from "viem";

import { delegationManagerAbi, governorAbi, revertAbi } from "./abis";
import { FRAMEWORK } from "./chain";

/** Execution mode: single call, default (non-try) — ERC-7579 encoding. */
export const SINGLE_DEFAULT_MODE = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export interface Caveat {
  enforcer: `0x${string}`;
  terms: Hex;
  args: Hex;
}

export interface Delegation {
  delegate: `0x${string}`;
  delegator: `0x${string}`;
  authority: Hex;
  caveats: Caveat[];
  salt: Hex;
  signature: Hex;
}

export interface EnforcerTerms {
  rootDomainId: Hex;
  predicateId: Hex;
  maxDepth: number;
  expiry: bigint;
  attestor: `0x${string}`;
}

const termsAbi = [
  { type: "bytes32", name: "rootDomainId" },
  { type: "bytes32", name: "predicateId" },
  { type: "uint8", name: "maxDepth" },
  { type: "uint64", name: "expiry" },
  { type: "address", name: "attestor" },
] as const;

export function encodeTerms(terms: EnforcerTerms): Hex {
  return encodeAbiParameters(termsAbi, [
    terms.rootDomainId,
    terms.predicateId,
    terms.maxDepth,
    terms.expiry,
    terms.attestor,
  ]);
}

export function decodeTerms(encoded: Hex): EnforcerTerms {
  const [rootDomainId, predicateId, maxDepth, expiry, attestor] = decodeAbiParameters(termsAbi, encoded);
  return { rootDomainId, predicateId, maxDepth, expiry, attestor };
}

export function encodePathWitness(path: Hex[]): Hex {
  return encodeAbiParameters([{ type: "bytes32[]" }], [path]);
}

/** ERC-7579 single execution: abi.encodePacked(target, value, callData). */
function encodeSingleExecution(target: `0x${string}`, value: bigint, callData: Hex): Hex {
  const valueHex = value.toString(16).padStart(64, "0");
  return `0x${target.slice(2)}${valueHex}${callData.slice(2)}` as Hex;
}

/** Delegation[] encoding used by `_permissionContexts` (leaf → root order). */
function encodeDelegations(chain: Delegation[]): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple[]",
        components: [
          { name: "delegate", type: "address" },
          { name: "delegator", type: "address" },
          { name: "authority", type: "bytes32" },
          {
            name: "caveats",
            type: "tuple[]",
            components: [
              { name: "enforcer", type: "address" },
              { name: "terms", type: "bytes" },
              { name: "args", type: "bytes" },
            ],
          },
          { name: "salt", type: "uint256" },
          { name: "signature", type: "bytes" },
        ],
      },
    ],
    [chain.map((d) => ({ ...d, salt: BigInt(d.salt) }))],
  );
}

export interface RedeemParams {
  /** Delegation chain, leaf → root. */
  chain: Delegation[];
  /** Path witness per chain entry, same order. */
  witnesses: Hex[][];
  governor: `0x${string}`;
  domainId: Hex;
  description: string;
}

/**
 * Builds the `redeemDelegations` calldata, attaching each level's path witness to its
 * caveat `args`. `args` sits outside the signed delegation hash by design — the enforcer
 * verifies it hop by hop against live chain state rather than trusting it (ADR 0003).
 */
export function buildRedeemCalldata({ chain, witnesses, governor, domainId, description }: RedeemParams): Hex {
  const withWitnesses = chain.map((delegation, index) => ({
    ...delegation,
    caveats: delegation.caveats.map((caveat) => ({ ...caveat, args: encodePathWitness(witnesses[index] ?? []) })),
  }));
  const execution = encodeSingleExecution(
    governor,
    0n,
    encodeFunctionData({ abi: governorAbi, functionName: "propose", args: [domainId, description] }),
  );
  return encodeFunctionData({
    abi: delegationManagerAbi,
    functionName: "redeemDelegations",
    args: [[encodeDelegations(withWitnesses)], [SINGLE_DEFAULT_MODE], [execution]],
  });
}

export function buildDisableCalldata(delegation: Delegation): Hex {
  return encodeFunctionData({
    abi: delegationManagerAbi,
    functionName: "disableDelegation",
    args: [{ ...delegation, salt: BigInt(delegation.salt) }],
  });
}

/** Pulls revert data out of a nested viem error chain. */
function extractRevertData(error: unknown): Hex | null {
  let current: unknown = error;
  while (current && typeof current === "object") {
    const candidate = current as { data?: unknown; cause?: unknown };
    if (typeof candidate.data === "string" && candidate.data.startsWith("0x") && candidate.data.length > 2) {
      return candidate.data as Hex;
    }
    current = candidate.cause;
  }
  return null;
}

export interface DecodedRevert {
  name: string;
  args: string[];
  formatted: string;
}

export function decodeRevert(data: Hex): DecodedRevert | null {
  try {
    const decoded = decodeErrorResult({ abi: revertAbi, data });
    const args = (decoded.args ?? []).map(String);
    return { name: decoded.errorName, args, formatted: `${decoded.errorName}(${args.join(", ")})` };
  } catch {
    return null;
  }
}

export type PreflightResult =
  | { ok: true }
  | { ok: false; revert: DecodedRevert | null; raw: string };

/**
 * Simulates the redemption with `eth_call` from the redeeming smart account: the full
 * live path runs — signature validation, every enforcer hook — and the specific revert
 * surfaces, with no gas spent. This is what makes a failing demo case legible.
 */
export async function preflightRedeem(
  client: PublicClient,
  from: `0x${string}`,
  calldata: Hex,
): Promise<PreflightResult> {
  try {
    await client.call({ to: FRAMEWORK.delegationManager, data: calldata, account: from });
    return { ok: true };
  } catch (error) {
    const data = extractRevertData(error);
    return {
      ok: false,
      revert: data ? decodeRevert(data) : null,
      raw: error instanceof Error ? error.message.split("\n")[0] ?? String(error) : String(error),
    };
  }
}

export async function isDelegationDisabled(client: PublicClient, delegationHash: Hex): Promise<boolean> {
  return client.readContract({
    address: FRAMEWORK.delegationManager,
    abi: delegationManagerAbi,
    functionName: "disabledDelegations",
    args: [delegationHash],
  });
}
