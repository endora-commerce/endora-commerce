import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Issue #349, acceptance: "no comment in the tree claims enforcement that does
 * not exist".
 *
 * `AdminRole.requiresTwoFactor` is enforced in one place — `mfa`'s
 * `MfaPolicyResolver`, at sign-in. Before the fix three comments said it was
 * enforced elsewhere: by the `requireAdmin` pre-handler in a "strict mode"
 * (the never-built T188 hook), and by `admin_users` at login. Both were false,
 * and both had been believed.
 *
 * Deliberately narrow, because a broad prose grep breaks on every honest
 * sentence: a comment that names `requiresTwoFactor` may not also name
 * `requireAdmin` or `T188`, and may not say `admin_users` enforces it.
 */

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');

const ROOTS = ['packages', 'backend/src'] as const;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

const FALSE_CLAIMS: ReadonlyArray<{ readonly claim: string; readonly pattern: RegExp }> = [
  { claim: 'the requireAdmin guard enforces it', pattern: /requireAdmin/ },
  { claim: 'the never-built T188 strict-mode hook enforces it', pattern: /\bT188\b/ },
  { claim: 'admin_users enforces it at login', pattern: /admin_users`?[^.]*\benforces?\b[^.]*requiresTwoFactor/ },
];

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) yield path;
  }
}

/** Each comment in a source, as one string: a `/* … *\/` block, or a run of `//` lines. */
function commentsOf(source: string): Array<{ line: number; text: string }> {
  const comments: Array<{ line: number; text: string }> = [];
  const lineAt = (offset: number) => source.slice(0, offset).split('\n').length;
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    comments.push({ line: lineAt(match.index ?? 0), text: match[0] });
  }
  for (const match of source.matchAll(/(?:^[ \t]*\/\/.*\n?)+/gm)) {
    comments.push({ line: lineAt(match.index ?? 0), text: match[0] });
  }
  return comments;
}

function findings(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(REPO_ROOT, root))) {
      // This file names the claims it refuses.
      if (file === fileURLToPath(import.meta.url)) continue;
      const source = readFileSync(file, 'utf8');
      if (!source.includes('requiresTwoFactor')) continue;
      for (const comment of commentsOf(source)) {
        if (!comment.text.includes('requiresTwoFactor')) continue;
        const flat = comment.text.replace(/\s+/g, ' ');
        for (const { claim, pattern } of FALSE_CLAIMS) {
          if (pattern.test(flat)) out.push(`${relative(REPO_ROOT, file)}:${comment.line} — ${claim}`);
        }
      }
    }
  }
  return out;
}

describe('no comment claims a requiresTwoFactor enforcement that does not exist (#349)', () => {
  it('finds none', () => {
    expect(findings()).toEqual([]);
  });

  it('would find the comment the issue was filed about', () => {
    const planted =
      '/**\n * `requiresTwoFactor` flips the requireAdmin pre-handler into a strict mode\n * (T188 hook).\n */';
    const flat = commentsOf(planted)[0]!.text.replace(/\s+/g, ' ');
    expect(FALSE_CLAIMS.filter(({ pattern }) => pattern.test(flat)).map((c) => c.claim)).toEqual([
      'the requireAdmin guard enforces it',
      'the never-built T188 strict-mode hook enforces it',
    ]);
  });
});
