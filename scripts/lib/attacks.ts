/**
 * The attacks that were open, replayed against the contracts actually deployed.
 *
 * Why this exists next to the Foundry regressions rather than instead of them: a test
 * suite proves the source refuses, and says nothing about what sits at the address in
 * the manifest. The two come apart exactly when it matters — a green suite beside a
 * stale deployment — so each attack is also sent to the chain, as an `eth_call`. No
 * transaction, no gas, no state touched, and a revert is the pass.
 *
 * Every one of these returned a success before it was fixed. The first returned `100`:
 * an address holding no tokens and no delegation, casting A's entire weight against it.
 */
import { encodeAbiParameters, encodeFunctionData, keccak256, toBytes, type Hex, type PublicClient } from "viem";

import { ozGovernorAbi, scopeProposalAbi } from "../../src/lib/chain/abis";
import type { AppConfig } from "../../src/lib/config/app-config";
import type { ProposalRecord } from "../../src/lib/actions";

/** An address with no tokens, no delegation and no business voting. */
const STRANGER = "0x000000000000000000000000000000000000dEaD" as const;
/** A domain that does not exist, so a success could only come from a missing check. */
const BOGUS_DOMAIN = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;

export interface AttackProbe {
  label: string;
  closed: boolean;
  /** The error that refused it, or what came back instead. */
  error: string;
}

/** The 4-byte selector of a custom error, which is how a revert names itself. */
function selectorOf(signature: string): string {
  return keccak256(toBytes(signature)).slice(0, 10);
}

/**
 * Everything the node said about a failure, flattened.
 *
 * The revert payload can arrive on the error, on its cause, or only inside the RPC's own
 * message — so rather than guess which, this walks the chain and concatenates. The
 * selector is then a substring search, which is what makes the check indifferent to how
 * any particular node formats its errors.
 */
function describe(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && current !== undefined; depth++) {
    const record = current as Record<string, unknown>;
    for (const key of ["shortMessage", "details", "message", "data"]) {
      const value = record[key];
      if (typeof value === "string") parts.push(value);
      else if (value && typeof value === "object" && typeof (value as { data?: unknown }).data === "string") {
        parts.push((value as { data: string }).data);
      }
    }
    current = record["cause"];
  }
  return parts.join(" | ");
}

/** Sends one call that must revert, and says whether it reverted for the named reason. */
async function mustRevert(
  client: PublicClient,
  label: string,
  errorSignature: string,
  call: { to: Hex; data: Hex; from: Hex },
): Promise<AttackProbe> {
  const selector = selectorOf(errorSignature);
  const named = errorSignature.slice(0, errorSignature.indexOf("("));
  try {
    const { data } = await client.call({ account: call.from, to: call.to, data: call.data });
    // No revert at all. Whatever came back, the check is not there.
    return { label, closed: false, error: `it SUCCEEDED and returned ${data ?? "nothing"}` };
  } catch (error) {
    const reported = describe(error);
    if (reported.includes(selector)) return { label, closed: true, error: `${named}()` };
    return { label, closed: false, error: `reverted, but not with ${named} (${selector}): ${reported.slice(0, 160)}` };
  }
}

/**
 * The four probes. Read-only, so this is safe to run before a presentation.
 *
 * `proposals` supplies a live target: the first two need an open proposal to vote on, and
 * the third needs one that exists so the refusal comes from the authorization check
 * rather than from the proposal being absent.
 */
export async function probeClosedAttacks(
  client: PublicClient,
  config: AppConfig,
  proposals: ProposalRecord[],
): Promise<AttackProbe[]> {
  const open = proposals.find((proposal) => proposal.state === "active");
  if (!open) {
    return [{
      label: "the closed attacks could not be replayed",
      closed: false,
      error: "no open proposal to aim them at — run `bun run reset`",
    }];
  }

  const voter = config.accounts["A"].smartAccount;

  return [
    // Before the fix this returned 100: a full governance takeover, by anyone, for free.
    await mustRevert(client, "a stranger cannot cast A's weight", "NotEntitledToVoteFor(address,address)", {
      to: config.governor,
      from: STRANGER,
      data: encodeFunctionData({
        abi: ozGovernorAbi,
        functionName: "castVoteFor",
        args: [open.id, 0, voter, [], []],
      }),
    }),

    // Naming a domainless proposal in the params used to return the raw token balance,
    // with the lending unsubtracted and the ledger recording nothing.
    await mustRevert(client, "the params cannot name another proposal", "ProposalMismatch(uint256,uint256)", {
      to: config.governor,
      from: voter,
      data: encodeFunctionData({
        abi: ozGovernorAbi,
        functionName: "castVoteWithReasonAndParams",
        args: [
          open.id,
          1,
          "",
          encodeAbiParameters(
            [{ type: "uint256" }, { type: "bytes32[]" }, { type: "address[]" }],
            [1n, [], []],
          ),
        ],
      }),
    }),

    // Scoping was open to anyone and written once, so a watcher could fix a proposal to
    // a domain whose delegates have nothing to do with it, permanently.
    await mustRevert(client, "a stranger cannot scope a proposal", "NotTheProposer(address,address)", {
      to: config.governor,
      from: STRANGER,
      data: encodeFunctionData({
        abi: scopeProposalAbi,
        functionName: "scopeProposal",
        args: [open.id, BOGUS_DOMAIN],
      }),
    }),

    // And the resolver takes nothing from anyone but the governor, so going around it
    // fails too. A proposal id that does not exist, since this check runs first.
    await mustRevert(client, "and cannot write straight to the resolver", "NotTheGovernor(address)", {
      to: config.resolver,
      from: STRANGER,
      data: encodeFunctionData({
        abi: scopeProposalAbi,
        functionName: "scopeProposal",
        args: [424242n, BOGUS_DOMAIN],
      }),
    }),
  ];
}
