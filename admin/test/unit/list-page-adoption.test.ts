/**
 * Every admin list screen is the kit `ListPage` — issue #1749 (UX audit
 * 2026-11-17, follow-up of DS-05 #1439; tracking #1567).
 *
 * DS-05 gave the admin one list page: `PageHeader` with the one *New …*, a
 * toolbar row without a card, one results region holding the table, the
 * `PaginationFooter` under it, row actions in `RowActionMenu`, and the
 * loading / error / empty states drawn the same way on every list. A screen
 * that draws its own header and table around them comes out a different shape
 * from its neighbours (Similarity, Jakob) and leaves out a state the kit
 * already draws — the skeleton, the retry, the announced count (WCAG 4.1.3).
 *
 * The population is every non-test `.tsx` screen of the admin app, the shell
 * and every module's `src/admin/` / `src/admin-ui/` that renders a
 * `<PageHeader>` and a table (`<table>`, `<Table>` or `<ResponsiveTable>`)
 * without a `<ListPage>`. Each one is in exactly one of two ledgers:
 *
 * - `NOT_YET_ON_LIST_PAGE` — a list screen still hand-rolled. **Shrink-only**:
 *   a screen leaves it in the merge request that moves it onto `ListPage`, and
 *   an entry that no longer matches fails, so it cannot outlive its screen.
 *   Never add one: a new list is a `ListPage` from its first commit.
 * - `NOT_A_LIST` — a screen that draws a header and a table but is not a list
 *   of records: a record's detail page, an editor, a wizard, a dashboard. Each
 *   says why. An entry that no longer matches fails here too.
 *
 * A screen in neither fails, and so does one in both.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Where screens live. Repo-relative globs. */
const SCANNED = [
  'admin/src/**/*.tsx',
  'packages/admin-shell/src/**/*.tsx',
  'packages/modules/*/src/admin/**/*.tsx',
  'packages/modules/*/src/admin-ui/**/*.tsx',
];

/**
 * The adoption backlog: list screens not yet on `ListPage`. Repo-relative
 * file → the audit area it belongs to. Shrink-only — see the header.
 */
const NOT_YET_ON_LIST_PAGE: Record<string, string> = {
  'packages/admin-shell/src/modules/platform/CommandHooksPage.tsx': 'shell',
  'packages/modules/catalog/src/admin/pages/ProductsList.tsx': 'catalog',
  'packages/modules/crm/src/admin/pages/OpportunitiesList.tsx': 'work',
  'packages/modules/crm/src/admin/pages/TagsPage.tsx': 'work',
  'packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx': 'shell',
  'packages/modules/inventory/src/admin/pages/AvailabilityNotificationsPage.tsx': 'catalog',
  'packages/modules/inventory/src/admin/pages/InventoryPage.tsx': 'catalog',
  'packages/modules/inventory/src/admin/pages/LowStockPage.tsx': 'catalog',
  'packages/modules/inventory/src/admin/pages/WarehousesList.tsx': 'catalog',
  'packages/modules/newsletter/src/admin/pages/AutomationsPage.tsx': 'content',
  'packages/modules/newsletter/src/admin/pages/BlocksPage.tsx': 'content',
  'packages/modules/newsletter/src/admin/pages/CampaignsPage.tsx': 'content',
  'packages/modules/newsletter/src/admin/pages/SubscribersPage.tsx': 'content',
  'packages/modules/orders/src/admin/pages/OrderStatusConfigPage.tsx': 'sales',
  'packages/modules/price_lists/src/admin/pages/DisplayModeOverridesPage.tsx': 'catalog',
  'packages/modules/price_lists/src/admin/pages/PriceBooksPage.tsx': 'catalog',
  'packages/modules/product_feeds/src/admin/pages/FeedTemplatesListPage.tsx': 'catalog',
  'packages/modules/product_feeds/src/admin/pages/ProductFeedsListPage.tsx': 'catalog',
  'packages/modules/projects/src/admin/components/DictionaryScreen.tsx': 'work',
  'packages/modules/projects/src/admin/pages/ProjectsList.tsx': 'work',
  'packages/modules/projects/src/admin/pages/TemplatesList.tsx': 'work',
  'packages/modules/returns/src/admin/pages/ReturnClausesPage.tsx': 'sales',
  'packages/modules/returns/src/admin/pages/ReturnDeliveryMethodsPage.tsx': 'sales',
  'packages/modules/returns/src/admin/pages/ReturnReasonsPage.tsx': 'sales',
  'packages/modules/returns/src/admin/pages/ReturnStatusesConfigPage.tsx': 'sales',
  'packages/modules/tasks/src/admin/pages/MyTasksPage.tsx': 'work',
  'packages/modules/tasks/src/admin/pages/TasksPage.tsx': 'work',
  'packages/modules/tasks/src/admin/pages/settings/TaskPrioritiesPage.tsx': 'work',
  'packages/modules/tasks/src/admin/pages/settings/TaskTagsPage.tsx': 'work',
  'packages/modules/transactional_emails/src/admin/pages/EmailBlocksPage.tsx': 'content',
  'packages/modules/transactional_emails/src/admin/pages/EmailTemplatesPage.tsx': 'content',
};

