import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * The Products list's tabs (feature 163, FR-113, research R30.4): *All · Active ·
 * Inactive* list products that are **not** archived; *Archived* lists the archived
 * ones of either status. Archived is its own axis on the wire (`archived=only`) and
 * never a status value — `status=archived` is refused by the list.
 */
export type ProductListTab = 'all' | 'active' | 'inactive' | 'archived';

export const PRODUCT_LIST_TABS: readonly ProductListTab[] = ['all', 'active', 'inactive', 'archived'];

export function isProductListTab(value: unknown): value is ProductListTab {
  return typeof value === 'string' && (PRODUCT_LIST_TABS as readonly string[]).includes(value);
}

/** The Archived tab's own address — the palette's "Archived products" opens it (owner PAL-1 → B). */
export const ARCHIVED_PRODUCTS_PATH = '/catalog/products/archived';

/**
 * The tab a URL asks for: the Archived tab's own path, else a `?status=` naming a tab
 * (a bookmarked `?status=archived` included), else *All*.
 */
export function productListTabFromUrl(pathname: string, search: string): ProductListTab {
  if (pathname.replace(/\/+$/, '') === ARCHIVED_PRODUCTS_PATH) return 'archived';
  const status = new URLSearchParams(search).get('status');
  return isProductListTab(status) ? status : 'all';
}

/** What a tab asks the list (and `resolve-ids`) for. */
export interface ProductListTabQuery {
  status?: 'active' | 'inactive';
  archived: 'exclude' | 'only';
}

export function productListTabQuery(tab: ProductListTab): ProductListTabQuery {
  switch (tab) {
    case 'all':
      return { archived: 'exclude' };
    case 'active':
    case 'inactive':
      return { status: tab, archived: 'exclude' };
    case 'archived':
      return { archived: 'only' };
  }
}

/** Issue #1624 — the list's stock filter; `all` is no filter. */
export type ProductListStockFilter = 'all' | 'low' | 'out';

export interface ListFilterSnapshot {
  status: ProductListTab;
  type: 'all' | 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  q: string;
  /** Issue #1624 — a category id (the category and its descendants); `''` is no filter. */
  categoryId: string;
  /** Issue #1624 — a sales-channel id; `''` is no filter. */
  salesChannelId: string;
  stock: ProductListStockFilter;
}

/**
 * Issue #1624 — the category, channel and stock filters as the list endpoint's
 * query parameters and `resolve-ids`' body fields, which carry the same names:
 * the one place both requests take them from, so the selection cannot drift
 * from the list it was made on.
 */
export function productListNarrowing(
  snapshot: Pick<ListFilterSnapshot, 'categoryId' | 'salesChannelId' | 'stock'>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (snapshot.categoryId) out['categoryId'] = snapshot.categoryId;
  if (snapshot.salesChannelId) out['salesChannelId'] = snapshot.salesChannelId;
  if (snapshot.stock !== 'all') out['stock'] = snapshot.stock;
  return out;
}

interface ResolveProductIdsResponse {
  data: { productIds: string[]; total: number };
}

/**
 * The `resolve-ids` body for a frozen list filter. `archived` is always sent: the
 * route's own default is `include` (R30.4), so leaving it out would let "select all
 * N matching" on the All tab reach archived products the operator cannot see.
 */
export function resolveProductSelectionBody(snapshot: ListFilterSnapshot): Record<string, unknown> {
  const tabQuery = productListTabQuery(snapshot.status);
  const body: Record<string, unknown> = { archived: tabQuery.archived };
  if (tabQuery.status) body['status'] = tabQuery.status;
  if (snapshot.type !== 'all') body['type'] = snapshot.type;
  const trimmed = snapshot.q.trim();
  if (trimmed) body['q'] = trimmed;
  return { ...body, ...productListNarrowing(snapshot) };
}

/**
 * Feature 033 — resolve all product ids for the frozen list filter snapshot.
 */
export async function resolveProductSelection(
  snapshot: ListFilterSnapshot,
): Promise<{ productIds: string[]; total: number }> {
  const res = await apiClient.post<ResolveProductIdsResponse>(
    '/api/v1/admin/catalog/products/resolve-ids',
    resolveProductSelectionBody(snapshot),
  );
  return res.data;
}

export const BULK_EDIT_MAX_BATCH_SIZE = 200;

/**
 * Hard client-side ceiling on a single bulk-edit selection, matching the
 * contract's `bulkUpdateProductsRequestSchema` upper bound. Selections
 * between the synchronous threshold and this limit are accepted and
 * processed as a background bulk operation.
 */
export const BULK_EDIT_HARD_MAX = 10_000;
