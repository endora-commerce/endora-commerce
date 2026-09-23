import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * `deploy/publish-docs.sh`, executed — because strings are not the guard.
 *
 * `docs-publication.test.ts` beside this file proves the script *says* the right
 * things: it names `.published`, it compares `CI_COMMIT_TIMESTAMP`, it flips
 * through `mv -Tf` over a temporary symlink. Every one of those assertions is
 * satisfied by a script whose comparison is the wrong way round.
 *
 * **The ordering guard is the only branch whose logic can be wrong while every
 * string is present**, and it is the branch that decides whether a stale
 * pipeline overwrites a newer site (FR-026). Two publications overlap whenever
 * two commits land close together: `resource_group` stops them interleaving but
 * does **not** order them, so the slower, older pipeline can finish last, and
 * what stops it winning is this comparison and nothing else.
 *
 * So the script is spawned over a fixture — the idiom
 * `test/unit/scripts/check-read-size.test.ts` already uses for the shell checks
 * — in a temporary directory, with no service, no network and no SSH. Four
 * cases, and each asserts on the **symlink target**: a printed reason is a
 * sentence, and a document root is what a reader gets.
 *
 *   (a) no `.published` at all — a first publication proceeds;
 *   (b) an older `.published` — the ordinary case, proceeds;
 *   (c) a newer `.published` — declines, **exit 0**, `current` unmoved;
 *   (d) seven releases — five survive the prune, and they are the most recent.
 *
 * Exit 0 in (c) is load-bearing and is asserted as a number rather than as "not
 * a crash": a stale pipeline must not red for doing the right thing, and a red
 * there would be indistinguishable from a transfer that failed.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'deploy/publish-docs.sh');

const ROOTS: string[] = [];

afterAll(() => {
  for (const root of ROOTS) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  /** The releases to create, oldest first; each gets a distinct mtime. */
  readonly releases: readonly string[];
  /** Which release `current` points at, if any. */
  readonly current?: string;
  /** The contents of `.published`, if the host has published before. */
  readonly published?: string;
}

/** A `$DOCS_DEPLOY_PATH` on disk, in the layout the contract's §3 draws. */
function fixture(spec: Fixture): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-publish-'));
  ROOTS.push(root);
  mkdirSync(join(root, 'releases'));
  spec.releases.forEach((name, index) => {
    const path = join(root, 'releases', name);
    mkdirSync(path);
    writeFileSync(join(path, 'index.html'), `<!doctype html><title>${name}</title>\n`);
    // Distinct, increasing mtimes: the prune keeps the most recent five, and a
    // fixture built in one millisecond would leave that ordering to chance.
    const when = new Date(Date.UTC(2026, 0, index + 1)).getTime() / 1000;
    utimesSync(path, when, when);
  });
  if (spec.current !== undefined) {
    symlinkSync(join('releases', spec.current), join(root, 'current'));
  }
  if (spec.published !== undefined) {
    writeFileSync(join(root, '.published'), `${spec.published}\n`);
  }
  return root;
}

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function publish(root: string, sha: string, timestamp: string): Run {
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: process.env['PATH'] ?? '',
      DOCS_DEPLOY_PATH: root,
      CI_COMMIT_SHA: sha,
      CI_COMMIT_TIMESTAMP: timestamp,
    },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** What `current` resolves to, which is what nginx serves as its document root. */
function live(root: string): string {
  return readlinkSync(join(root, 'current'));
}

describe('publish-docs.sh publishes when it should', () => {
  it('(a) proceeds when nothing has ever been published', () => {
    const root = fixture({ releases: ['old', 'new'], current: 'old' });
    const run = publish(root, 'new', '2026-09-23T10:00:00+00:00');

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(live(root)).toBe('releases/new');
    expect(
      readdirSync(root),
      'the timestamp of what is live is written down, or the next publication has nothing to ' +
        'compare against and the guard is dead code from its first run.',
    ).toContain('.published');
  });

  it('(b) proceeds when the live site was built from an older commit', () => {
    const root = fixture({
      releases: ['old', 'new'],
      current: 'old',
      published: '2026-09-20T10:00:00+00:00',
    });
    const run = publish(root, 'new', '2026-09-23T10:00:00+00:00');

    expect(run.status).toBe(0);
    expect(live(root)).toBe('releases/new');
  });

  it('leaves no `current.tmp` behind — the flip moves it rather than copying it', () => {
    const root = fixture({ releases: ['old', 'new'], current: 'old' });
    publish(root, 'new', '2026-09-23T10:00:00+00:00');

    expect(readdirSync(root)).not.toContain('current.tmp');
  });
});

