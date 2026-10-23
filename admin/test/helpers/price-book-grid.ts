import { vi } from 'vitest';
import { within, screen } from '@testing-library/react';
import {
  priceBookLineSchema,
  type PriceBook,
  type PriceBookLine,
  type PriceBookRow,
  type PriceBookSelectionKind,
} from '@endora-commerce/contracts';
import { CATALOG, IDS } from './price-book-fixtures';
import { priceBookRowSchema, type PriceBookRowPrice } from '@endora-commerce/contracts';

/**
 * The grid's server, for the price-book grid tests (feature 161, Phase 5).
 *
 * `serveBook` answers the reads the grid makes — the book, its lines paged by
 * line exactly as `GET …/:id/lines` pages them (general to specific, a product
 * with its variant lines, never split), the pickers' targets, the product
 * browser's list and a product's variants — and records the writes. Lines are
 * built from rows the way the server builds them, keyed by the server's
 * selection key (`variant|product|category|attribute key|value`).
 */

export const B = '/api/v1/admin/price-books';

const KIND_ORDER: readonly PriceBookSelectionKind[] = ['all', 'attribute', 'category', 'category_attribute', 'product', 'variant'];

export function selectionKey(selection: PriceBookRow['selection']): string {
  const variant = selection.variantId ?? '';
  return [variant, variant ? '' : (selection.productId ?? ''), selection.categoryId ?? '', selection.attribute?.key ?? '', selection.attribute?.value ?? ''].join('|');
}

const label = (line: PriceBookLine): string =>
  line.labels.productName ?? line.labels.categoryPath ?? `${line.labels.attributeLabel ?? ''} ${line.labels.attributeValueLabel ?? ''}`;

/** Rows grouped into lines in the server's order; variant lines nested under their product. */
export function linesOf(rows: readonly PriceBookRow[]): PriceBookLine[] {
  const byKey = new Map<string, PriceBookLine>();
  for (const row of rows) {
    const key = selectionKey(row.selection);
    const line = byKey.get(key) ?? {
      selectionKey: key,
      selectionKind: row.selectionKind,
      selection: row.selection,
      labels: row.labels,
      naturalKey: row.naturalKey,
      inactiveReason: row.inactiveReason,
      targetDeleted: row.targetDeleted,
      rows: [],
    };
    byKey.set(key, { ...line, rows: [...line.rows, row].sort((a, b) => a.minQuantity - b.minQuantity) });
  }
  const all = [...byKey.values()];
  const variants = all.filter((l) => l.selectionKind === 'variant');
  const heads = all
    .filter((l) => l.selectionKind !== 'variant')
    .map((l) =>
      l.selectionKind === 'product'
        ? { ...l, variants: variants.filter((v) => v.selection.productId === l.selection.productId) }
        : l,
    )
    .sort((a, b) => KIND_ORDER.indexOf(a.selectionKind) - KIND_ORDER.indexOf(b.selectionKind) || label(a).localeCompare(label(b)));
  return heads.map((l) => priceBookLineSchema.parse(l));
}

export interface ServedBook {
  book: PriceBook;
  lines: PriceBookLine[];
  /** Variants the catalogue knows per product id (the public product read). */
  variants?: Record<string, Array<{ id: string; sku: string }>>;
  /** Products the product browser lists. */
  products?: Array<{ id: string; sku: string; slug: string; name: Record<string, string>; status: 'active'; type: 'simple' | 'configurable' }>;
}

/** The kit transport a test mocks (`vi.hoisted`, handed to `vi.mock`), as the grid sees it. */
export interface MockApi {
  readonly get: ReturnType<typeof vi.fn>;
  readonly post: ReturnType<typeof vi.fn>;
  readonly put: ReturnType<typeof vi.fn>;
  readonly patch: ReturnType<typeof vi.fn>;
  readonly delete: ReturnType<typeof vi.fn>;
}

/** The lines requests made, as query parameters. */
export const lineRequests = (api: MockApi): URLSearchParams[] =>
  api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.split('?')[0]!.endsWith('/lines'))
    .map((url) => new URLSearchParams(url.split('?')[1] ?? ''));

const text = (line: PriceBookLine): string =>
  [line.labels.productName, line.labels.productSku, line.labels.categoryPath, line.labels.attributeLabel, line.labels.attributeValueLabel, line.labels.variantSku]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

