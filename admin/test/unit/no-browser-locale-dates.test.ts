/**
 * Admin dates are written in the admin UI language, never the browser's own
 * locale — issue #1776 (UX audit #1567, follow-up of #1773).
 *
 * One Opportunity sidebar used to show `17.11.2026`, `11/25/2026` and
 * `Nov 22, 2026` side by side: some dates came from the kit formatter with the
 * admin language, the others from `Date#toLocaleDateString()` /
 * `toLocaleString()` with whatever locale the browser happened to have. Every
 * date now goes through the kit's `formatDate(value, language)` /
 * `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`). Their
 * one-argument form still exists for consumers outside this repository — it is
 * `@deprecated` and falls back to the browser's locale — so the rule "always
 * pass the language" is held here rather than by the type.
 *
 * The population is every non-test `.ts` / `.tsx` source of the admin SPA, the
 * shell, the kit and every module's `src/admin/` and `src/admin-ui/`.
 *
 * - `toLocaleDateString(` and `toLocaleTimeString(` only ever format a date, so
 *   any finding fails.
 * - `toLocaleString(` formats a date *or a number*, which a scan cannot tell
 *   apart. `NUMBER_LEDGER` lists, per file, the calls that format a number. It
 *   is two-way: an unlisted call fails, and so does an entry whose count no
 *   longer matches — a new `toLocaleString(` is either a date (use the kit
 *   formatter) or a number (add it here, with its reason). The kit's own
 *   deprecated fallback is the one date entry, and leaves with it.
 * - A `formatDate(` / `formatDateTime(` call with one argument fails: it is the
 *   deprecated browser-locale form.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `toLocaleString(` calls that format a number, not a date. Keyed by repo-relative file. */
const NUMBER_LEDGER: Record<string, { count: number; reason: string }> = {
  'packages/admin-kit/src/lib/format.ts': {
    count: 1,
    reason: 'the deprecated no-language fallback of formatDateTime, kept for consumers outside this repository',
  },
  'packages/modules/analytics/src/admin/pages/AnalyticsPage.tsx': { count: 2, reason: 'event counts' },
  'packages/modules/catalog/src/admin/components/ProductInventoryTab.tsx': { count: 2, reason: 'stock quantities' },
  'packages/modules/inventory/src/admin/pages/InventoryPage.tsx': { count: 5, reason: 'stock quantities' },
  'packages/modules/inventory/src/admin/pages/LowStockPage.tsx': { count: 2, reason: 'stock quantities' },
  'packages/modules/inventory/src/admin/pages/WarehousesList.tsx': { count: 2, reason: 'stock quantities' },
  'packages/modules/invoices/src/admin/templates/invoice-puck-config.tsx': { count: 2, reason: 'invoice preview amounts' },
  'packages/modules/quote_requests/src/admin/pages/RfqList.tsx': { count: 1, reason: 'quote total' },
  'packages/modules/seo/src/admin/pages/SeoPage.tsx': { count: 1, reason: 'sitemap URL count' },
};

const DATE_ONLY = /\.toLocale(?:Date|Time)String\(/g;
const DATE_OR_NUMBER = /\.toLocaleString\(/g;

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

function scan(pattern: RegExp): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of roots().flatMap(sources)) {
    const count = readFileSync(path.join(repoRoot, file), 'utf8').match(pattern)?.length ?? 0;
    if (count > 0) found[file] = count;
  }
  return found;
}

const KIT_CALL = /\bformat(?:Date|DateTime)\(/g;

/** `file:line` of every kit date-formatter call with fewer than two arguments. */
function oneArgumentCalls(): string[] {
  const out: string[] = [];
  for (const file of roots().flatMap(sources)) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const match of text.matchAll(KIT_CALL)) {
      const before = text.slice(Math.max(0, match.index - 9), match.index);
      if (/function\s*$/.test(before)) continue; // a declaration, not a call
      let depth = 1;
      let commas = 0;
      let index = match.index + match[0].length;
      let quote: string | null = null;
      for (; index < text.length && depth > 0; index += 1) {
        const char = text.charAt(index);
        if (quote) {
          if (char === '\\') index += 1;
          else if (char === quote) quote = null;
        } else if (char === "'" || char === '"' || char === '`') quote = char;
        else if ('([{'.includes(char)) depth += 1;
        else if (')]}'.includes(char)) depth -= 1;
        else if (char === ',' && depth === 1) commas += 1;
      }
      const args = text.slice(match.index + match[0].length, index - 1).trim().replace(/,$/, '');
      if (args !== '' && commas === 0) out.push(`${file}:${text.slice(0, match.index).split('\n').length}`);
    }
  }
  return out;
}

describe('admin dates use the kit formatter with the admin language (#1776)', () => {
  it('no admin source calls toLocaleDateString or toLocaleTimeString', () => {
    expect(scan(DATE_ONLY)).toEqual({});
  });

  it('every toLocaleString call is a number listed in NUMBER_LEDGER, and every entry is still exact', () => {
    const expected = Object.fromEntries(Object.entries(NUMBER_LEDGER).map(([file, { count }]) => [file, count]));
    expect(scan(DATE_OR_NUMBER)).toEqual(expected);
  });

  it('every formatDate / formatDateTime call passes the admin language', () => {
    expect(oneArgumentCalls()).toEqual([]);
  });

  it('the scan still sees the sources, so the rules above still mean something', () => {
    expect(roots().flatMap(sources).length).toBeGreaterThan(500);
  });
});
