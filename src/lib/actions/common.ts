/**
 * What every action needs before it can touch the chain: the owner key it signs with, and
 * the funded EOA that submits the user operation (ADR 0010).
 */
import { createWalletClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { intuitionTestnet } from "../chain/network";
import type { AppConfig } from "../config/app-config";
import type { Role } from "../roles";

/**
 * Narrows an owner key at the point of use. Lives here rather than in app-config so this
 * module stays importable from Node/bun scripts — app-config is browser-only.
 */
export function requireOwnerKey(config: AppConfig, role: Role): `0x${string}` {
  const key = config.ownerKeys[role];
  if (!key) throw new Error(`no ${role} owner key — this is a read-only build (see ADR 0011)`);
  return key;
}

/** The funded EOA that pays for and submits a user operation. */
export function submitterClient(config: AppConfig) {
  return createWalletClient({
    chain: intuitionTestnet,
    transport: http(config.rpcUrl),
    account: privateKeyToAccount(config.submitterKey),
  });
}

/** Hop cap written into every delegation signed from the UI — deep enough for the graph. */
/** Hops a grant reaches below its domain unless the signer says otherwise. Five clears
 *  the demo tree, whose deepest branch is four hops from the root. */
export const DEFAULT_MAX_DEPTH = 5;

export type { PublicClient };
