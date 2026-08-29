/**
 * A fork that disappeared says whether an OOM killer took it (issue #199).
 *
 * The completeness report could name the files that never ran and could not say
 * why. Its own text admitted the gap: "the fork exhausting its V8 old-space
 * (which prints `FATAL ERROR: ...`) and the host killing it for memory (which
 * prints nothing at all)". Choosing between those two was an inference from
 * **two absences** — no V8 abort, no `[heap-headroom]` line — and it cost a day
 * of pipeline archaeology to turn into a statement.
 *
 * The kernel has been counting it all along. `memory.events` in the job
 * container's own cgroup carries two counters, and the pair discriminates:
 *
 *   - `oom_kill` — processes of this cgroup killed by an OOM killer of **any**
 *     kind, the global one included;
 *   - `oom` — times this cgroup's **own** limit triggered an OOM.
 *
 * Measured on the runner, on `test:backend 4/5`: two concurrent shards produce
 * `oom 0` / `oom_kill 1` with `memory.max: max`, which is a host-wide kill of a
 * container that has no limit of its own. The identical job run alone produces
 * `oom_kill 0` and completes all 269 files.
 *
 * Every case below hands the analysis its input at the top — the raw file text,
 * or a reader that refuses — never a parsed record, because a fixture entering
 * below the parser cannot catch a parser that stops reading these files.
 */
import { describe, expect, it } from 'vitest';

import {
  oomVerdict,
  readCgroupMemory,
  renderOomVerdict,
  type CgroupMemory,
} from '../../oom-evidence.js';

const EVENTS = ['low 0', 'high 0', 'max 0', 'oom 0', 'oom_kill 0', 'oom_group_kill 0'].join('\n');

function reader(files: Readonly<Record<string, string>>): (path: string) => string | null {
  return (path) => files[path] ?? null;
}

describe('readCgroupMemory', () => {
  it('reads both counters and the limit out of cgroup v2 files', () => {
    const seen = readCgroupMemory(
      reader({
        '/sys/fs/cgroup/memory.events': EVENTS.replace('oom_kill 0', 'oom_kill 3'),
        '/sys/fs/cgroup/memory.max': '2147483648\n',
      }),
    );

    expect(seen).toEqual({ oomKills: 3, ownLimitOoms: 0, limitBytes: 2_147_483_648 });
  });

  it('reads `max` as no limit at all, which is what makes a kill attributable to the host', () => {
    const seen = readCgroupMemory(
      reader({ '/sys/fs/cgroup/memory.events': EVENTS, '/sys/fs/cgroup/memory.max': 'max\n' }),
    );

    expect(seen?.limitBytes).toBeNull();
    expect(seen?.oomKills).toBe(0);
  });

  it('is null where there is no cgroup v2 to read — a developer machine, a mac, cgroup v1', () => {
    expect(readCgroupMemory(reader({}))).toBeNull();
  });

  it('is null when the counters file is there but carries neither counter', () => {
    expect(
      readCgroupMemory(reader({ '/sys/fs/cgroup/memory.events': 'low 0\nhigh 0\n' })),
    ).toBeNull();
  });
});

describe('oomVerdict', () => {
  const clean: CgroupMemory = { oomKills: 0, ownLimitOoms: 0, limitBytes: null };

  it('says nothing can be said when the cgroup could not be read', () => {
    expect(oomVerdict(null, null).kind).toBe('unreadable');
    expect(oomVerdict(clean, null).kind).toBe('unreadable');
  });

  it('is `none` when the counter did not move across the run', () => {
    expect(oomVerdict(clean, clean).kind).toBe('none');
  });

  /**
   * The baseline matters: `memory.events` is cumulative for the container's
   * whole life, and a job's `before_script` can legitimately have lost a `tsc`
   * to the OOM killer before vitest ever started.
   */
  it('counts only the kills this run added, not the ones the container arrived with', () => {
    const before: CgroupMemory = { oomKills: 2, ownLimitOoms: 0, limitBytes: null };
    const after: CgroupMemory = { oomKills: 2, ownLimitOoms: 0, limitBytes: null };

    expect(oomVerdict(before, after).kind).toBe('none');
  });

  it('attributes a kill to the host when this cgroup has no limit of its own', () => {
    const after: CgroupMemory = { oomKills: 1, ownLimitOoms: 0, limitBytes: null };
    const seen = oomVerdict(clean, after);

    expect(seen).toEqual({ kind: 'killed', kills: 1, by: 'host', limitBytes: null });
  });

  it("attributes a kill to this container's own limit when that limit is what fired", () => {
    const before: CgroupMemory = { oomKills: 0, ownLimitOoms: 0, limitBytes: 2_147_483_648 };
    const after: CgroupMemory = { oomKills: 1, ownLimitOoms: 1, limitBytes: 2_147_483_648 };
    const seen = oomVerdict(before, after);

    expect(seen).toEqual({
      kind: 'killed',
      kills: 1,
      by: 'cgroup-limit',
      limitBytes: 2_147_483_648,
    });
  });

  /**
   * A limit that exists and did not fire is still a host kill, and saying so is
   * the difference between raising the limit and moving the job.
   */
  it('is a host kill even where a limit exists, when that limit is not what fired', () => {
    const before: CgroupMemory = { oomKills: 0, ownLimitOoms: 0, limitBytes: 4_294_967_296 };
    const after: CgroupMemory = { oomKills: 1, ownLimitOoms: 0, limitBytes: 4_294_967_296 };

    expect(oomVerdict(before, after)).toEqual({
      kind: 'killed',
      kills: 1,
      by: 'host',
      limitBytes: 4_294_967_296,
    });
  });
});

describe('renderOomVerdict', () => {
  it('says nothing at all when nothing can be said, so silence is never a claim', () => {
    expect(renderOomVerdict({ kind: 'unreadable' })).toBe('');
  });

  it('states positively that no OOM killer took a process of this container', () => {
    const text = renderOomVerdict({ kind: 'none' });

    expect(text).toContain('oom_kill');
    expect(text).toMatch(/no process of this container/i);
  });

  it('names the host, the counter and the absent limit when the host did it', () => {
    const text = renderOomVerdict({ kind: 'killed', kills: 1, by: 'host', limitBytes: null });

    expect(text).toContain('oom_kill');
    expect(text).toMatch(/host/i);
    expect(text).toMatch(/no memory limit of its own/i);
  });

  it("names the container's own limit, in MB, when that is what fired", () => {
    const text = renderOomVerdict({
      kind: 'killed',
      kills: 1,
      by: 'cgroup-limit',
      limitBytes: 2_147_483_648,
    });

    expect(text).toMatch(/2048 MB/);
    expect(text).not.toMatch(/host ran out/i);
  });
});
