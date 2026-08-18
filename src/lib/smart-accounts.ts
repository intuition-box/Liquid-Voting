import {
  getSmartAccountsEnvironment,
  toMetaMaskSmartAccount,
  Implementation,
  type MetaMaskSmartAccount,
  type SmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import { overrideDeployedEnvironment } from "@metamask/smart-accounts-kit/utils";
import type { PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

import { intuitionTestnet } from "./chain";

export type HybridAccount = MetaMaskSmartAccount<Implementation.Hybrid>;

let environmentInjected = false;

/**
 * The SDK's deployments map does not know chain 13579. The Delegation Framework is
 * CREATE2-deployed, so chain 1's v1.3.0 environment carries byte-identical addresses —
 * each one verified present on 13579 in Phase 0.a (ADR 0002). Inject once per process.
 */
export function ensureEnvironment(): SmartAccountsEnvironment {
  if (!environmentInjected) {
    overrideDeployedEnvironment(intuitionTestnet.id, "1.3.0", getSmartAccountsEnvironment(1, "1.3.0"));
    environmentInjected = true;
  }
  return getSmartAccountsEnvironment(intuitionTestnet.id, "1.3.0");
}

/** Hybrid smart account owned by a single EOA signer (deploySalt 0x, no passkeys). */
export async function toHybridAccount(client: PublicClient, owner: PrivateKeyAccount): Promise<HybridAccount> {
  ensureEnvironment();
  return toMetaMaskSmartAccount({
    client,
    implementation: Implementation.Hybrid,
    deployParams: [owner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: owner },
  });
}
