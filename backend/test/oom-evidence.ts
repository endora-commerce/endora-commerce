/**
 * Whether an OOM killer took a process of this container, read from the kernel
 * rather than inferred from what the log does not say (issue #199).
 *
 * ## The gap this closes
 *
 * `test/run-completeness.ts` names the files a dead fork never ran, and its own
 * explanation of *why* the fork died is a disjunction it cannot resolve: the
 * fork exhausting its V8 old-space, which prints `FATAL ERROR: ... JavaScript
 * heap out of memory`, or the host killing it, which "prints nothing at all".
 * Choosing between them from a job log means arguing from **two absences** — no
 * V8 abort and no `[heap-headroom]` warning — and an argument from absence is
 * exactly what a reader cannot check.
 *
 * The kernel has been counting the thing all along, in the job container's own
 * cgroup. `memory.events` carries two counters and the pair discriminates:
 *
 *   - `oom_kill` — processes of this cgroup killed by an OOM killer of **any**
 *     kind, the system-wide one included;
 *   - `oom` — the number of times **this cgroup's own limit** triggered an OOM.
 *
 * So `oom 0` with `oom_kill 1` is a kill that came from outside this container,
 * and `memory.max: max` says the container had no limit that could have fired.
 * Measured on this project's runner, on `test:backend 4/5`: two concurrent
 * shards on the 7.6 GB host produce exactly that pair, while the identical job
 * run alone reports `oom_kill 0` and completes all 269 files.
 *
 * ## What it deliberately does not do
 *
 * It never guesses. Where there is no cgroup v2 to read — a developer machine,
 * a mac, cgroup v1, a sandbox that hides `/sys/fs/cgroup` — the verdict is
 * `unreadable` and it renders as the empty string, because a report that
 * silently downgrades "I could not look" to "nothing happened" is the failure
 * mode this whole file exists to remove.
 *
 * And it is read as a **delta**. `memory.events` is cumulative over the
 * container's life, so a `before_script` that lost a `tsc` to the OOM killer
 * would otherwise be reported as this run's evidence.
 */
import { readFileSync } from 'node:fs';

const CGROUP = '/sys/fs/cgroup';
const EVENTS = `${CGROUP}/memory.events`;
const MAX = `${CGROUP}/memory.max`;

const MB = 1024 * 1024;

export interface CgroupMemory {
  /** `oom_kill` — processes of this cgroup killed by any OOM killer. */
  readonly oomKills: number;
  /** `oom` — times this cgroup's own limit triggered an OOM. */
  readonly ownLimitOoms: number;
  /** `memory.max` in bytes, or null where the cgroup declares no limit. */
  readonly limitBytes: number | null;
}

export type OomVerdict =
  /** There was no cgroup v2 to read. Nothing is claimed either way. */
  | { readonly kind: 'unreadable' }
  /** The counter did not move: no process of this container was OOM-killed. */
  | { readonly kind: 'none' }
  | {
      readonly kind: 'killed';
      readonly kills: number;
      readonly by: 'cgroup-limit' | 'host';
      readonly limitBytes: number | null;
    };

/** Reads a file, or null for any reason it could not be read. */
export type FileReader = (path: string) => string | null;

export const defaultFileReader: FileReader = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

function counter(text: string, name: string): number | null {
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
 * The cgroup's memory accounting, or null when this process has no cgroup v2
 * view of itself — which includes a `memory.events` that carries neither
 * counter, since a file whose shape this does not recognise is one it has not
 * read.
 */
export function readCgroupMemory(read: FileReader = defaultFileReader): CgroupMemory | null {
  const events = read(EVENTS);
  if (events === null) return null;

  const oomKills = counter(events, 'oom_kill');
  const ownLimitOoms = counter(events, 'oom');
  if (oomKills === null || ownLimitOoms === null) return null;

  // `memory.max` reads `max` where the cgroup declares no limit, which is the
  // reading that makes a kill attributable to something outside the container.
  const max = read(MAX)?.trim();
  const parsed = max === undefined || max === '' || max === 'max' ? NaN : Number.parseInt(max, 10);

  return {
    oomKills,
    ownLimitOoms,
    limitBytes: Number.isFinite(parsed) ? parsed : null,
  };
}

export function oomVerdict(before: CgroupMemory | null, after: CgroupMemory | null): OomVerdict {
  if (before === null || after === null) return { kind: 'unreadable' };

  const kills = after.oomKills - before.oomKills;
  if (kills <= 0) return { kind: 'none' };

  const byOwnLimit = after.ownLimitOoms > before.ownLimitOoms;
  return {
    kind: 'killed',
    kills,
    by: byOwnLimit ? 'cgroup-limit' : 'host',
    limitBytes: after.limitBytes,
  };
}

export function renderOomVerdict(verdict: OomVerdict): string {
  if (verdict.kind === 'unreadable') return '';

  if (verdict.kind === 'none') {
    return (
      "The kernel says it was not memory: this container's `memory.events` counted no " +
      '`oom_kill` across the run, so no process of this container was killed by an OOM ' +
      'killer of any kind. Look for a process that exited on its own — a `process.exit`, a ' +
      'native abort, or a signal from outside the container.'
    );
  }

  const kills =
    `\`oom_kill\` moved by ${String(verdict.kills)}, so ${String(verdict.kills)} ` +
    `process${verdict.kills === 1 ? ' was' : 'es were'}`;

  if (verdict.by === 'cgroup-limit') {
    const limit =
      verdict.limitBytes === null
        ? 'its own limit'
        : `its own ${String(Math.round(verdict.limitBytes / MB))} MB limit`;
    return (
      `The kernel says it was memory: in this container's \`memory.events\`, ${kills} ` +
      `killed by an OOM killer across the run, and ${limit} is what fired (\`oom\` moved ` +
      'too). The job asked for more memory than the container is allowed.'
    );
  }

  const limit =
    verdict.limitBytes === null
      ? 'this container has no memory limit of its own (`memory.max: max`)'
      : `this container's own limit did not fire (\`oom\` did not move)`;
  return (
    `The kernel says it was memory, and that it came from outside: in this container's ` +
    `\`memory.events\`, ${kills} killed by an OOM killer across the run, while ${limit}. The host ran out of memory and its OOM killer chose the largest process on ` +
    'the box, which for this job is the vitest fork. Nothing this run can do to its own ' +
    'heap changes that — what has to change is how much of the host the job is sharing.'
  );
}
