import {
  priceBookBatchRowInputSchema,
  priceBookRowShapeIssues,
  priceBookSelectionKind,
  PRICE_BOOK_MAX_ROWS,
  type CatalogAttributeView,
  type PriceBookBatchRowInput,
  type PriceBookDiffRow,
  type PriceBookNaturalKey,
  type PriceBookRowError,
  type PriceBookRowErrorReason,
  type PriceBookRowInput,
  type PriceBookRowPrice,
  type PriceBookRowsDryRun,
} from '@endora-commerce/contracts';
import { attributeInactiveReason } from './attribute-eligibility.js';
import { normaliseAmount, normaliseSignedAmount, normaliseSignedPercent } from './matrix-decimal.js';
import { baseBookRowIssues, rowOverlaps, selectionKey, type PlannedRow } from './price-book-rules.js';

/**
 * Planning one admin row batch of a price book — feature 160 (US7, G6, G7, G10
 * of `specs/161-price-book-editor/`).
 *
 * Everything that comes before the write, on rows already read: each `upsert`
 * row parsed on its own (so a refusal names **every** failing row with its
 * index, G6), its selection resolved from ids or from a natural key (G10), the
 * shape, base-book (G7), target and eligibility rules applied, the batch merged
 * with or replacing the stored rows, the per-book limit and the overlap rule
 * checked over the result, and the diff against what is stored. The service
 * does the lookups in a bounded number of statements and the write in one
 * command; a dry run returns this plan and writes nothing.
 */

export interface StoredRow extends PlannedRow {
  id: string;
}

/** What the batch's rows name, read in batch by the caller. */
export interface BatchLookups {
  productsById: ReadonlyMap<string, { id: string; sku: string }>;
  productsBySku: ReadonlyMap<string, { id: string; sku: string }>;
  variantsById: ReadonlyMap<string, { id: string; parentProductId: string; sku: string }>;
  variantsBySku: ReadonlyMap<string, { id: string; parentProductId: string; sku: string }>;
  categoriesById: ReadonlyMap<string, { id: string }>;
  /** A category's slug path from the root, joined by `/`, to its id. */
  categoriesByPath: ReadonlyMap<string, string>;
  /** Attribute views by key (`null` = the key names no attribute). */
  attributes: ReadonlyMap<string, CatalogAttributeView | null>;
}

/** The ids and keys a batch names, so the caller reads them once. */
export interface BatchNeeds {
  productIds: Set<string>;
  productSkus: Set<string>;
  variantIds: Set<string>;
  variantSkus: Set<string>;
  categoryIds: Set<string>;
  categoryPaths: Set<string>;
  attributeKeys: Set<string>;
}

export interface BatchPlan {
  /** Per `upsert` index: the row as it would be stored, or `null` when it could not be resolved. */
  resolved: Array<StoredRow | null>;
  /** The book's rows after the batch. */
  final: StoredRow[];
  added: StoredRow[];
  changed: Array<{ before: StoredRow; after: StoredRow }>;
  removed: StoredRow[];
  unchangedCount: number;
  errors: PriceBookRowError[];
}

type Parsed = { index: number; row: PriceBookBatchRowInput };

/** Parse each `upsert` row on its own; a row that does not parse is an error naming its index. */
export function parseBatchRows(upsert: readonly unknown[]): { parsed: Parsed[]; errors: PriceBookRowError[] } {
  const parsed: Parsed[] = [];
  const errors: PriceBookRowError[] = [];
  upsert.forEach((raw, index) => {
    const result = priceBookBatchRowInputSchema.safeParse(raw);
    if (result.success) {
      parsed.push({ index, row: result.data });
      return;
    }
    // One error per field, the first message for it.
    const seen = new Set<string>();
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || 'row';
      if (seen.has(field)) continue;
      seen.add(field);
      errors.push({ index, field, code: 'PRICE_BOOK_ROW_SHAPE', reason: 'row_invalid', message: issue.message });
    }
  });
  return { parsed, errors };
}

