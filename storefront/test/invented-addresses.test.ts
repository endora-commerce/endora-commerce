import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No storefront source invents an address for a value the operator has to
 * supply.
 *
 * **Why a test and not a `check-*` script.** The estate's checks judge the
 * *backend* module tree; this is one application's own residue, its population
 * is three directories, and it needs no ledger — every finding is one call to
 * `lib/env.mjs` away from compliance, so an entry could only license the defect
 * back. It runs in `test:frontend`, on every merge request.
 *
 * **What it refuses**, and the shape is why the fallbacks survived so long: a
 * literal `http://` or `https://` origin standing as the right-hand side of a
 * `??` or `||`, i.e. an answer this source invented for a question only the
 * environment can answer. Twenty-four of those stood on 2026-09-06, thirteen of
 * them on `NEXT_PUBLIC_API_BASE_URL` — a *browser* value Next bakes into the
 * bundle at build time, so a build without it shipped a bundle pointing every
 * visitor at their own machine and reported success. Under D-195 this tree is
 * copied into every client instance, so a default here is not a developer's
 * convenience; it is every shop's.
 *
 * It deliberately says nothing about an *empty-string* default
 * (`?? ''`): `lib/api/analytics/gtag.ts` and `lib/api/gtm/dataLayer.ts` use one
 * to build a same-origin relative URL, which invents no address and reaches
 * nobody's machine. That is the one storefront shape left defaulted, and it is
 * safe for a reason rather than by oversight.
 */

const ROOTS = ['app', 'components', 'lib'] as const;
const STOREFRONT = join(__dirname, '..');

/** An `http(s)://…` literal used as the right-hand side of `??` or `||`. */
const INVENTED_ADDRESS = /(?:\?\?|\|\|)\s*(['"`])(https?:\/\/[^'"`]*)\1/g;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...sources(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

describe('the storefront invents no address', () => {
  const files = ROOTS.flatMap((root) => sources(join(STOREFRONT, root)));

  it('read a population worth judging', () => {
    // A green that could mean "not looking" is not a green: the roots moved
    // once already when `lib/` grew subdirectories.
    expect(files.length).toBeGreaterThan(200);
  });

  it('defaults no environment value to a hard-coded origin', () => {
    const findings: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(INVENTED_ADDRESS)) {
        const line = text.slice(0, match.index).split('\n').length;
        findings.push(`${relative(STOREFRONT, file)}:${String(line)} — ${match[0]}`);
      }
    }
    expect(findings).toEqual([]);
  });
});
