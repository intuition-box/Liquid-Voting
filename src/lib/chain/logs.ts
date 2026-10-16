/**
 * Reading an event log once, and then only what is new.
 *
 * Logs are append-only. Below the chain head they do not change, so re-reading them from
 * the governor's deployment block on every refresh asks the node for several hundred
 * blocks of settled history in order to discover the two that moved. Measured, the two
 * log queries were 128 KB of a 167 KB refresh — three quarters of the traffic, nearly
 * all of it an answer we already had.
 *
 * So each query keeps what it has seen and asks only for the rest.
 *
 * It is not a cache in the sense that can go stale: nothing is ever served for a block
 * the node has not been asked about. The last few blocks are re-read every time and the
 * stored copy of them discarded, so a reorg at the head rewrites rather than duplicates.
 * Deeper than that margin a reorg would be missed — on a chain with a sequencer and a
 * demo that lives for minutes, that is a trade worth naming rather than defending.
 */
import type { PublicClient } from "viem";

/**
 * How far back to re-read on every call.
 *
 * Twelve L2 blocks is about eight seconds here. Long enough to cover the head moving
 * under a read, short enough that the re-read costs nothing.
 */
const REORG_MARGIN = 12n;

interface Seen {
  /** The head as of the last read. Everything up to here is held. */
  upTo: bigint;
  logs: { blockNumber: bigint }[];
}

const seen = new Map<string, Seen>();

/**
 * @param key      Identifies the query. Two callers sharing a key must be asking the
 *                 same question — same address, same event, same filter.
 * @param from     Where this log's history starts. Only used on the first read.
 * @param read     Performs the query from a given block to the head.
 */
export async function readLogsOnce<TLog extends { blockNumber: bigint }>(
  client: PublicClient,
  key: string,
  from: bigint,
  read: (fromBlock: bigint) => Promise<TLog[]>,
): Promise<TLog[]> {
  const held = seen.get(key);
  if (!held) {
    const logs = await read(from);
    seen.set(key, { upTo: await client.getBlockNumber(), logs });
    return logs;
  }

  // Re-read the margin rather than trusting it, and drop our copy of those blocks so the
  // fresh answer replaces them instead of landing beside them.
  const since = held.upTo > REORG_MARGIN + from ? held.upTo - REORG_MARGIN : from;
  const [fresh, head] = await Promise.all([read(since), client.getBlockNumber()]);
  const merged = [...held.logs.filter((log) => log.blockNumber < since), ...fresh];
  seen.set(key, { upTo: head, logs: merged });
  return merged as TLog[];
}

/**
 * Forgets everything read so far.
 *
 * For when the question itself changed — a new governor, a new session — rather than for
 * when the answer might have.
 */
export function forgetLogs(): void {
  seen.clear();
}
