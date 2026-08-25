import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';

import {
  cgroupHeadroomBytes,
  explainPool,
  observedPoolInputs,
  spawnPoolSize,
  type FileReader,
} from '../../helpers/spawn-pool.js';

/**
 * The pool `check-read-size.test.ts` spawns its checks in, proven over the
 * numbers of the container that killed two of them.
 *
 * The arithmetic is a pure function precisely so it can be measured against a
 * 4 GB container from a machine that is not one (issue #130's rule: the fixture
 * enters at the top of the analysis). Its two inputs are read from the kernel
 * at pool start — `os.availableMemory()`, intersected with cgroup v2's
 * `memory.max - memory.current` where that is readable.
 */

const MB = 1024 * 1024;
const PER_CHILD = 800 * MB;

/** A cgroup that answers whatever the test says it answers. */
function cgroup(files: Readonly<Record<string, string>>): FileReader {
  return (path) => files[path] ?? null;
}

describe('the pool the runner could actually hold', () => {
  it('refuses the eight that were killed, on that container', () => {
    // The runner: a 4 GB container, four vitest forks of `test:unit:fast`
    // already resident. Whatever is left is what a pool may spend.
    const inputs = { cpus: 4, availableBytes: 2400 * MB, bytesPerChild: PER_CHILD };

    const size = spawnPoolSize(inputs);

    expect(size).toBe(2);
    // The measured cost of the eight heaviest is 5026 MB — the arithmetic that
    // was never done when `8` was written down.
    expect(size * 800).toBeLessThan(2400);
  });

  it('holds one child back rather than filling the container to its brim', () => {
    // Exactly three would fit; the pool takes two, so the sibling fork that
    // grows after the sample does not land on a full container.
    expect(spawnPoolSize({ cpus: 16, availableBytes: 2400 * MB, bytesPerChild: PER_CHILD })).toBe(2);
  });

  it('is bounded by cores where memory is plentiful', () => {
    expect(spawnPoolSize({ cpus: 4, availableBytes: 64000 * MB, bytesPerChild: PER_CHILD })).toBe(4);
  });

  it('never falls below one, however tight the container', () => {
    expect(spawnPoolSize({ cpus: 8, availableBytes: 100 * MB, bytesPerChild: PER_CHILD })).toBe(1);
    expect(spawnPoolSize({ cpus: 8, availableBytes: 0, bytesPerChild: PER_CHILD })).toBe(1);
  });

  it('takes the floor rather than a guess when nothing could be read', () => {
    expect(spawnPoolSize({ cpus: 16, availableBytes: null, bytesPerChild: PER_CHILD })).toBe(1);
  });

  it('follows the measured cost of a child', () => {
    const cheap = spawnPoolSize({ cpus: 16, availableBytes: 8000 * MB, bytesPerChild: 100 * MB });
    const dear = spawnPoolSize({ cpus: 16, availableBytes: 8000 * MB, bytesPerChild: 2000 * MB });
    expect(cheap).toBeGreaterThan(dear);
  });
});

describe('what the container says about itself', () => {
  it('reads cgroup v2 headroom as the limit minus what is charged', () => {
    const read = cgroup({
      '/sys/fs/cgroup/memory.max': `${String(4 * 1024 * MB)}\n`,
      '/sys/fs/cgroup/memory.current': `${String(1600 * MB)}\n`,
    });

    expect(cgroupHeadroomBytes(read)).toBe(2496 * MB);
  });

  it('reads a container with no limit of its own as no answer', () => {
    const read = cgroup({
      '/sys/fs/cgroup/memory.max': 'max\n',
      '/sys/fs/cgroup/memory.current': `${String(1600 * MB)}\n`,
    });

    expect(cgroupHeadroomBytes(read)).toBeNull();
  });

  it('reads no cgroup v2 at all as no answer, never as no headroom', () => {
    expect(cgroupHeadroomBytes(cgroup({}))).toBeNull();
  });

  it('never reports negative headroom for a cgroup over its limit', () => {
    const read = cgroup({
      '/sys/fs/cgroup/memory.max': `${String(1024 * MB)}\n`,
      '/sys/fs/cgroup/memory.current': `${String(2048 * MB)}\n`,
    });

    expect(cgroupHeadroomBytes(read)).toBe(0);
  });

  it('counts the page cache the kernel would drop as headroom, not as usage', () => {
    // A CI job reads a whole `node_modules` before this test runs, and that
    // cache is charged to `memory.current`. Counting it as memory the container
    // is short of sizes the pool at its floor for memory nobody needs back.
    const read = cgroup({
      '/sys/fs/cgroup/memory.max': `${String(4 * 1024 * MB)}\n`,
      '/sys/fs/cgroup/memory.current': `${String(3 * 1024 * MB)}\n`,
      '/sys/fs/cgroup/memory.stat': ['anon 2147483648', `inactive_file ${String(900 * MB)}`, ''].join(
        '\n',
      ),
    });

    expect(cgroupHeadroomBytes(read)).toBe(1024 * MB + 900 * MB);
  });

  it('never credits more reclaimable cache than the cgroup is using', () => {
    const read = cgroup({
      '/sys/fs/cgroup/memory.max': `${String(4 * 1024 * MB)}\n`,
      '/sys/fs/cgroup/memory.current': `${String(100 * MB)}\n`,
      '/sys/fs/cgroup/memory.stat': `inactive_file ${String(8 * 1024 * MB)}\n`,
    });

    expect(cgroupHeadroomBytes(read)).toBe(4 * 1024 * MB);
  });

  it("prefers the container's own accounting to libuv's", () => {
    // libuv answers the same question with the page cache counted against the
    // process, and — were it ever to report the *host* from inside a container
    // — with memory this cgroup may not have. The cgroup is the closer author.
    const inputs = observedPoolInputs(
      PER_CHILD,
      cgroup({
        '/sys/fs/cgroup/memory.max': `${String(4 * 1024 * MB)}\n`,
        '/sys/fs/cgroup/memory.current': `${String(3 * 1024 * MB)}\n`,
      }),
    );

    expect(inputs.availableBytes).toBe(1024 * MB);
    expect(inputs.cpus).toBe(availableParallelism());
  });

  it('rests on libuv where there is no cgroup to intersect with', () => {
    const inputs = observedPoolInputs(PER_CHILD, cgroup({}));

    expect(inputs.availableBytes).toBeGreaterThan(0);
  });
});

describe('the pool says what it thought it was doing', () => {
  it('prints the two bounds and the divisor', () => {
    const inputs = { cpus: 4, availableBytes: 2400 * MB, bytesPerChild: PER_CHILD };

    const note = explainPool(inputs, spawnPoolSize(inputs));

    expect(note).toContain('size=2');
    expect(note).toContain('cpus=4');
    expect(note).toContain('2400 MB available');
    expect(note).toContain('per-child=800 MB');
  });

  it('says so when there was no memory figure at all', () => {
    const inputs = { cpus: 4, availableBytes: null, bytesPerChild: PER_CHILD };

    expect(explainPool(inputs, spawnPoolSize(inputs))).toContain('no readable memory figure');
  });
});
