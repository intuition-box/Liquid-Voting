/**
 * Self-bundled ERC-4337 user operations (ADR 0010): chain 13579 has no bundler, so a
 * funded EOA submits `EntryPoint.handleOps([op], beneficiary)` as a plain transaction.
 * The smart account signs its own operation and pre-pays gas; the submitter is refunded
 * as beneficiary. No relayer, no paymaster — the pattern the framework's own tests use.
 */
import {
  concatHex,
  decodeEventLog,
  pad,
  toHex,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import { entryPointAbi } from "./abis";
import { decodeRevert, type DecodedRevert } from "../delegation/encoding";
import { ensureEnvironment, type HybridAccount } from "./smart-accounts";

/** Gas set generously rather than estimated — there is no bundler to estimate (ADR 0010). */
const VERIFICATION_GAS_LIMIT = 500_000n;
const CALL_GAS_LIMIT = 2_000_000n;
const PRE_VERIFICATION_GAS = 100_000n;

export interface UserOpCall {
  to: `0x${string}`;
  value: bigint;
  data: Hex;
}

export interface UserOpResult {
  txHash: Hex;
  success: boolean;
  /** Decoded inner revert when the operation failed and the EntryPoint surfaced a reason. */
  revert: DecodedRevert | null;
  revertData: Hex | null;
}

export async function sendUserOp(
  publicClient: PublicClient,
  submitter: WalletClient<Transport, Chain, Account>,
  smartAccount: HybridAccount,
  calls: UserOpCall[],
): Promise<UserOpResult> {
  const environment = ensureEnvironment();
  const callData = await smartAccount.encodeCalls(calls);
  const nonce = await smartAccount.getNonce();
  const gasPrice = await publicClient.getGasPrice();
  const maxPriorityFeePerGas = gasPrice / 2n > 0n ? gasPrice / 2n : 1n;
  const maxFeePerGas = gasPrice * 2n + maxPriorityFeePerGas;

  const signature = await smartAccount.signUserOperation({
    sender: smartAccount.address,
    nonce,
    callData,
    callGasLimit: CALL_GAS_LIMIT,
    verificationGasLimit: VERIFICATION_GAS_LIMIT,
    preVerificationGas: PRE_VERIFICATION_GAS,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: "0x",
  });

  const packedOp = {
    sender: smartAccount.address,
    nonce,
    initCode: "0x" as Hex,
    callData,
    accountGasLimits: concatHex([
      pad(toHex(VERIFICATION_GAS_LIMIT), { size: 16 }),
      pad(toHex(CALL_GAS_LIMIT), { size: 16 }),
    ]),
    preVerificationGas: PRE_VERIFICATION_GAS,
    gasFees: concatHex([pad(toHex(maxPriorityFeePerGas), { size: 16 }), pad(toHex(maxFeePerGas), { size: 16 })]),
    paymasterAndData: "0x" as Hex,
    signature,
  };

  const txHash = await submitter.writeContract({
    address: environment.EntryPoint,
    abi: entryPointAbi,
    functionName: "handleOps",
    args: [[packedOp], submitter.account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  let success = false;
  let revertData: Hex | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== environment.EntryPoint.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: entryPointAbi, data: log.data, topics: log.topics });
      if (event.eventName === "UserOperationEvent") success = event.args.success;
      if (event.eventName === "UserOperationRevertReason") revertData = event.args.revertReason;
    } catch {
      // Logs from other ABIs (deposits, transfers) — not relevant here.
    }
  }
  return { txHash, success, revert: revertData ? decodeRevert(revertData) : null, revertData };
}
