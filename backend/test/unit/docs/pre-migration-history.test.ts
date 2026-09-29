import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * `specs/pre-migration-history/` is the canonical tree's one link to the history the
 * migration withheld (129 T032, D-283 §2 and §4.6).
 *
 * Three things are held here:
 *
 * 1. **The commit map stays inside the disclosure gate.** It is publishable only
 *    because every row is a pair of commit ids and nothing else — no path, message,
 *    author or date (`specs/conventions/commercial-data.md`). A row of any other
 *    shape is a payload, not a pointer, so the shape is asserted line by line, and
 *    the SHA-256 recorded at the migration pins the file to the artefact it copies.
 * 2. **The two floors are written once, in the README**, in a form a script can read.
 *    They are not derivable from this tree — the numbered directories below them are
 *    withheld — and they never move, because the cut happens once.
 * 3. **Nothing numbers a feature at or below the floor.** Before this, the canonical
 *    `specs/` held no directory above 110, so `create-new-feature.sh` would have
 *    numbered the next feature 111 (and, on an empty `specs/`, 001) — a collision
 *    with a withheld directory on its first day. The architect prompts of every tool
 *    must route to the same floor rather than to "the highest existing directory".
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const HISTORY_DIR = join(REPO_ROOT, 'specs', 'pre-migration-history');
const COMMIT_MAP = join(HISTORY_DIR, 'commit-map');
const README = join(HISTORY_DIR, 'README.md');

/** Recorded by 129 T031 (D-283 §1) over two consecutive filter runs. */
const COMMIT_MAP_SHA256 = '00d535475bd71c7da8475325a361b78ddb87bccb05b21520b976ff11f9f5173d';
const COMMIT_MAP_ROWS = 6401;
const COMMIT_MAP_NULL_ROWS = 1427;
const NULL_ID = '0'.repeat(40);
const ROW = /^[0-9a-f]{40} [0-9a-f]{40}$/;

describe('specs/pre-migration-history/commit-map', () => {
  const bytes = readFileSync(COMMIT_MAP);
  const text = bytes.toString('utf8');

  it('is byte-identical to the artefact of the migration', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(COMMIT_MAP_SHA256);
  });

  it('holds two 40-hex commit ids per row and nothing else', () => {
    expect(text.endsWith('\n')).toBe(true);
    const rows = text.slice(0, -1).split('\n');
    expect(rows).toHaveLength(COMMIT_MAP_ROWS);
    const offending = rows
      .map((row, index) => ({ row, line: index + 1 }))
      .filter(({ row }) => !ROW.test(row));
    expect(offending).toEqual([]);
    expect(rows.filter((row) => row.endsWith(` ${NULL_ID}`))).toHaveLength(COMMIT_MAP_NULL_ROWS);
  });
});

describe('specs/pre-migration-history/README.md', () => {
  const readme = readFileSync(README, 'utf8');

  it('records both floors in the form create-new-feature.sh reads', () => {
    expect(readme).toMatch(/^\| Last pre-migration feature \| `136` \|$/m);
    expect(readme).toMatch(/^\| Last private ruling \| `D-283` \|$/m);
    expect(readme).toContain('D-284');
    expect(readme).toContain('137');
  });

  it('says how to resolve an abbreviated pre-migration id', () => {
    expect(readme).toContain('grep');
    expect(readme).toContain(NULL_ID.slice(0, 8));
  });
});

describe('every route to a new feature number goes through the floor', () => {
  it('CONTRIBUTING.md points a pre-migration commit id at this directory', () => {
    const contributing = readFileSync(join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf8');
    expect(contributing).toContain('specs/pre-migration-history/');
  });

  it.each([
    '.claude/agents/endora-commerce-architect.md',
    '.cursor/agents/endora-commerce-architect.md',
    '.codex/agents/endora-commerce-architect.toml',
  ])('%s cites the floor instead of numbering from the tree alone', (prompt) => {
    const text = readFileSync(join(REPO_ROOT, prompt), 'utf8');
    expect(text).toContain('specs/pre-migration-history/README.md');
  });
});

describe('create-new-feature.sh numbers above the pre-migration floor', () => {
  const sandboxes: string[] = [];

  afterEach(() => {
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * A non-git copy of the scripts plus the real README, so the script takes its
   * local-directory path: no remote is queried and nothing outside the sandbox is read.
   */
  function sandbox(options: { specs?: readonly string[]; readme?: string | null } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'pre-migration-floor-'));
    sandboxes.push(root);
    cpSync(join(REPO_ROOT, '.specify', 'scripts'), join(root, '.specify', 'scripts'), {
      recursive: true,
    });
    mkdirSync(join(root, 'specs', 'pre-migration-history'), { recursive: true });
    const readme = options.readme === undefined ? readFileSync(README, 'utf8') : options.readme;
    if (readme !== null) writeFileSync(join(root, 'specs', 'pre-migration-history', 'README.md'), readme);
    for (const dir of options.specs ?? []) mkdirSync(join(root, 'specs', dir), { recursive: true });
    return root;
  }

  function run(root: string, ...args: string[]) {
    return spawnSync(
      'bash',
      [join(root, '.specify', 'scripts', 'bash', 'create-new-feature.sh'), '--json', '--dry-run', ...args],
      { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } },
    );
  }

  function featureNumber(root: string, ...args: string[]): string {
    const result = run(root, ...args, 'Open source launch');
    expect(result.stderr).not.toMatch(/^Error/m);
    expect(result.status).toBe(0);
    return (JSON.parse(result.stdout) as { FEATURE_NUM: string }).FEATURE_NUM;
  }

  it('numbers the first public feature 137 on an empty specs/', () => {
    expect(featureNumber(sandbox())).toBe('137');
  });

  it('numbers 137 when the tree only holds directories moved across from below the floor', () => {
    expect(featureNumber(sandbox({ specs: ['110-instance-repository'] }))).toBe('137');
  });

  it('numbers after the highest public directory once one exists above the floor', () => {
    expect(featureNumber(sandbox({ specs: ['110-instance-repository', '140-later'] }))).toBe('141');
  });

  it('accepts an explicit number above the floor', () => {
    expect(featureNumber(sandbox(), '--number', '150')).toBe('150');
  });

  it.each(['1', '110', '136'])('refuses an explicit --number %s, a withheld number', (n) => {
    const result = run(sandbox(), '--number', n, 'Open source launch');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('specs/pre-migration-history/README.md');
  });

  it('fails closed when the floor cannot be read, instead of numbering from 001', () => {
    const missing = run(sandbox({ readme: null }), 'Open source launch');
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('specs/pre-migration-history/README.md');

    const unreadable = run(sandbox({ readme: '# no floor here\n' }), 'Open source launch');
    expect(unreadable.status).not.toBe(0);
  });

  it('leaves --timestamp numbering alone', () => {
    expect(featureNumber(sandbox({ readme: null }), '--timestamp')).toMatch(/^\d{8}-\d{6}$/);
  });
});
