/**
 * Self-bundled ERC-4337 user operations (ADR 0010): no bundler exists on 13579, so a
 * funded EOA submits `EntryPoint.handleOps([op], beneficiary)` as a plain transaction.
 * The smart account signs and pre-pays its own gas; the submitter is refunded.
 */
import {
  concatHex,
  decodeEventLog,
  pad,
  toHex,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
  type Chain,
} from "viem";
import type { MetaMaskSmartAccount, Implementation } from "@metamask/smart-accounts-kit";

import { ensureEnvironment } from "./kit";

const entryPointAbi = [
  {
    type: "function",
    name: "handleOps",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "ops",
        type: "tuple[]",
        components: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "initCode", type: "bytes" },
          { name: "callData", type: "bytes" },
          { name: "accountGasLimits", type: "bytes32" },
          { name: "preVerificationGas", type: "uint256" },
          { name: "gasFees", type: "bytes32" },
          { name: "paymasterAndData", type: "bytes" },
          { name: "signature", type: "bytes" },
        ],
      },
      { name: "beneficiary", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "UserOperationEvent",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "paymaster", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "actualGasCost", type: "uint256", indexed: false },
      { name: "actualGasUsed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UserOperationRevertReason",
    inputs: [
      { name: "userOpHash", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "revertReason", type: "bytes", indexed: false },
    ],
  },
] as const;

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
  /** ABI-encoded inner revert data when success is false and the EntryPoint surfaced one. */
  revertReason: Hex | null;
}

/** Signs `calls` as one user operation from `smartAccount` and submits it via handleOps. */
export async function sendUserOp(
  publicClient: PublicClient,
  submitter: WalletClient<Transport, Chain, Account>,
  smartAccount: MetaMaskSmartAccount<Implementation.Hybrid>,
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
    ]) as Hex,
    preVerificationGas: PRE_VERIFICATION_GAS,
    gasFees: concatHex([
      pad(toHex(maxPriorityFeePerGas), { size: 16 }),
      pad(toHex(maxFeePerGas), { size: 16 }),
    ]) as Hex,
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
  let revertReason: Hex | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== environment.EntryPoint.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: entryPointAbi, data: log.data, topics: log.topics });
      if (event.eventName === "UserOperationEvent") success = event.args.success;
      if (event.eventName === "UserOperationRevertReason") revertReason = event.args.revertReason;
    } catch {
      // Non-EntryPoint-ABI log (deposit events etc.) — irrelevant here.
    }
  }
  return { txHash, success, revertReason };
}