export function batchNeeds(rows: readonly Parsed[]): BatchNeeds {
  const needs: BatchNeeds = {
    productIds: new Set(),
    productSkus: new Set(),
    variantIds: new Set(),
    variantSkus: new Set(),
    categoryIds: new Set(),
    categoryPaths: new Set(),
    attributeKeys: new Set(),
  };
  for (const { row } of rows) {
    if (row.selection) {
      if (row.selection.productId) needs.productIds.add(row.selection.productId);
      if (row.selection.variantId) needs.variantIds.add(row.selection.variantId);
      if (row.selection.categoryId) needs.categoryIds.add(row.selection.categoryId);
      if (row.selection.attribute) needs.attributeKeys.add(row.selection.attribute.key);
    }
    if (row.key) {
      if (row.key.productSku) needs.productSkus.add(row.key.productSku);
      if (row.key.variantSku) needs.variantSkus.add(row.key.variantSku);
      if (row.key.categoryPath) needs.categoryPaths.add(normaliseCategoryPath(row.key.categoryPath));
      if (row.key.attribute) needs.attributeKeys.add(row.key.attribute.key);
    }
  }
  return needs;
}

/** A category path as a key: slugs, lower-case, no empty segment. */
export function normaliseCategoryPath(path: string): string {
  return path
    .split('/')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .join('/');
}

/** The price as stored: amounts at four places, percentages at two. */
export function normalisedPrice(price: PriceBookRowPrice): PriceBookRowPrice {
  switch (price.type) {
    case 'fixed':
      return { type: 'fixed', amount: normaliseAmount(price.amount) };
    case 'amount':
      return { type: 'amount', amount: normaliseSignedAmount(price.amount) };
    case 'percent':
      return { type: 'percent', percent: normaliseSignedPercent(price.percent) };
  }
}

/** A stored row's price. */
export function priceOfStored(row: Pick<PlannedRow, 'priceType' | 'amount' | 'percent'>): PriceBookRowPrice {
  if (row.priceType === 'percent') return { type: 'percent', percent: row.percent ?? '0.00' };
  if (row.priceType === 'amount') return { type: 'amount', amount: row.amount ?? '0.0000' };
  return { type: 'fixed', amount: row.amount ?? '0.0000' };
}

function sameRow(a: PlannedRow, b: PlannedRow): boolean {
  return (
    selectionKey(a) === selectionKey(b) &&
    a.minQuantity === b.minQuantity &&
    a.maxQuantity === b.maxQuantity &&
    a.priceType === b.priceType &&
    (a.amount ?? null) === (b.amount ?? null) &&
    (a.percent ?? null) === (b.percent ?? null)
  );
}

/**
 * Resolve, check, merge and diff one batch. `newId` mints the id of a row that
 * neither names one nor replaces a stored row with the same selection and
 * `minQuantity`.
 */
