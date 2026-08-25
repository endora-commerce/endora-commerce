/**
 * How many child processes a spawning test may run at once — derived from what
 * the machine has, never chosen by taste.
 *
 * ## Why it is derived
 *
 * `test/unit/scripts/check-read-size.test.ts` spawned eight checks at a time.
 * Eight was picked when nothing limited the container, and the number outlived
 * its premise: on the dedicated runner (4 GB) two of them were
 * SIGKILLed by the OOM killer before writing a byte. Any replacement chosen the
 * same way has the same expiry date — the container's limit, the runner's core
 * count and the cost of a check all move without anyone editing this file.
 *
 * So the pool is a **minimum of two bounds**, both read at the moment it
 * starts:
 *
 *   * **Memory.** Inside a container, cgroup v2's own accounting —
 *     `memory.max - memory.current`, plus the page cache the kernel drops before
 *     it kills anything — which is what `test/oom-evidence.ts` reads after the
 *     fact, asked before instead. Outside one, `process.availableMemory()`.
 *     Either way it is sampled at pool start, so the memory already charged to
 *     the sibling vitest forks (`vitest.unit.config.ts` runs four) is subtracted
 *     rather than assumed away.
 *   * **Cores.** `os.availableParallelism()`. Every check is a single-threaded
 *     `tsx` program that compiles a TypeScript program; more of them than there
 *     are cores buys queueing, not throughput.
 *
 * And it always leaves **one child's worth of headroom** — `- 1` below — for
 * what grows after the sample: a sibling fork loading another module graph, the
 * worker's own heap. That slack is expressed in the unit that was measured
 * rather than as a second invented constant.
 *
 * ## What it trades
 *
 * A smaller pool is a longer sweep, and nothing else: the estate is a set of
 * independent processes with no shared state. On a container tight enough to
 * produce a pool of 1 the whole sweep is the sum of its parts, which is what
 * the caller's hook timeout has to cover.
 */
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

const CGROUP = '/sys/fs/cgroup';
const MB = 1024 * 1024;

/** Reads a file, or null for any reason it could not be read. */
export type FileReader = (path: string) => string | null;

export const defaultFileReader: FileReader = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

export interface PoolInputs {
  /** Cores this process may use. */
  readonly cpus: number;
  /** Bytes it may still allocate, or null where nothing could be read. */
  readonly availableBytes: number | null;
  /** Peak resident cost of one child, measured. */
  readonly bytesPerChild: number;
}

/**
 * The pool size, as a pure function of the three inputs, so it can be proven
 * over a container's numbers without being inside one.
 *
 * A memory reading of `null` means "nothing was readable", and the answer is
 * the floor of 1 rather than a guess: a pool sized from an unknown is the
 * defect this file exists to remove.
 */
export function spawnPoolSize(inputs: PoolInputs): number {
  const { cpus, availableBytes, bytesPerChild } = inputs;
  if (availableBytes === null) return 1;
  const memoryBound = Math.floor(availableBytes / bytesPerChild) - 1;
  return Math.max(1, Math.min(cpus, memoryBound));
}

/** One counter of cgroup v2's `memory.stat`, or null where it is not there. */
function memoryStat(read: FileReader, name: string): number | null {
  const text = read(`${CGROUP}/memory.stat`);
  if (text === null) return null;
  for (const line of text.split('\n')) {
    const [key, value] = line.trim().split(/\s+/);
    if (key === name && value !== undefined) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * What this container may still allocate — `memory.max - memory.current`, plus
 * the page cache the kernel will drop before it OOMs anything.
 *
 * The `inactive_file` term is not generosity, it is accuracy: `memory.current`
 * counts page cache, a CI job reads a whole `node_modules` and a whole source
 * tree before this test runs, and cache charged to the cgroup is reclaimed
 * under pressure rather than causing a kill. Without it a container that had
 * merely *read* a lot would size the pool at its floor of one and add minutes
 * to every pipeline for memory nobody is short of. Only the **inactive** half is
 * added: it is the part the kernel evicts first, and the active half is left as
 * further slack.
 *
 * Null where there is no cgroup v2 view or the cgroup declares no limit — a
 * developer machine reads null here and rests on `process.availableMemory()`.
 */
export function cgroupHeadroomBytes(read: FileReader = defaultFileReader): number | null {
  const max = read(`${CGROUP}/memory.max`)?.trim();
  const current = read(`${CGROUP}/memory.current`)?.trim();
  if (max === undefined || current === undefined || max === '' || max === 'max') return null;
  const limit = Number.parseInt(max, 10);
  const used = Number.parseInt(current, 10);
  if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;
  const reclaimable = memoryStat(read, 'inactive_file') ?? 0;
  return Math.max(0, limit - used + Math.min(reclaimable, used));
}

/**
 * What libuv says this process may still allocate, or null where the runtime
 * cannot answer. It is the answer for a machine with no container limit of its
 * own; inside one, the reading above is preferred because libuv's counts the
 * page cache against the process and this does not.
 */
function processAvailableBytes(): number | null {
  if (typeof process.availableMemory !== 'function') return null;
  const bytes = process.availableMemory();
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

/** What this machine says right now. */
export function observedPoolInputs(
  bytesPerChild: number,
  read: FileReader = defaultFileReader,
): PoolInputs {
  return {
    cpus: availableParallelism(),
    availableBytes: cgroupHeadroomBytes(read) ?? processAvailableBytes(),
    bytesPerChild,
  };
}

/**
 * The sentence a failure prints beside itself. A pool that turned out to be too
 * large has to say what it thought it was doing, or the next reader is back to
 * arguing from the absence of a line.
 */
export function explainPool(inputs: PoolInputs, size: number): string {
  const megabytes = (bytes: number): string => `${String(Math.round(bytes / MB))} MB`;
  const memory =
    inputs.availableBytes === null
      ? 'no readable memory figure'
      : `${megabytes(inputs.availableBytes)} available`;
  return (
    `[spawn-pool] size=${String(size)} cpus=${String(inputs.cpus)} memory=${memory} ` +
    `per-child=${megabytes(inputs.bytesPerChild)} (one child's worth held back as headroom)`
  );
}
