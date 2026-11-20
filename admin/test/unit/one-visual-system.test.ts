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
 * change that migrates it, and a module whose whole admin surface is migrated
 * joins `MIGRATED_DIRS`, which holds every screen it adds later too. A screen
 * that keeps a named exception (a drawer frame, a computed width) says so in
 * `EXCEPTIONS`, counted.
 *
 * Not in the forbidden vocabulary, on purpose:
 * - `b2b-page` / `b2b-page--wide` — the page frame the shell's mobile grid
 *   rules target (`InventoryPage.mobile.test.tsx`); there is no kit page frame.
 * - `b2b-badge*` — the status-pill vocabulary the kit itself renders (its
 *   `Tabs` counts, the product browser); the kit `Badge` has no token colours.
 * - `b2b-empty*` — drawn by the kit's `EmptyState`, which a screen uses.
 */
import { readFileSync, readdirSync } from 'node:fs';
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
 * Modules whose whole admin surface is migrated: every `.tsx` under the
 * directory is held, so a screen added later cannot bring the legacy classes
 * back. Repo-relative.
 */
const MIGRATED_DIRS = [
  'packages/modules/import_export/src/admin',
  'packages/modules/price_lists/src/admin',
  'packages/modules/product_feeds/src/admin',
  'packages/modules/seo/src/admin',
] as const;

function screensUnder(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.tsx') && !/\.test\.tsx$/.test(entry))
    .map((entry) => `${dir}/${entry.split(path.sep).join('/')}`)
    .sort();
}

const SCREENS = [...new Set([...MIGRATED, ...MIGRATED_DIRS.flatMap(screensUnder)])];

/**
 * The legacy classes a kit primitive or a Tailwind utility replaces: `Button`,
 * `Card`, `Input` / `Select` / `Label` / `FormField`, `Table`, `Checkbox`, and
 * the layout and text helpers (`flex`, `gap-*`, `text-muted-foreground`,
 * `font-mono`, `tabular-nums`), the kit `ListToolbar` + `FilterChip` for a
 * filter bar, and a Tailwind `grid` for a form grid.
 */
const LEGACY = /\bb2b-(?:btn|card|field|input|input-wrap|label|help|row|col|grow|tbl|table|mono|muted|tabular|cbx|bulkbar|thumb|scrim|drawer|filterbar|filterchip|grid)(?:--[a-z0-9-]+|__[a-z0-9-]+)?\b/g;

/**
 * A named exception a screen keeps, with why. `classes` excuses the legacy
 * classes the pattern matches; `styles` excuses the `style={{…}}` lines it
 * matches. `count` is the number of matches in the whole file, so the
 * exception is two-way: a stale entry fails as surely as a new usage does.
 */
interface Exception {
  kind: 'classes' | 'styles';
  pattern: RegExp;
  count: number;
  reason: string;
}

const DRAWER_FRAME =
  'the frame of a side drawer: no kit drawer exists and no-hand-rolled-overlays.test.ts ledgers it (DRAWER); what is inside it is kit';
const SCRIM =
  'the scrim of an alertdialog that no-hand-rolled-overlays.test.ts ledgers for its move to ConfirmDialog (follow-up to #1444)';
const COMPUTED =
  'a dimension computed at run time (a bar width, a tree indent), which no Tailwind utility can express';

const DRAWER_CLASSES = /\bb2b-(?:scrim|drawer(?:--[a-z]+|__[a-z]+)?)\b/g;
const SCRIM_CLASS = /\bb2b-scrim\b/g;
const COMPUTED_STYLE = /style=\{\{ (?:width|paddingLeft): `\$\{[^}]+\}(?:%|px)` \}\}/;

const EXCEPTIONS: Record<string, Exception[]> = {
  'packages/modules/price_lists/src/admin/pages/DisplayModeOverridesPage.tsx': [
    { kind: 'classes', pattern: DRAWER_CLASSES, count: 6, reason: DRAWER_FRAME },
  ],
  'packages/modules/product_feeds/src/admin/components/TemplatePreviewController.tsx': [
    { kind: 'classes', pattern: DRAWER_CLASSES, count: 6, reason: DRAWER_FRAME },
  ],
  'packages/modules/product_feeds/src/admin/components/RevisionImpactDrawer.tsx': [
    { kind: 'classes', pattern: DRAWER_CLASSES, count: 6, reason: DRAWER_FRAME },
    { kind: 'styles', pattern: COMPUTED_STYLE, count: 1, reason: COMPUTED },
  ],
  'packages/modules/product_feeds/src/admin/pages/FeedTemplateEditorPage.tsx': [
    // The inspector drawer below desktop (5) and the remove-required alertdialog's scrim (1).
    { kind: 'classes', pattern: DRAWER_CLASSES, count: 6, reason: `${DRAWER_FRAME}; and ${SCRIM}` },
  ],
  'packages/modules/product_feeds/src/admin/components/ConsequenceDialog.tsx': [
    { kind: 'classes', pattern: SCRIM_CLASS, count: 1, reason: SCRIM },
  ],
  'packages/modules/product_feeds/src/admin/components/CategoryMappingRow.tsx': [
    { kind: 'styles', pattern: COMPUTED_STYLE, count: 1, reason: COMPUTED },
  ],
  'packages/modules/product_feeds/src/admin/pages/CategoryMappingPage.tsx': [
    { kind: 'styles', pattern: COMPUTED_STYLE, count: 1, reason: COMPUTED },
  ],
};

function read(file: string): string {
  return readFileSync(path.join(repoRoot, file), 'utf8');
}

function excused(file: string, kind: Exception['kind']): Exception[] {
  return (EXCEPTIONS[file] ?? []).filter((entry) => entry.kind === kind);
}

function legacyClasses(file: string): string[] {
  const allowed = excused(file, 'classes');
  return (read(file).match(LEGACY) ?? []).filter(
    (name) => !allowed.some((entry) => new RegExp(`^(?:${entry.pattern.source})$`).test(name)),
  );
}

function inlineStyles(file: string): string[] {
  const allowed = excused(file, 'styles');
  return read(file)
    .split('\n')
    .filter((line) => line.includes('style={{'))
    .filter((line) => !allowed.some((entry) => entry.pattern.test(line)))
    .map((line) => line.trim());
}

function exceptionCount(file: string, entry: Exception): number {
  const source = read(file);
  if (entry.kind === 'classes') return (source.match(entry.pattern) ?? []).length;
  return source.split('\n').filter((line) => entry.pattern.test(line)).length;
}

describe('one visual system per migrated screen (#1492, CAT-17)', () => {
  it('finds the screens of every migrated module directory', () => {
    for (const dir of MIGRATED_DIRS) expect(screensUnder(dir).length, dir).toBeGreaterThan(0);
  });

  it.each(SCREENS)('%s names no legacy layout or control class', (file) => {
    expect(legacyClasses(file)).toEqual([]);
  });

  it.each(SCREENS)('%s writes no inline style object', (file) => {
    expect(inlineStyles(file)).toEqual([]);
  });

  it.each(Object.entries(EXCEPTIONS))('%s: each exception still describes the file', (file, entries) => {
    expect(SCREENS).toContain(file);
    for (const entry of entries) expect(exceptionCount(file, entry), entry.reason).toBe(entry.count);
  });
});