export function planBatch(input: {
  isBaseBook: boolean;
  /**
   * The stored rows the batch can affect (G18 of 161): in `merge` mode the
   * rows of the selections it touches and the rows it names by id
   * ({@link touchedSelections}); in `replace` mode every row of the book.
   */
  stored: readonly StoredRow[];
  /** How many rows the book holds now, for the per-book limit. */
  storedRowCount: number;
  mode: 'merge' | 'replace';
  parsed: readonly Parsed[];
  parseErrors: readonly PriceBookRowError[];
  deleteIds: readonly string[];
  upsertCount: number;
  lookups: BatchLookups;
  newId: () => string;
}): BatchPlan {
  const errors: PriceBookRowError[] = [...input.parseErrors];
  const resolved: Array<StoredRow | null> = Array.from({ length: input.upsertCount }, () => null);
  const storedById = new Map(input.stored.map((r) => [r.id, r]));
  const storedByKey = new Map(input.stored.map((r) => [`${selectionKey(r)}#${r.minQuantity}`, r]));
  const { lookups } = input;

  for (const { index, row } of input.parsed) {
    const fail: Fail = (field, code, reason, message) => errors.push({ index, field, code, reason, message });
    const before = errors.length;

    // 1. The selection, from ids or from the natural key.
    const selection = selectionOfRow(row, lookups, fail);

    // 2. Shape (FR-005, FR-006) and the base book's rules (FR-009, G7).
    const candidate: PriceBookRowInput = {
      selection,
      minQuantity: row.minQuantity,
      maxQuantity: row.maxQuantity,
      price: row.price,
    };
    if (errors.length === before) {
      for (const issue of priceBookRowShapeIssues(candidate)) {
        fail(issue.path.join('.'), 'PRICE_BOOK_ROW_SHAPE', issue.reason, issue.message);
      }
      if (input.isBaseBook) {
        for (const issue of baseBookRowIssues(candidate)) {
          fail(issue.path.join('.'), 'PRICE_BOOK_ROW_SHAPE', issue.reason ?? 'row_invalid', issue.message);
        }
      }
    }
    if (errors.length > before) continue;

    const price = normalisedPrice(row.price);
    const planned: PlannedRow = {
      ...storedSelectionOf(selection, lookups),
      minQuantity: row.minQuantity,
      maxQuantity: row.maxQuantity,
      priceType: price.type,
      amount: price.type === 'percent' ? null : price.amount,
      percent: price.type === 'percent' ? price.percent : null,
    };
    const replaces = row.id ? storedById.get(row.id) : storedByKey.get(`${selectionKey(planned)}#${planned.minQuantity}`);
    resolved[index] = { id: row.id ?? replaces?.id ?? input.newId(), ...planned };
  }

  for (const id of input.deleteIds) {
    if (!storedById.has(id)) errors.push({ rowId: id, field: 'delete', code: 'PRICE_BOOK_ROW_TARGET', reason: 'row_not_in_book', message: `Row ${id} is not in this book.` });
  }

  // 3. Merge or replace, then the diff.
  const incoming = resolved.filter((r): r is StoredRow => r !== null);
  const incomingIds = new Set(incoming.map((r) => r.id));
  const deleted = new Set(input.deleteIds);
  const kept =
    input.mode === 'replace' ? [] : input.stored.filter((r) => !incomingIds.has(r.id) && !deleted.has(r.id));
  const final = [...kept, ...incoming];
  const added: StoredRow[] = [];
  const changed: Array<{ before: StoredRow; after: StoredRow }> = [];
  // Rows of the batch equal to the stored row they name; rows the batch does not name are not counted.
  let unchangedCount = 0;
  for (const row of incoming) {
    const before = storedById.get(row.id);
    if (!before) added.push(row);
    else if (sameRow(before, row)) unchangedCount += 1;
    else changed.push({ before, after: row });
  }
  const removed =
    input.mode === 'replace'
      ? input.stored.filter((r) => !incomingIds.has(r.id))
      : input.stored.filter((r) => deleted.has(r.id) && !incomingIds.has(r.id));

  // 4. The limit and overlapping windows over the book as it would be. The
  // count is the book's, moved by what the batch adds and removes (a changed
  // row adds none); base books are bounded by the catalogue, not by the cap
  // (G18 of 161, FR-009 of 160).
  const rowsAfter = input.mode === 'replace' ? final.length : input.storedRowCount + added.length - removed.length;
  if (!input.isBaseBook && rowsAfter > PRICE_BOOK_MAX_ROWS) {
    errors.push({ field: 'upsert', code: 'PRICE_BOOK_ROW_LIMIT', reason: 'book_row_limit', message: `A price book holds at most ${PRICE_BOOK_MAX_ROWS} rows.` });
  }
  const indexOf = new Map<string, number>();
  resolved.forEach((r, i) => {
    if (r) indexOf.set(r.id, i);
  });
  for (const [a, b] of rowOverlaps(final)) {
    const first = final[a]!;
    const second = final[b]!;
    // The error sits on an incoming row (the one being written), naming the other.
    const [mine, other] = indexOf.has(second.id) ? [second, first] : [first, second];
    errors.push({
      ...(indexOf.has(mine.id) ? { index: indexOf.get(mine.id)! } : {}),
      rowId: other.id,
      field: 'minQuantity',
      code: 'PRICE_BOOK_ROW_OVERLAP',
      reason: 'rows_overlap',
      message: `This row overlaps row ${other.id} of the same selection in its quantity window.`,
    });
  }

  return {
    resolved,
    final,
    added,
    changed,
    removed,
    unchangedCount,
    errors: errors.sort((x, y) => (x.index ?? Number.MAX_SAFE_INTEGER) - (y.index ?? Number.MAX_SAFE_INTEGER)),
  };
}

