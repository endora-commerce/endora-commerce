import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  parseCommitLog,
  signoffFindings,
  type CommitRecord,
} from '../../../scripts/dco-signoff.js';

/**
 * The Developer Certificate of Origin gate (`specs/136-open-source-publication/`
 * W6.3, owner decision O-7: DCO enforced by a GitHub check, no CLA).
 *
 * Every non-merge commit a pull request adds must carry a `Signed-off-by:`
 * trailer whose address is the commit author's. The script is plain Node with
 * no dependency, so the workflow runs it without an install; these cases hold
 * its verdicts, its refusals, and the workflow that makes it a required status.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'backend', 'scripts', 'dco-signoff.ts');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'dco.yml');

function commit(overrides: Partial<CommitRecord>): CommitRecord {
  return {
    sha: 'a'.repeat(40),
    parents: 1,
    authorName: 'Ada Lovelace',
    authorEmail: 'ada@example.com',
    subject: 'Fix the thing',
    signoffs: ['Ada Lovelace <ada@example.com>'],
    ...overrides,
  };
}

describe('the verdict over parsed commits', () => {
  it('accepts a commit signed off by its author', () => {
    expect(signoffFindings([commit({})])).toEqual([]);
  });

  it('compares the address case-insensitively and ignores the display name', () => {
    expect(
      signoffFindings([commit({ signoffs: ['A. Lovelace <ADA@Example.com>'] })]),
    ).toEqual([]);
  });

  it('accepts a commit where any one of several sign-offs is the author', () => {
    expect(
      signoffFindings([
        commit({
          signoffs: ['Reviewer <reviewer@example.com>', 'Ada Lovelace <ada@example.com>'],
        }),
      ]),
    ).toEqual([]);
  });

  it('refuses a commit with no sign-off, naming it', () => {
    const findings = signoffFindings([commit({ signoffs: [] })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'missing-signoff', sha: 'a'.repeat(40) });
  });

  it('refuses a sign-off by somebody other than the author', () => {
    const findings = signoffFindings([
      commit({ signoffs: ['Someone Else <someone@example.com>'] }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'foreign-signoff' });
  });

  it('refuses a sign-off whose value carries no address', () => {
    const findings = signoffFindings([commit({ signoffs: ['Ada Lovelace'] })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'foreign-signoff' });
  });

  it('accepts a GitHub App commit signed off under the same bot name at another address', () => {
    // Dependabot's real shape: authored at the noreply address, signed off at another.
    expect(
      signoffFindings([
        commit({
          authorName: 'dependabot[bot]',
          authorEmail: '49699333+dependabot[bot]@users.noreply.github.com',
          signoffs: ['dependabot[bot] <support@github.com>'],
        }),
      ]),
    ).toEqual([]);
  });

  it('does not extend the name match to a human author', () => {
    const findings = signoffFindings([
      commit({ signoffs: ['Ada Lovelace <ada@elsewhere.example>'] }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'foreign-signoff' });
  });

  it('still refuses an unsigned bot commit', () => {
    const findings = signoffFindings([
      commit({
        authorName: 'dependabot[bot]',
        authorEmail: '49699333+dependabot[bot]@users.noreply.github.com',
        signoffs: [],
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'missing-signoff' });
  });

  it('does not ask a merge commit for a sign-off', () => {
    expect(signoffFindings([commit({ parents: 2, signoffs: [] })])).toEqual([]);
  });
});

describe('the log parser', () => {
  it('reads the fields the git format writes, trailers included', () => {
    const raw =
      `${'b'.repeat(40)}\x00${'c'.repeat(40)} ${'d'.repeat(40)}\x00Ada\x00ada@example.com\x00` +
      `Merge branch\x00\x1e` +
      `${'e'.repeat(40)}\x00${'f'.repeat(40)}\x00Ada\x00ada@example.com\x00Fix\x00` +
      `Ada <ada@example.com>\x1fBob <bob@example.com>\x1e\n`;
    expect(parseCommitLog(raw)).toEqual([
      {
        sha: 'b'.repeat(40),
        parents: 2,
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        subject: 'Merge branch',
        signoffs: [],
      },
      {
        sha: 'e'.repeat(40),
        parents: 1,
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        subject: 'Fix',
        signoffs: ['Ada <ada@example.com>', 'Bob <bob@example.com>'],
      },
    ]);
  });
});

describe('the command, over a real repository', () => {
  const directories: string[] = [];
  afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Ada Lovelace',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada Lovelace',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
  };

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim();
  }

  function repository(): { cwd: string; base: string } {
    const cwd = mkdtempSync(join(tmpdir(), 'dco-signoff-'));
    directories.push(cwd);
    git(cwd, 'init', '--quiet', '--initial-branch=master');
    git(cwd, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(cwd, 'a.txt'), 'a\n');
    git(cwd, 'add', 'a.txt');
    git(cwd, 'commit', '--quiet', '-m', 'Base');
    return { cwd, base: git(cwd, 'rev-parse', 'HEAD') };
  }

  function change(cwd: string, file: string, ...commitArgs: string[]): string {
    writeFileSync(join(cwd, file), `${file}\n`);
    git(cwd, 'add', file);
    git(cwd, 'commit', '--quiet', ...commitArgs);
    return git(cwd, 'rev-parse', 'HEAD');
  }

  function run(cwd: string, ...args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: gitEnv, encoding: 'utf8' });
  }

  it('exits 0 when every commit in the range is signed off, and says how many it read', () => {
    const { cwd, base } = repository();
    change(cwd, 'b.txt', '-s', '-m', 'Add b');
    const head = change(cwd, 'c.txt', '-s', '-m', 'Add c');
    const result = run(cwd, base, head);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('commits=2');
  });

  it('exits 1 naming the unsigned commit and the remedy', () => {
    const { cwd, base } = repository();
    change(cwd, 'b.txt', '-s', '-m', 'Add b');
    const unsigned = change(cwd, 'c.txt', '-m', 'Add c without a sign-off');
    const result = run(cwd, base, unsigned);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(unsigned.slice(0, 12));
    expect(result.stdout).toContain('missing-signoff');
    expect(result.stdout).toContain('git rebase --signoff');
  });

  it('does not count a sign-off written in the body rather than as a trailer', () => {
    const { cwd, base } = repository();
    const head = change(
      cwd,
      'b.txt',
      '-m',
      'Add b',
      '-m',
      'Signed-off-by: Ada Lovelace <ada@example.com> is what I meant to add.\n\nMore prose.',
    );
    expect(run(cwd, base, head).status).toBe(1);
  });

  it('skips a merge commit and still judges the commits it brings in', () => {
    const { cwd, base } = repository();
    git(cwd, 'checkout', '--quiet', '-b', 'side');
    change(cwd, 'side.txt', '-m', 'Unsigned side commit');
    git(cwd, 'checkout', '--quiet', 'master');
    change(cwd, 'main.txt', '-s', '-m', 'Signed main commit');
    git(cwd, 'merge', '--quiet', '--no-ff', '--no-edit', 'side');
    const head = git(cwd, 'rev-parse', 'HEAD');
    const result = run(cwd, base, head);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Unsigned side commit');
    expect(result.stdout).not.toContain('Merge branch');
  });

  it('refuses an empty range with exit 2 rather than passing it', () => {
    const { cwd, base } = repository();
    const result = run(cwd, base, base);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('no commit');
  });

  it('refuses an unresolvable ref with exit 2', () => {
    const { cwd, base } = repository();
    const result = run(cwd, base, 'no-such-ref');
    expect(result.status).toBe(2);
  });

  it('refuses a missing argument with exit 2', () => {
    const { cwd } = repository();
    expect(run(cwd).status).toBe(2);
  });
});

describe('the workflow that makes it a required status', () => {
  const source = readFileSync(WORKFLOW, 'utf8');

  it('runs on pull requests into master', () => {
    expect(source).toMatch(/^on:\n {2}pull_request:\n {4}branches: \[master\]$/m);
  });

  it('runs the script over the pull request range with the full history fetched', () => {
    expect(source).toContain('fetch-depth: 0');
    expect(source).toContain('node backend/scripts/dco-signoff.ts "$BASE_REF" "$HEAD_SHA"');
    // The base is the target branch as fetched at run time, not the event's
    // `base.sha`: a branch that merged `master` in after the pull request opened
    // would otherwise have every newer `master` commit judged as its own.
    expect(source).toContain('BASE_REF: origin/${{ github.base_ref }}');
    expect(source).toContain('HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
  });

  it('names the job `dco`, which is the status branch protection lists', () => {
    expect(source).toMatch(/^ {2}dco:\n {4}name: dco$/m);
  });

  it('reads the repository and nothing else', () => {
    expect(source).toMatch(/^ {4}permissions:\n {6}contents: read$/m);
    expect(source).not.toMatch(/:\s*write\b/);
  });
});