export function serveBook(api: MockApi, served: ServedBook): void {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    if (path === `${B}/${served.book.id}`) return { data: served.book };
    if (path === `${B}/${served.book.id}/lines`) {
      const kinds = params.getAll('kind');
      const search = params.get('search')?.toLowerCase();
      const matching = served.lines.filter(
        (l) => (kinds.length === 0 || kinds.includes(l.selectionKind)) && (!search || text(l).includes(search)),
      );
      const page = Number(params.get('page') ?? '1');
      const pageSize = Number(params.get('pageSize') ?? '100');
      return {
        data: matching.slice((page - 1) * pageSize, page * pageSize),
        meta: { page, pageSize, totalLines: matching.length },
      };
    }
    if (path === B) return { data: [], meta: { page: 1, pageSize: 1, totalCount: 0, creatableAudienceKinds: ['everyone', 'customer_groups', 'organizations'] } };
    if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel] } };
    if (path === `${B}/targets/customer-groups`) return { data: { items: CATALOG.customerGroups } };
    if (path === `${B}/targets/organizations`) return { data: { items: CATALOG.organizations } };
    if (path === `${B}/targets/categories`) return { data: { items: CATALOG.categories } };
    if (path === `${B}/targets/attributes`) return { data: { items: CATALOG.attributes } };
    if (path === '/api/v1/admin/catalog/products') {
      // The product browser's list: 0-based pages, as the catalogue answers them.
      const items = served.products ?? [];
      const page = Number(params.get('page') ?? '0');
      const pageSize = Number(params.get('pageSize') ?? '20');
      return {
        data: items.slice(page * pageSize, (page + 1) * pageSize),
        pagination: { page, pageSize, total: items.length },
        counts: { all: items.length, active: items.length, draft: 0, inactive: 0 },
      };
    }
    const variantRead = /^\/api\/v1\/catalog\/products\/([^/]+)$/.exec(path!);
    if (variantRead) return { data: { id: variantRead[1], variants: served.variants?.[variantRead[1]!] ?? [] } };
    throw new Error(`unexpected GET ${url}`);
  });
}

/** The grid's data cell for a line (by its row-header text) and a tier start. */
export function gridCell(lineLabel: RegExp | string, start: number): HTMLElement {
  const grid = screen.getByRole('grid');
  const headers = within(grid).getAllByRole('columnheader').map((h) => h.textContent ?? '');
  const column = headers.findIndex((h) => h === `From ${start}` || h === `Od ${start}`);
  if (column < 1) throw new Error(`no column for ${start}: ${headers.join(', ')}`);
  const row = within(grid)
    .getAllByRole('row')
    .find((r) => {
      const header = within(r).queryByRole('rowheader');
      return header !== null && (typeof lineLabel === 'string' ? header.textContent?.includes(lineLabel) : lineLabel.test(header.textContent ?? ''));
    });
  if (!row) throw new Error(`no line ${String(lineLabel)}`);
  return within(row).getAllByRole('gridcell')[column - 1]!;
}

/** The row headers in display order. */
export function lineHeaders(): string[] {
  return within(screen.getByRole('grid'))
    .getAllByRole('rowheader')
    .map((h) => h.textContent ?? '');
}

const NO_LABELS = {
  productName: null,
  productSku: null,
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};

let rowSeq = 0;

/** One stored row of the fixture catalogue, labelled as the server labels it. */
export function mkRow(spec: {
  readonly all?: true;
  readonly product?: { readonly id: string; readonly sku: string; readonly name: string };
  readonly variant?: { readonly id: string; readonly sku: string };
  readonly category?: 'screws' | 'bolts';
  readonly color?: 'red' | 'blue';
  readonly min?: number;
  readonly max?: number | null;
  readonly price: PriceBookRowPrice;
  readonly inactiveReason?: PriceBookRow['inactiveReason'];
  readonly targetDeleted?: boolean;
}): PriceBookRow {
  rowSeq += 1;
  const category = spec.category ? CATALOG.categories.find((c) => c.id === IDS.categories[spec.category!])! : null;
  const kind: PriceBookSelectionKind = spec.variant
    ? 'variant'
    : spec.product
      ? 'product'
      : category && spec.color
        ? 'category_attribute'
        : category
          ? 'category'
          : spec.color
            ? 'attribute'
            : 'all';
  return priceBookRowSchema.parse({
    id: `00000000-0000-4000-8000-${(0x1620000 + rowSeq).toString(16).padStart(12, '0')}`,
    selectionKind: kind,
    selection: {
      variantId: spec.variant?.id ?? null,
      productId: spec.product?.id ?? null,
      categoryId: category?.id ?? null,
      attribute: spec.color ? { key: 'color', value: spec.color } : null,
    },
    minQuantity: spec.min ?? 1,
    maxQuantity: spec.max ?? null,
    price: spec.price,
    inactiveReason: spec.inactiveReason ?? null,
    targetDeleted: spec.targetDeleted ?? false,
    labels: {
      ...NO_LABELS,
      productName: spec.product?.name ?? null,
      productSku: spec.product?.sku ?? null,
      variantSku: spec.variant?.sku ?? null,
      variantLabel: spec.variant ? `Variant ${spec.variant.sku}` : null,
      categoryPath: category ? category.name['en-US'] : null,
      attributeLabel: spec.color ? 'Color' : null,
      attributeValueLabel: spec.color ? (spec.color === 'red' ? 'Red' : 'Blue') : null,
    },
    naturalKey: {},
  });
}

export const PRODUCTS = {
  P1: { id: IDS.products.P1, sku: 'P1', name: 'Screws 0200' },
  P2: { id: IDS.products.P2, sku: 'P2', name: 'Screws 0300' },
  P3: { id: IDS.products.P3, sku: 'P3', name: 'Bolt 10' },
} as const;

export const VARIANTS = {
  V1: { id: '00000000-0000-4000-8000-000000161b11', sku: 'P1-RED-L' },
  V2: { id: '00000000-0000-4000-8000-000000161b12', sku: 'P1-RED-XL' },
} as const;
