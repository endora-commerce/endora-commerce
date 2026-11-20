/**
 * One empty-state block — issue #1448 (UX audit 2026-11-17, DS-15).
 *
 * The `.b2b-empty` classes (`b2b-empty`, `__icon`, `__title`, `__sub`) are the
 * drawing of the kit's `EmptyState`, and nothing else may write them out. A
 * screen that hand-rolls the block gets it wrong in one of the ways the audit
 * counted ~88 times: a bare grey sentence with no icon, no action, and the
 * same words for "nothing here yet" and "your filters match nothing" — which
 * sends the operator to create something that already exists. `EmptyState`
 * carries both variants, and its no-results one the *Clear filters* way back.
 *
 * Only the kit's own component may name the class. Tests are not scanned:
 * asserting on the kit's rendered markup is what they are for.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The one file that draws the block. Repo-relative. */
const OWNER = 'packages/admin-kit/src/ui/empty-state.tsx';

/** Where screens live: every module's admin layer, the shell, the kit, the admin app. */
const SCANNED = [
  'packages/modules/*/src/**/*.tsx',
  'packages/modules/*/src/**/*.ts',
  'packages/admin-shell/src/**/*.tsx',
  'packages/admin-shell/src/**/*.ts',
  'packages/admin-kit/src/**/*.tsx',
  'packages/admin-kit/src/**/*.ts',
  'admin/src/**/*.tsx',
  'admin/src/**/*.ts',
];

const CLASS = /\bb2b-empty(?:__[a-z]+)?\b/;

function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '--', ...SCANNED], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((file) => file !== '' && !/\.test\.tsx?$/.test(file) && file !== OWNER);
}

describe('the .b2b-empty block is drawn only by the kit EmptyState (#1448, DS-15)', () => {
  it('no screen names a .b2b-empty class; it renders <EmptyState> instead', () => {
    const offenders = sources().flatMap((file) => {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      return text
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => CLASS.test(line))
        .map(({ index }) => `${file}:${index + 1}`);
    });
    expect(offenders).toEqual([]);
  });

  it('the kit EmptyState still draws the block, so the rule above still means something', () => {
    const owner = readFileSync(path.join(repoRoot, OWNER), 'utf8');
    for (const name of ['b2b-empty', 'b2b-empty__icon', 'b2b-empty__title', 'b2b-empty__sub']) {
      expect(owner, name).toMatch(new RegExp(`['"]${name}['"]`));
    }
  });
});
