/**
 * Admin dates are written in the admin UI language, never the browser's own
 * locale — issue #1776 (UX audit #1567, follow-up of #1773).
 *
 * One Opportunity sidebar used to show `17.11.2026`, `11/25/2026` and
 * `Nov 22, 2026` side by side: some dates came from the kit formatter with the
 * admin language, the others from `Date#toLocaleDateString()` /
 * `toLocaleString()` with whatever locale the browser happened to have. Every
 * date now goes through the kit's `formatDate(value, language)` /
 * `formatDateTime(iso, language)` (`@endora-commerce/admin-kit/lib`), and their
 * `language` is required, so the browser-locale fallback is gone.
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
 *   formatter) or a number (add it here, with its reason).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** `toLocaleString(` calls that format a number, not a date. Keyed by repo-relative file. */
const NUMBER_LEDGER: Record<string, { count: number; reason: string }> = {
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

describe('admin dates use the kit formatter with the admin language (#1776)', () => {
  it('no admin source calls toLocaleDateString or toLocaleTimeString', () => {
    expect(scan(DATE_ONLY)).toEqual({});
  });

  it('every toLocaleString call is a number listed in NUMBER_LEDGER, and every entry is still exact', () => {
    const expected = Object.fromEntries(Object.entries(NUMBER_LEDGER).map(([file, { count }]) => [file, count]));
    expect(scan(DATE_OR_NUMBER)).toEqual(expected);
  });

  it('the scan still sees the sources, so the rules above still mean something', () => {
    expect(roots().flatMap(sources).length).toBeGreaterThan(500);
  });
});
