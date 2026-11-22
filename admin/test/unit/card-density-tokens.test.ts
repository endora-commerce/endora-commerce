/**
 * A card's density is the kit's — issue #1502 (UX audit 2026-11-17, SHELL-18;
 * owner decision DEC-03).
 *
 * `CardHeader`, `CardContent` and `CardFooter` pad themselves from the
 * `--card-pad` / `--card-pad-sm` tokens in `theme.css`, and `CardContent`
 * drops its top padding only when it follows a header. A screen that writes
 * `p-4`, `pt-0` or `p-6` on one of them either repeats the token (and drifts
 * the day the token moves) or overrides it (and draws a card of a different
 * density from every other one — Similarity). A compact strip says so with
 * the token, `py-(--card-pad-sm)`, not with a number.
 *
 * The rule holds on the screens that have migrated; a screen joins
 * `MIGRATED` when its overrides go. The `forms` admin went first (S9 of the
 * audit's remainder), since it held 17 of the 29 overrides the audit counted.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The screens on the tokens. Repo-relative globs. */
const MIGRATED = ['packages/modules/forms/src/admin/**/*.tsx'];

/** A card part opened with a literal `className`. */
const CARD_PART = /<Card(?:Header|Content|Footer)\b[^>]*?\bclassName="([^"]*)"/g;

/** A numeric padding utility — `p-4`, `pt-0`, `px-4`, `md:p-6` — but not a token, `p-(--card-pad)`. */
const NUMERIC_PADDING = /(?:^|\s)(?:[a-z0-9-]+:)*p[trblxy]?-(?:\d|px\b|\[)/;

function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '--', ...MIGRATED], { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\n').filter((file) => file !== '' && !/\.test\.tsx?$/.test(file));
}

function paddingOverrides(text: string): string[] {
  return [...text.matchAll(CARD_PART)]
    .filter((match) => NUMERIC_PADDING.test(match[1]!))
    .map((match) => match[0]);
}

describe('card parts on migrated screens take their padding from the density tokens (#1502, SHELL-18)', () => {
  it('no CardHeader / CardContent / CardFooter on a migrated screen carries a numeric padding utility', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) =>
      paddingOverrides(readFileSync(path.join(repoRoot, file), 'utf8')).map((part) => `${file}: ${part}`),
    );
    expect(offenders).toEqual([]);
  });

  it('tells an override from a token, so the rule above still means something', () => {
    expect(paddingOverrides('<CardContent className="space-y-6 p-6">')).toHaveLength(1);
    expect(paddingOverrides('<CardHeader className="p-4 pb-2">')).toHaveLength(1);
    expect(paddingOverrides('<CardContent className="grid gap-4 md:pt-0">')).toHaveLength(1);
    expect(paddingOverrides('<CardHeader className="border-b px-(--card-pad) py-(--card-pad-sm)">')).toEqual([]);
    expect(paddingOverrides('<CardContent className="space-y-3">')).toEqual([]);
  });
});