/**
 * The backlog's size when the ratchet landed, less what has moved since. It
 * only ever goes down, with the entries above.
 */
const BACKLOG_CEILING = 31;

/** Screens with a header and a table that are not a list of records. */
const NOT_A_LIST: Record<string, string> = {
  'packages/modules/analytics/src/admin/pages/AnalyticsPage.tsx': 'a dashboard of event counts',
  'packages/modules/carts/src/admin/pages/CartDetail.tsx': "one cart's detail; the table is its lines",
  'packages/modules/catalog/src/admin/pages/BulkOperationDetailPage.tsx': "one bulk operation's detail and its per-item results",
  'packages/modules/catalog/src/admin/pages/CategoriesTree.tsx': 'a tree editor, not a paged list',
  'packages/modules/catalog/src/admin/pages/ProductEditor.tsx': "a product's editor; the tables are its variants and units",
  'packages/modules/cms/src/admin/pages/BrandPage.tsx': 'the brand settings editor',
  'packages/modules/cms/src/admin/pages/HooksPage.tsx':
    "a master-detail screen: the hook list beside the selected hook's attached blocks, already on the kit states",
  'packages/modules/comparisons/src/admin/pages/ComparisonDetailPage.tsx': "one comparison's detail; the table is its products",
  'packages/modules/import_export/src/admin/pages/ImportExportPage.tsx': 'the import/export centre: forms beside a job history',
  'packages/modules/inventory/src/admin/pages/StockImportWizard.tsx': 'a stock-import wizard; the table previews the file',
  'packages/modules/invoices/src/admin/pages/InvoiceDetail.tsx': "one invoice's detail; the table is its lines",
  'packages/modules/newsletter/src/admin/pages/CampaignStats.tsx': "one campaign's statistics",
  'packages/modules/orders/src/admin/pages/OrderDetail.tsx': "one order's detail; the table is its lines",
  'packages/modules/product_feeds/src/admin/pages/ProductFeedDetailPage.tsx': "one feed's detail and its deliveries",
  'packages/modules/promotions/src/admin/pages/PromotionEditPage.tsx': "a promotion's editor",
  'packages/modules/quick_order/src/admin/pages/QuickOrderOnBehalfPage.tsx': 'an order-entry form; the table is the lines being entered',
  'packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx': "one quote request's detail; the table is its lines",
  'packages/modules/returns/src/admin/pages/ReturnDetail.tsx': "one return's detail; the table is its lines",
  'packages/modules/seo/src/admin/pages/SeoPage.tsx': 'two tool panels: the sitemap status and the meta editor',
};

const HEADER = /<PageHeader\b/;
const TABLE = /<(?:table|Table|ResponsiveTable)\b/;
const LIST_PAGE = /<ListPage\b/;

/** Whether a screen draws its own list page: a header and a table, and no `ListPage`. */
function drawsItsOwnListPage(text: string): boolean {
  return HEADER.test(text) && TABLE.test(text) && !LIST_PAGE.test(text);
}

function sources(): string[] {
  const out = execFileSync('git', ['ls-files', '--', ...SCANNED], { cwd: repoRoot, encoding: 'utf8' });
  return out.split('\n').filter((file) => file !== '' && !/\.test\.tsx?$/.test(file));
}

function handRolled(): string[] {
  return sources()
    .filter((file) => drawsItsOwnListPage(readFileSync(path.join(repoRoot, file), 'utf8')))
    .sort();
}

describe('admin list screens are the kit ListPage (#1749, DS-05)', () => {
  it('every screen that draws its own header and table is a listed backlog entry or not a list', () => {
    const unlisted = handRolled().filter((file) => !(file in NOT_YET_ON_LIST_PAGE) && !(file in NOT_A_LIST));
    expect(unlisted, 'a new list screen renders <ListPage>; a detail or editor page goes in NOT_A_LIST with its reason').toEqual([]);
  });

  it('every ledger entry is still a hand-rolled screen — a migrated one leaves the backlog', () => {
    const found = new Set(handRolled());
    const stale = [...Object.keys(NOT_YET_ON_LIST_PAGE), ...Object.keys(NOT_A_LIST)].filter((file) => !found.has(file));
    expect(stale, 'remove these entries: the screen is on ListPage now, or has gone').toEqual([]);
  });

  it('no screen is in both ledgers, and the backlog only shrinks', () => {
    expect(Object.keys(NOT_YET_ON_LIST_PAGE).filter((file) => file in NOT_A_LIST)).toEqual([]);
    expect(Object.keys(NOT_YET_ON_LIST_PAGE).length).toBeLessThanOrEqual(BACKLOG_CEILING);
  });

  it('tells a hand-rolled list from a ListPage, so the rules above still mean something', () => {
    expect(sources().length).toBeGreaterThan(300);
    expect(drawsItsOwnListPage('<PageHeader title="x" /><Card><Table>')).toBe(true);
    expect(drawsItsOwnListPage('<PageHeader title="x" /><table className="w-full">')).toBe(true);
    expect(drawsItsOwnListPage('<ListPage title="x"><ResponsiveTable columns={c} />')).toBe(false);
    expect(drawsItsOwnListPage('<PageHeader title="x" /><form>')).toBe(false);
  });
});
