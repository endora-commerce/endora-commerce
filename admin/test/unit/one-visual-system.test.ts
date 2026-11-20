/**
 * One visual system per screen — issue #1492 (UX audit 2026-11-17, CAT-17).
 *
 * The audit found the product editor, the products list, the inventory list
 * and the pricing settings drawing kit `Card` / `Button` / `Alert` beside the
 * legacy `b2b-card` / `b2b-btn` / `b2b-field` and hand-written `style={{…}}`
 * objects, so buttons, radii, heading sizes and spacing differed between
 * neighbouring sections (Law of Similarity), and status banners drawn as cards
 * carried no live role (WCAG 4.1.3).
 *
 * A screen listed here has been moved to the kit's `ui/*` primitives and
 * Tailwind utilities. This test keeps it there: its source may not name a
 * legacy layout or control class, nor write an inline style object. The
 * remaining `b2b-*` estate is listed on #1492; a screen joins `MIGRATED` in the
 * change that migrates it.
 *
 * Not in the forbidden vocabulary, on purpose:
 * - `b2b-page` / `b2b-page--wide` — the page frame the shell's mobile grid
 *   rules target (`InventoryPage.mobile.test.tsx`); there is no kit page frame.
 * - `b2b-badge*` — the status-pill vocabulary the kit itself renders (its
 *   `Tabs` counts, the product browser); the kit `Badge` has no token colours.
 * - `b2b-empty*` — drawn by the kit's `EmptyState`, which a screen uses.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The screens #1492 names, migrated, then the inventory and pwa modules' remaining screens. Repo-relative. */
const MIGRATED = [
  'packages/modules/catalog/src/admin/components/ProductInventoryTab.tsx',
  'packages/modules/catalog/src/admin/components/PackagingUnitsEditor.tsx',
  'packages/modules/catalog/src/admin/pages/ProductsList.tsx',
  'packages/modules/catalog/src/admin/pages/ProductEditor.tsx',
  'packages/modules/inventory/src/admin/pages/InventoryPage.tsx',
  'packages/modules/inventory/src/admin/zones/ChannelWarehouses.tsx',
  'packages/modules/inventory/src/admin/pages/AvailabilityNotificationsPage.tsx',
  'packages/modules/inventory/src/admin/pages/LowStockPage.tsx',
  'packages/modules/inventory/src/admin/pages/StockImportWizard.tsx',
  'packages/modules/inventory/src/admin/pages/WarehouseEditor.tsx',
  'packages/modules/inventory/src/admin/pages/WarehousesList.tsx',
  'packages/modules/pwa/src/admin/components/PushAudienceRuleBuilder.tsx',
  'packages/modules/price_lists/src/admin/pages/DisplayModeOverridesPage.tsx',
] as const;

/**
 * The legacy classes a kit primitive or a Tailwind utility replaces: `Button`,
 * `Card`, `Input` / `Select` / `Label` / `FormField`, `Table`, `Checkbox`, and
 * the layout and text helpers (`flex`, `gap-*`, `text-muted-foreground`,
 * `font-mono`, `tabular-nums`), the kit `ListToolbar` + `FilterChip` for a
 * filter bar, and a Tailwind `grid` for a form grid.
 */
const LEGACY = /\bb2b-(?:btn|card|field|input|input-wrap|label|help|row|col|grow|tbl|table|mono|muted|tabular|cbx|bulkbar|thumb|scrim|drawer|filterbar|filterchip|grid)(?:--[a-z0-9-]+|__[a-z0-9-]+)?\b/g;

/** Screens that keep one named exception, with why. Two-way: a stale entry fails. */
const EXCEPTIONS: Record<string, { pattern: RegExp; count: number; reason: string }[]> = {
  'packages/modules/price_lists/src/admin/pages/DisplayModeOverridesPage.tsx': [
    {
      pattern: /\bb2b-(?:scrim|drawer(?:__[a-z]+)?)\b/g,
      count: 6,
      reason:
        'the frame of the "Add override" side drawer: no kit drawer exists and no-hand-rolled-overlays.test.ts ledgers it (DRAWER); what is inside it is kit',
    },
  ],
};

function read(file: string): string {
  return readFileSync(path.join(repoRoot, file), 'utf8');
}

/** The drawer's lines, so its ledgered exception does not excuse the rest of the file. */
function withoutExceptions(file: string, source: string): { rest: string; excused: number[] } {
  const entries = EXCEPTIONS[file] ?? [];
  if (entries.length === 0) return { rest: source, excused: [] };
  const start = source.indexOf('function AddOverrideDialog(');
  const end = source.indexOf('\n}\n', start);
  if (start < 0 || end < 0) return { rest: source, excused: entries.map(() => 0) };
  const drawer = source.slice(start, end);
  return {
    rest: source.slice(0, start) + source.slice(end),
    excused: entries.map((entry) => (drawer.match(entry.pattern) ?? []).length),
  };
}

describe('one visual system per migrated screen (#1492, CAT-17)', () => {
  it.each(MIGRATED)('%s names no legacy layout or control class', (file) => {
    const { rest } = withoutExceptions(file, read(file));
    expect(rest.match(LEGACY) ?? []).toEqual([]);
  });

  it.each(MIGRATED)('%s writes no inline style object', (file) => {
    const { rest } = withoutExceptions(file, read(file));
    const lines = rest.split('\n').filter((line) => line.includes('style={{'));
    expect(lines).toEqual([]);
  });

  it.each(Object.entries(EXCEPTIONS))('%s: each exception still describes the file', (file, entries) => {
    const { excused } = withoutExceptions(file, read(file));
    entries.forEach((entry, i) => expect(excused[i], entry.reason).toBe(entry.count));
  });
});
