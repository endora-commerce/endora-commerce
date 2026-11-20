/**
 * An action's result is not a success banner (issue #1499, UX audit SALES-17;
 * owner decision DEC-12 a).
 *
 * "Saved", "Deleted", "Replay queued" used to be an `<Alert variant="success">`
 * mounted at the top of the page when the action succeeded: far from the button
 * that caused it (Proximity), one more banner competing with the error and the
 * record's own notices (Von Restorff), and — created already carrying its text —
 * often not announced at all (WCAG 2.2 SC 4.1.3). The kit's `InlineStatus`
 * (`useInlineStatus()`), the `DetailHeaderActions` `status` slot and the
 * `StickyFormActions` `status` slot are the pattern: an always-mounted polite
 * region beside the control. Errors stay a page-level destructive `Alert`.
 *
 * The population is every non-test `.ts` / `.tsx` source of the admin SPA, the
 * shell, the kit and every module's `src/admin/` and `src/admin-ui/`; a finding
 * is a JSX `<Alert … variant="success" …>` opening tag.
 *
 * `LEDGER` is two-way, per file: an unlisted finding fails, and so does an
 * entry whose count no longer matches — so migrating a screen has to delete its
 * entry here, and the list below is exactly what #1499 still has to do.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** What is still a success banner, and where it goes. Keyed by repo-relative file.
 * Empty since #1499 (SALES-17) migrated the last screens: a new success banner fails. */
const LEDGER: Record<string, { count: number; reason: string }> = {};

const SUCCESS_ALERT = /<Alert\b[^>]*?\bvariant="success"/g;

function roots(): string[] {
  const fixed = ['admin/src', 'packages/admin-kit/src', 'packages/admin-shell/src'];
  const modulesDir = path.join(repoRoot, 'packages/modules');
  const modules = readdirSync(modulesDir).flatMap((id) =>
    ['src/admin', 'src/admin-ui'].map((sub) => `packages/modules/${id}/${sub}`),
  );
  return [...fixed, ...modules].filter((rel) => existsSync(path.join(repoRoot, rel)));
}

function sources(rel: string): string[] {
  const abs = path.join(repoRoot, rel);
  return readdirSync(abs).flatMap((entry) => {
    const child = `${rel}/${entry}`;
    if (statSync(path.join(abs, entry)).isDirectory()) return entry === 'node_modules' ? [] : sources(child);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [child] : [];
  });
}

function findings(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of roots().flatMap(sources)) {
    const count = readFileSync(path.join(repoRoot, file), 'utf8').match(SUCCESS_ALERT)?.length ?? 0;
    if (count > 0) found[file] = count;
  }
  return found;
}

describe('an action result is an InlineStatus beside its control, not a success banner (#1499)', () => {
  const found = findings();

  it('finds no success Alert outside the ledger', () => {
    const unlisted = Object.keys(found).filter((file) => !(file in LEDGER));
    expect(unlisted, 'use InlineStatus / useInlineStatus beside the control (packages/admin-kit/README.md § Messages)').toEqual([]);
  });

  it('holds no stale entry: each count matches its file', () => {
    const stale = Object.entries(LEDGER)
      .filter(([file, entry]) => found[file] !== entry.count)
      .map(([file, entry]) => `${file}: ledger ${entry.count}, found ${found[file] ?? 0}`);
    expect(stale, 'a migrated screen deletes its ledger entry').toEqual([]);
  });

  it('recognises the shape on one line and across lines, and not a success Badge', () => {
    const count = (source: string): number => source.match(SUCCESS_ALERT)?.length ?? 0;
    expect(count('<Alert variant="success" className="mb-4">')).toBe(1);
    expect(count('<Alert\n  className="mb-4"\n  variant="success"\n>')).toBe(1);
    expect(count('<Badge variant="success">On</Badge>')).toBe(0);
    expect(count('<Alert variant="destructive">')).toBe(0);
  });
});
