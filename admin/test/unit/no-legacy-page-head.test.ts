/**
 * One page heading — issue #1436 (UX audit 2026-11-17, DS-02, SHELL-18).
 *
 * The `.b2b-page-head` markup drew a page's title as a `<div>`, so the pages
 * that used it had no `h1` (WCAG 1.3.1 / 2.4.6) and a second header look beside
 * the kit `PageHeader` (Law of Similarity). #1613 moved its last eleven screens
 * to `PageHeader` and removed the classes from `packages/admin-kit/theme.css`.
 * This ratchet keeps them gone: no admin source, module, overlay or stylesheet
 * may name a `b2b-page-head` class again. A page draws its heading through
 * `PageHeader` (`@endora-commerce/admin-kit/ui`).
 *
 * Comments are stripped before matching, so the kit's own note on what it
 * replaced is not a use.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Everything an admin page or its styles can come from. Repo-relative. */
const ROOTS = ['admin/src', 'packages/admin-kit', 'packages/admin-shell/src', 'packages/modules', 'backend/src/apps'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'i18n', 'docs', 'test']);
const SOURCE = /\.(?:tsx?|jsx?|css)$/;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
}

/** Block and line comments out; a `//` inside a string such as a URL is left alone by requiring no `:` before it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const LEGACY = /\bb2b-page-head(?:__[a-z-]+)?\b/;

describe('no legacy page head (#1436)', () => {
  it('finds sources to scan', () => {
    const files: string[] = [];
    for (const root of ROOTS) walk(path.join(repoRoot, root), files);
    expect(files.length).toBeGreaterThan(100);
  });

  it('strips comments but keeps code', () => {
    expect(LEGACY.test(stripComments('/* the old `.b2b-page-head` */ const a = 1;'))).toBe(false);
    expect(LEGACY.test(stripComments('// .b2b-page-head__title\n'))).toBe(false);
    expect(LEGACY.test(stripComments('<div className="b2b-page-head">'))).toBe(true);
    expect(LEGACY.test(stripComments('.b2b-page-head__sub { color: red; }'))).toBe(true);
  });

  it('leaves no source naming a b2b-page-head class', () => {
    const files: string[] = [];
    for (const root of ROOTS) walk(path.join(repoRoot, root), files);
    const offenders = files
      .filter((file) => LEGACY.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => path.relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });
});
