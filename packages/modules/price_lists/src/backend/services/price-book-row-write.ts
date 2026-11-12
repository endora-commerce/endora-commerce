import {
  ERROR_CODES,
  type BookProductRows,
  type BookProductRowsWrite,
  type PriceBookRowError,
  type VariantRowWrite,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { StoredRow } from './price-book-batch.js';
import { selectionKey, type RuleIssue } from './price-book-rules.js';

/**
 * Issue #1028 — the pure steps of `priceBookRowWritePort`: a module's write of
 * one product's rows in one non-base book. The write itself is the admin row
 * batch (`PriceBookService.writeRows`' planning and command), so a module's
 * rows obey exactly the rules an administrator's do; what lives here is what
 * comes before it — which books take the write, which batch it is — and how
 * the stored rows read back in the write's shape.
 */

/** A batch row of `PUT …/rows`, by ids (`priceBookBatchRowInputSchema`). */
export interface ModuleBatchRow {
  selection: { productId: string; variantId?: string };
  minQuantity: number;
  maxQuantity: number | null;
  price: { type: 'fixed'; amount: string } | { type: 'percent'; percent: string } | { type: 'amount'; amount: string };
}

/**
 * A module writes rows of a book an administrator keeps: not a base book,
 * whose rows are base prices (`priceBookWritePort`), and not an expired one,
 * which prices nothing — by its status, or by an end already past that the
 * status sweep has not reached yet. A draft or a scheduled book takes rows: an
 * administrator may prepare one for a connector to fill.
 */
export function assertBookTakesModuleRows(
  book: { isSystem: boolean; status: string; endsAt?: Date | null },
  now: number,
): void {
  if (book.isSystem) {
    throw new HttpError(
      409,
      ERROR_CODES.PRICE_BOOK_BASE_BOOK,
      "This is a base book: its rows are base prices, written through priceBookWritePort or the product's base-price editor.",
    );
  }
  if (book.status === 'expired' || (book.endsAt && book.endsAt.getTime() <= now)) {
    throw new HttpError(409, ERROR_CODES.PRICE_BOOK_EXPIRED, 'This price book has expired and takes no price rows.');
  }
}

/**
 * Whether the port's write shape can say a stored row of a product: a fixed
 * tier (of the product or of a variant), or a variant's percentage or amount
 * adjustment at every quantity (from 1, no end). Anything else — a
 * product-level adjustment, an adjustment limited to a quantity range, a row
 * that also selects a category or attribute — was entered by an administrator,
 * and the port neither reads it into the shape, nor replaces it, nor removes
 * it (owner decision on issue #1028); `BookProductRows.complete` flags it.
 */
export function expressibleByPort(row: StoredRow): boolean {
  if (row.categoryId !== null || row.attributeKey !== null) return false;
  if (row.priceType === 'fixed') return row.amount !== null;
  return row.variantId !== null && row.minQuantity === 1 && row.maxQuantity === null;
}

/**
 * The admin batch one write is, in `merge` mode: the product's tiers as fixed
 * product rows, each named variant's row as variant rows (a percentage or an
 * amount at every quantity), and the deletion of the rows in the write's reach
 * that it no longer holds — the product's own fixed tiers, and the
 * {@link expressibleByPort} rows of each named variant. A row the write shape
 * cannot say is never in reach: it stays, and a tier that would overlap it is
 * refused by the batch's overlap rule. A batch row with the selection and start of a
 * stored row replaces it in place (the batch's own rule), so a tier nobody
 * changed keeps its id. A variant that is not named keeps its rows.
 *
 * `paths[i]` is the write path of `upsert[i]`, for {@link writePathOf}.
 */
export function planBookProductRows(input: {
  productId: string;
  write: BookProductRowsWrite;
  /** Every stored row of the product (and its variants) in the book. */
  stored: readonly StoredRow[];
  variantIdsOfProduct: ReadonlySet<string>;
}): { upsert: ModuleBatchRow[]; paths: string[]; delete: string[]; issues: RuleIssue[] } {
  const { productId, write } = input;
  const upsert: ModuleBatchRow[] = [];
  const paths: string[] = [];
  const issues: RuleIssue[] = [];
  write.product.forEach((tier, i) => {
    upsert.push({
      selection: { productId },
      minQuantity: tier.minQuantity,
      maxQuantity: tier.maxQuantity,
      price: { type: 'fixed', amount: tier.amount },
    });
    paths.push(`product.${i}`);
  });
  const namedVariants = new Set<string>();
  for (const [variantId, row] of Object.entries(write.variants ?? {})) {
    if (!input.variantIdsOfProduct.has(variantId)) {
      issues.push({ path: ['variants', variantId], message: 'This variant does not belong to the product.', reason: 'variant_other_product' });
      continue;
    }
    namedVariants.add(variantId);
    if (row !== null) variantBatchRows(productId, variantId, row, upsert, paths);
  }

  const written = new Set(
    upsert.map(
      (r) =>
        `${selectionKey({ variantId: r.selection.variantId ?? null, productId, categoryId: null, attributeKey: null, attributeValue: null })}#${r.minQuantity}`,
    ),
  );
  const inReach = (row: StoredRow): boolean =>
    row.productId === productId &&
    expressibleByPort(row) &&
    (row.variantId === null || namedVariants.has(row.variantId));
  const deleteIds = input.stored
    .filter((row) => inReach(row) && !written.has(`${selectionKey(row)}#${row.minQuantity}`))
    .map((row) => row.id);
  return { upsert, paths, delete: deleteIds, issues };
}

function variantBatchRows(
  productId: string,
  variantId: string,
  row: VariantRowWrite,
  upsert: ModuleBatchRow[],
  paths: string[],
): void {
  const selection = { productId, variantId };
  if (row.type === 'fixed') {
    row.tiers.forEach((tier, i) => {
      upsert.push({ selection, minQuantity: tier.minQuantity, maxQuantity: tier.maxQuantity, price: { type: 'fixed', amount: tier.amount } });
      paths.push(`variants.${variantId}.tiers.${i}`);
    });
    return;
  }
  upsert.push({
    selection,
    minQuantity: 1,
    maxQuantity: null,
    price: row.type === 'percent' ? { type: 'percent', percent: row.percent } : { type: 'amount', amount: row.amount },
  });
  paths.push(`variants.${variantId}`);
}

/**
 * A refused batch row named in the caller's terms: its field prefixed with the
 * row's path in the write, and no `index` (the batch is internal). An error of
 * the whole batch (the row limit) keeps its field.
 */
export function writePathOf(paths: readonly string[], error: PriceBookRowError): PriceBookRowError {
  const { index, ...rest } = error;
  if (index === undefined || paths[index] === undefined) return rest;
  return { ...rest, field: `${paths[index]}.${error.field}` };
}

/**
 * The stored rows of one product in one book, in the write's shape: the
 * product's fixed tiers, and per variant its fixed tiers or its adjustment at
 * every quantity. A row the shape cannot say ({@link expressibleByPort}) is
 * left out and the answer marked not `complete`; a write leaves such rows as
 * they are.
 */
export function bookProductRowsOf(
  header: Pick<BookProductRows, 'bookId' | 'productId' | 'currencyCode' | 'version'>,
  rows: readonly StoredRow[],
): BookProductRows {
  const ordered = [...rows].sort((a, b) => a.minQuantity - b.minQuantity);
  let complete = true;
  const product: BookProductRows['product'] = [];
  const variants: BookProductRows['variants'] = {};
  for (const row of ordered) {
    if (row.productId !== header.productId) continue;
    if (!expressibleByPort(row)) {
      complete = false;
      continue;
    }
    if (row.variantId === null) {
      product.push({ minQuantity: row.minQuantity, maxQuantity: row.maxQuantity, amount: row.amount! });
      continue;
    }
    if (row.priceType === 'fixed') {
      const held = variants[row.variantId];
      const tier = { minQuantity: row.minQuantity, maxQuantity: row.maxQuantity, amount: row.amount! };
      if (held?.type === 'fixed') held.tiers.push(tier);
      else variants[row.variantId] = { type: 'fixed', tiers: [tier] };
      continue;
    }
    // An adjustment at every quantity overlaps any other row of its variant, so it is the only one.
    variants[row.variantId] =
      row.priceType === 'percent' ? { type: 'percent', percent: row.percent ?? '0.00' } : { type: 'amount', amount: row.amount ?? '0.0000' };
  }
  return { ...header, product, variants, complete };
}

/** One line of the book's price-change history (`price_list_row_value_changes`), before its ids. */
export interface RowValueLine {
  kind: 'added' | 'changed' | 'removed';
  variantId: string | null;
  productId: string | null;
  categoryId: string | null;
  attributeKey: string | null;
  attributeValue: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  beforePriceType: StoredRow['priceType'] | null;
  beforeAmount: string | null;
  beforePercent: string | null;
  afterPriceType: StoredRow['priceType'] | null;
  afterAmount: string | null;
  afterPercent: string | null;
}

/**
 * The price-change history lines of one batch (issue #470, D-288; owner ruling
 * O-3): a row that kept its coordinate — selection and quantity window — and
 * moved its price is one `changed` line; a row whose coordinate moved is one
 * `removed` and one `added` line. Only rows that differ appear. Ordered by
 * selection, then window start, so a history reads as the book does.
 */
export function rowValueLines(plan: {
  added: readonly StoredRow[];
  changed: ReadonlyArray<{ before: StoredRow; after: StoredRow }>;
  removed: readonly StoredRow[];
}): RowValueLine[] {
  const coordinate = (r: StoredRow) => ({
    variantId: r.variantId,
    productId: r.productId,
    categoryId: r.categoryId,
    attributeKey: r.attributeKey,
    attributeValue: r.attributeValue,
    minQuantity: r.minQuantity,
    maxQuantity: r.maxQuantity,
  });
  const side = (r: StoredRow | null, prefix: 'before' | 'after') => ({
    [`${prefix}PriceType`]: r ? r.priceType : null,
    [`${prefix}Amount`]: r ? r.amount : null,
    [`${prefix}Percent`]: r ? r.percent : null,
  });
  const line = (kind: RowValueLine['kind'], before: StoredRow | null, after: StoredRow | null): RowValueLine =>
    ({ kind, ...coordinate((after ?? before)!), ...side(before, 'before'), ...side(after, 'after') }) as RowValueLine;
  const lines: RowValueLine[] = [...plan.added.map((r) => line('added', null, r)), ...plan.removed.map((r) => line('removed', r, null))];
  for (const { before, after } of plan.changed) {
    if (selectionKey(before) === selectionKey(after) && before.maxQuantity === after.maxQuantity) {
      lines.push(line('changed', before, after));
    } else {
      lines.push(line('removed', before, null), line('added', null, after));
    }
  }
  return lines.sort(
    (a, b) =>
      selectionKey(a).localeCompare(selectionKey(b)) || a.minQuantity - b.minQuantity || a.kind.localeCompare(b.kind),
  );
}