type Fail = (field: string, code: PriceBookRowError['code'], reason: PriceBookRowErrorReason, message: string) => void;

/** A row's selection, from its ids (checked against the lookups) or from its natural key. */
function selectionOfRow(row: PriceBookBatchRowInput, lookups: BatchLookups, fail: Fail): PriceBookRowInput['selection'] {
  if (row.selection) {
    const { productId, variantId, categoryId, attribute } = row.selection;
    if (variantId) {
      const variant = lookups.variantsById.get(variantId);
      if (!productId) fail('selection.productId', 'PRICE_BOOK_ROW_SHAPE', 'variant_needs_product', 'A variant row names its product.');
      else if (!variant) fail('selection.variantId', 'PRICE_BOOK_ROW_TARGET', 'variant_unknown', `Variant ${variantId} does not exist.`);
      else if (variant.parentProductId !== productId) {
        fail('selection.variantId', 'PRICE_BOOK_ROW_TARGET', 'variant_other_product', 'This variant does not belong to the product.');
      }
    } else if (productId && !lookups.productsById.has(productId)) {
      fail('selection.productId', 'PRICE_BOOK_ROW_TARGET', 'product_unknown', `Product ${productId} does not exist.`);
    }
    if (categoryId && !lookups.categoriesById.has(categoryId)) {
      fail('selection.categoryId', 'PRICE_BOOK_ROW_TARGET', 'category_unknown', `Category ${categoryId} does not exist.`);
    }
    if (attribute) attributeIssue(attribute.key, attribute.value, 'selection.attribute', lookups, fail);
    return row.selection;
  }
  if (row.key) return selectionOfKey(row.key, lookups, fail);
  return {};
}

/** The stored columns of a selection: a variant row carries its product. */
function storedSelectionOf(
  selection: PriceBookRowInput['selection'],
  lookups: BatchLookups,
): Pick<PlannedRow, 'variantId' | 'productId' | 'categoryId' | 'attributeKey' | 'attributeValue'> {
  return {
    variantId: selection.variantId ?? null,
    productId: selection.variantId
      ? (lookups.variantsById.get(selection.variantId)?.parentProductId ?? selection.productId ?? null)
      : (selection.productId ?? null),
    categoryId: selection.categoryId ?? null,
    attributeKey: selection.attribute?.key ?? null,
    attributeValue: selection.attribute?.value ?? null,
  };
}

/**
 * The selections a batch's rows name, resolved and de-duplicated, in the
 * order first named (G18 of 161): what the service reads the stored rows of,
 * since overlap is a rule within one selection. A row whose selection cannot
 * be resolved touches nothing — {@link planBatch} refuses it.
 */
export function touchedSelections(
  rows: readonly Parsed[],
  lookups: BatchLookups,
): Array<Pick<PlannedRow, 'variantId' | 'productId' | 'categoryId' | 'attributeKey' | 'attributeValue'>> {
  const out = new Map<string, Pick<PlannedRow, 'variantId' | 'productId' | 'categoryId' | 'attributeKey' | 'attributeValue'>>();
  for (const { row } of rows) {
    let failed = false;
    const selection = selectionOfRow(row, lookups, () => {
      failed = true;
    });
    if (failed) continue;
    const stored = storedSelectionOf(selection, lookups);
    const key = selectionKey(stored);
    if (!out.has(key)) out.set(key, stored);
  }
  return [...out.values()];
}

