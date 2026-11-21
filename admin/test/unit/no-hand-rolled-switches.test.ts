/**
 * One on/off control — issue #1607 (UX audit 2026-11-17, follow-up of DS-09 #1442).
 *
 * `Switch` from `@endora-commerce/admin-kit/ui` is the only element in the
 * admin that may carry `role="switch"`. A checkbox given the role by hand
 * announces "switch" but draws a tick box, so what the operator sees and what
 * a screen reader says disagree (Law of Similarity), and it skips the kit's
 * busy and disabled-reason handling (Doherty Threshold; SC 4.1.2).
 *
 * Only the kit's own component may write the role. Tests are not scanned, and
 * a CSS selector naming the role (`'[role="switch"]'`) is not a control.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The one file that draws a switch. Repo-relative. */
const OWNER = 'packages/admin-kit/src/ui/switch.tsx';

/** Where screens live: every module's admin layer, the shell, the kit, the admin app. */
const SCANNED = [
  'packages/modules/*/src/**/*.tsx',
  'packages/admin-shell/src/**/*.tsx',
  'packages/admin-kit/src/**/*.tsx',
  'admin/src/**/*.tsx',
];

/** `role="switch"`, `role='switch'` or `role={'switch'}` — not the selector `[role="switch"]`. */
const ROLE = /\brole=\{?["']switch["']\}?(?!\])/;

function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '--', ...SCANNED], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((file) => file !== '' && !/\.test\.tsx?$/.test(file) && file !== OWNER);
}

describe('role="switch" is drawn only by the kit Switch (#1607)', () => {
  it('no screen hand-rolls a switch; it renders <Switch> instead', () => {
    const offenders = sources().flatMap((file) => {
      const text = readFileSync(path.join(repoRoot, file), 'utf8');
      return text
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => ROLE.test(line))
        .map(({ index }) => `${file}:${index + 1}`);
    });
    expect(offenders).toEqual([]);
  });

  it('the kit Switch still writes the role, so the rule above still means something', () => {
    const owner = readFileSync(path.join(repoRoot, OWNER), 'utf8');
    expect(owner).toMatch(ROLE);
  });
});