describe('publish-docs.sh declines when a newer build is already live', () => {
  it('(c) exits 0, says why, and leaves the newer release serving', () => {
    const root = fixture({
      releases: ['old', 'new'],
      current: 'old',
      published: '2026-09-24T10:00:00+00:00',
    });
    const run = publish(root, 'new', '2026-09-23T10:00:00+00:00');

    expect(
      run.status,
      'exit 0, not 1. A stale pipeline declining to overwrite a newer site is doing the right ' +
        'thing; a red there would be indistinguishable from a failed transfer, and somebody ' +
        'would eventually "fix" it by removing the guard.',
    ).toBe(0);
    expect(run.stdout).toMatch(/declin/i);
    expect(run.stdout).toContain('2026-09-24T10:00:00+00:00');
    expect(
      live(root),
      'the assertion that matters is the document root, not the sentence: a script that printed ' +
        'the refusal and flipped anyway would satisfy every string in this test but one.',
    ).toBe('releases/old');
  });

  it('orders two publications by instant, not by the text of their timestamps', () => {
    // 11:00+02:00 is 09:00 UTC, which is *older* than a live 09:30 UTC — and
    // lexicographically larger. A string comparison publishes the stale build
    // here and nowhere else, which is why the case is written down.
    const root = fixture({
      releases: ['old', 'new'],
      current: 'old',
      published: '2026-09-23T09:30:00+00:00',
    });
    const run = publish(root, 'new', '2026-09-23T11:00:00+02:00');

    expect(run.status).toBe(0);
    expect(live(root)).toBe('releases/old');
  });

  it('a re-run of the same commit is allowed to finish', () => {
    const root = fixture({
      releases: ['old', 'new'],
      current: 'old',
      published: '2026-09-23T10:00:00+00:00',
    });
    const run = publish(root, 'new', '2026-09-23T10:00:00+00:00');

    expect(run.status).toBe(0);
    expect(
      live(root),
      'the comparison is strictly-newer: an equal timestamp is the same commit being published ' +
        'again, and a retried pipeline has to be able to complete.',
    ).toBe('releases/new');
  });
});

describe('publish-docs.sh keeps five releases', () => {
  it('(d) prunes seven down to the five most recent, and keeps the live one', () => {
    const releases = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
    const root = fixture({ releases, current: 'r6' });
    const run = publish(root, 'r7', '2026-09-23T10:00:00+00:00');

    expect(run.status).toBe(0);
    expect(
      readdirSync(join(root, 'releases')).sort(),
      'five is what makes the rollback in `deploy/README.md` possible — the same flip form ' +
        'pointed at an older release — and unbounded growth is what makes a documentation host ' +
        'run out of disk. Which five is not arbitrary either: it is the most recent, so the ' +
        'rollback target is a release somebody might plausibly want back.',
    ).toEqual(['r3', 'r4', 'r5', 'r6', 'r7']);
    expect(live(root)).toBe('releases/r7');
  });

  it('prunes nothing when there are five or fewer', () => {
    const root = fixture({ releases: ['r1', 'r2', 'r3', 'r4'], current: 'r3' });
    const run = publish(root, 'r4', '2026-09-23T10:00:00+00:00');

    expect(run.status).toBe(0);
    expect(readdirSync(join(root, 'releases')).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('publish-docs.sh refuses what it cannot publish', () => {
  /**
   * The other direction of exit 0. Declining a stale pipeline is a success;
   * being handed no release, or no way to order publications, is a defect in
   * the job that called this — and it has to be loud, because the alternative
   * is a green pipeline that published nothing.
   */
  it('exits non-zero when the release directory was never transferred', () => {
    const root = fixture({ releases: ['old'], current: 'old' });
    const run = publish(root, 'missing', '2026-09-23T10:00:00+00:00');

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('releases/missing');
    expect(live(root)).toBe('releases/old');
  });

  it('exits non-zero when no timestamp orders it', () => {
    const root = fixture({ releases: ['old', 'new'], current: 'old' });
    const run = publish(root, 'new', '');

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('CI_COMMIT_TIMESTAMP');
    expect(live(root)).toBe('releases/old');
  });
});