function attributeIssue(
  key: string,
  value: string,
  field: string,
  lookups: BatchLookups,
  fail: Fail,
): void {
  const view = lookups.attributes.get(key) ?? null;
  const reason = attributeInactiveReason(view);
  if (reason !== null) {
    fail(field, 'PRICE_BOOK_ROW_TARGET', 'attribute_not_selectable', `Attribute ${key} cannot select prices (${reason}).`);
    return;
  }
  if (view && view.valueType !== 'boolean' && !view.options.some((o) => o.value === value)) {
    fail(field, 'PRICE_BOOK_ROW_TARGET', 'attribute_value_unknown', `Attribute ${key} has no value ${value}.`);
  }
  if (view && view.valueType === 'boolean' && value !== 'true' && value !== 'false') {
    fail(field, 'PRICE_BOOK_ROW_TARGET', 'attribute_value_boolean', `Attribute ${key} takes true or false.`);
  }
}

function selectionOfKey(
  key: PriceBookNaturalKey,
  lookups: BatchLookups,
  fail: Fail,
): PriceBookRowInput['selection'] {
  const selection: PriceBookRowInput['selection'] = {};
  if (key.variantSku) {
    const variant = lookups.variantsBySku.get(key.variantSku);
    if (!variant) fail('key.variantSku', 'PRICE_BOOK_ROW_TARGET', 'variant_unknown', `No variant has the SKU ${key.variantSku}.`);
    else {
      selection.variantId = variant.id;
      selection.productId = variant.parentProductId;
      if (key.productSku && lookups.productsBySku.get(key.productSku)?.id !== variant.parentProductId) {
        fail('key.productSku', 'PRICE_BOOK_ROW_TARGET', 'variant_other_product', `Variant ${key.variantSku} does not belong to product ${key.productSku}.`);
      }
    }
  } else if (key.productSku) {
    const product = lookups.productsBySku.get(key.productSku);
    if (!product) fail('key.productSku', 'PRICE_BOOK_ROW_TARGET', 'product_unknown', `No product has the SKU ${key.productSku}.`);
    else selection.productId = product.id;
  }
  if (key.categoryPath) {
    const id = lookups.categoriesByPath.get(normaliseCategoryPath(key.categoryPath));
    if (!id) fail('key.categoryPath', 'PRICE_BOOK_ROW_TARGET', 'category_unknown', `No category has the path ${key.categoryPath}.`);
    else selection.categoryId = id;
  }
  if (key.attribute) {
    attributeIssue(key.attribute.key, key.attribute.valueCode, 'key.attribute', lookups, fail);
    selection.attribute = { key: key.attribute.key, value: key.attribute.valueCode };
  }
  return selection;
}

/** A stored row in a diff, with its natural key (built from the caller's label reads). */
export function diffRowOf(row: StoredRow | PlannedRow, naturalKey: PriceBookNaturalKey, withId = true): PriceBookDiffRow {
  return {
    ...(withId && 'id' in row ? { id: row.id } : {}),
    selectionKind: priceBookSelectionKind({
      variantId: row.variantId,
      productId: row.productId,
      categoryId: row.categoryId,
      attribute: row.attributeKey ? { key: row.attributeKey, value: row.attributeValue ?? '' } : null,
    }),
    selection: {
      variantId: row.variantId,
      productId: row.productId,
      categoryId: row.categoryId,
      attribute: row.attributeKey ? { key: row.attributeKey, value: row.attributeValue ?? '' } : null,
    },
    naturalKey,
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity,
    price: priceOfStored(row),
  };
}

export type { PriceBookRowsDryRun };
