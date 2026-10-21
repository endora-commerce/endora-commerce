import type { PriceSource } from '@endora-commerce/contracts';
import { PRICE_BOOK_MAX_EXPLANATION_CANDIDATES } from '@endora-commerce/contracts';
import { matchesAttributeValue, type EligibleAttribute } from './attribute-eligibility.js';
import {
  applyAmountAdjustment,
  applySignedPercent,
  compareDecimal,
  normaliseAmount,
} from './matrix-decimal.js';
import {
  buildRankTable,
  selectionOrder,
  type ActivePrecedence,
  type CellCode,
  type SelectionKind,
} from './precedence.js';

/**
 * The three-tier price-book resolver — feature 160, `specs/pricing/decision-record.md`
 * §5.2 (D-287), as a **pure** function over rows already loaded for a page.
 *
 *     1. BASE      the base book's variant row (fixed, or adjusted from the
 *                  product's base) covering q, else the product's row
 *     2. CATALOGUE the best row of the regular everyone books, ranked by
 *                  selection kind; percentages off the base         → C, else base
 *     3. BUYER     the best row of the regular organization-set and
 *                  customer-group-set books, ranked by the precedence's rank
 *                  table; percentages off C                          → R, else C
 *     4. SALE      the best row of the sale books — buyer cells by the rank
 *                  table, then everyone rows by selection kind; off C → S
 *     5. CHARGE    S when S < R (compare-at R), else R; nothing → unpriced
 *
 * The order key inside a tier is lexicographic and total: cell rank → chain
 * depth (organization cells; the two swap under nearest-organization-first) →
 * book priority desc → starting quantity desc → resulting amount asc → book id
 * → row id. A row whose reference is missing, or whose result is below zero,
 * does not price and the next candidate is tried (FR-008); zero is a price.
 *
 * Four passes over one candidate array, so the batched entry points stay at a
 * constant number of statements: everything this reads was loaded before it was
 * called. It replaces three mechanisms of the old engine — the Application-rule
 * evaluator, the list priority chain and the in-list matrix ranking.
 */

export type BookPriceType = 'fixed' | 'percent' | 'amount';

/** One `price_list_matrix_entries` row of a price book, as the resolver reads it. */
export interface BookRow {
  id: string;
  bookId: string;
  variantId: string | null;
  productId: string | null;
  categoryId: string | null;
  attributeKey: string | null;
  attributeValue: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  priceType: BookPriceType;
  /** `fixed`: the price; `amount`: the signed adjustment. */
  amount: string | null;
  /** `percent`: the signed percentage. */
  percent: string | null;
}

/** How a book's audience meets the buyer: everyone, the buyer's chain at a depth, or its group. */
export type BookAudience =
  | { kind: 'everyone' }
  | { kind: 'organizations'; depth: number }
  | { kind: 'customer_groups' };

/** An applicable book: already filtered to the channel, currency, dates and buyer. */
export interface ResolverBook {
  id: string;
  name: string;
  type: 'regular' | 'sale';
  /** The base book of the currency. */
  isSystem: boolean;
  priority: number;
  audience: BookAudience;
}

/** What is priced: a product (and optionally one of its variants) at a quantity. */
export interface ResolverLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  /** The product's own category assignments (FR-016). */
  categoryIds: ReadonlySet<string>;
  /** The product's attribute values overlaid by the variant's axis values (FR-016). */
  attributes: Readonly<Record<string, unknown>>;
}

export interface BookResolverInput {
  books: readonly ResolverBook[];
  rows: readonly BookRow[];
  precedence: ActivePrecedence;
  /** `isPriceRule` attributes of an eligible value type, not language- or channel-scoped. */
  eligibleAttributes: ReadonlyMap<string, EligibleAttribute>;
}

/** What one tier answered. */
export interface TierAnswer {
  amount: string;
  bookId: string;
  bookName: string;
  rowId: string;
  startQuantity: number;
  /** The row's quantity window end; `null` = unbounded. */
  endQuantity: number | null;
  /** The buyer cell, for an organization or customer-group row; `null` otherwise. */
  cell: CellCode | null;
  /** The reference a percentage or adjustment was taken off. */
  reference: string | null;
}

export interface ResolvedBookPrice {
  amount: string;
  source: PriceSource;
  /** The buyer price a charged sale undercut. */
  compareAt: string | null;
  bookId: string;
  bookName: string;
  rowId: string;
  startQuantity: number;
}

export interface BookExplanation {
  tier: PriceSource | null;
  cell: CellCode | null;
  bookId: string | null;
  bookName: string | null;
  rowId: string | null;
  reference: string | null;
  precedenceVersion: number;
  /** The deciding tier's priced candidates in rank order, at most ten. */
  candidates: Array<{ cell: CellCode | null; bookId: string; rowId: string; amount: string }>;
}

export interface BookResolution {
  price: ResolvedBookPrice | null;
  base: TierAnswer | null;
  /** `null` when no everyone row priced the line: the catalogue price is then the base. */
  catalogue: TierAnswer | null;
  /** `null` when no buyer row priced the line: the buyer price is then the catalogue price. */
  buyer: TierAnswer | null;
  sale: TierAnswer | null;
  explanation: BookExplanation;
}

export interface BookResolver {
  resolve(line: ResolverLine): BookResolution;
}

/** The selection kind a row's coordinates name. */
export function rowSelectionKind(row: Pick<BookRow, 'variantId' | 'productId' | 'categoryId' | 'attributeKey'>): SelectionKind {
  if (row.variantId !== null) return 'variant';
  if (row.productId !== null) return 'product';
  if (row.categoryId !== null && row.attributeKey !== null) return 'category_attribute';
  if (row.categoryId !== null) return 'category';
  if (row.attributeKey !== null) return 'attribute';
  return 'all';
}

interface Candidate {
  row: BookRow;
  book: ResolverBook;
  kind: SelectionKind;
  cell: CellCode | null;
  amount: string;
  reference: string | null;
  /** The precomputed leading components of the order key. */
  rank: readonly number[];
}

function covers(row: BookRow, quantity: number): boolean {
  return row.minQuantity <= quantity && (row.maxQuantity === null || quantity <= row.maxQuantity);
}

/** The row's price off `reference`, or `null` when it does not price (FR-008). */
function priceOf(row: BookRow, reference: string | null): string | null {
  switch (row.priceType) {
    case 'fixed':
      return row.amount === null ? null : normaliseAmount(row.amount);
    case 'percent':
      return reference === null || row.percent === null ? null : applySignedPercent(reference, row.percent);
    case 'amount':
      return reference === null || row.amount === null ? null : applyAmountAdjustment(reference, row.amount);
  }
}

/** The order key's tail: priority desc → start desc → amount asc → book id → row id. */
function compareCandidates(a: Candidate, b: Candidate): number {
  for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i += 1) {
    const d = (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
    if (d !== 0) return d;
  }
  if (a.book.priority !== b.book.priority) return b.book.priority - a.book.priority;
  if (a.row.minQuantity !== b.row.minQuantity) return b.row.minQuantity - a.row.minQuantity;
  const byAmount = compareDecimal(a.amount, b.amount);
  if (byAmount !== 0) return byAmount;
  if (a.book.id !== b.book.id) return a.book.id < b.book.id ? -1 : 1;
  if (a.row.id !== b.row.id) return a.row.id < b.row.id ? -1 : 1;
  return 0;
}

function answerOf(c: Candidate): TierAnswer {
  return {
    amount: c.amount,
    bookId: c.book.id,
    bookName: c.book.name,
    rowId: c.row.id,
    startQuantity: c.row.minQuantity,
    endQuantity: c.row.maxQuantity,
    cell: c.cell,
    reference: c.row.priceType === 'fixed' ? null : c.reference,
  };
}

export function createBookResolver(input: BookResolverInput): BookResolver {
  const { precedence, eligibleAttributes } = input;
  const config = precedence.config;
  const cellRank = buildRankTable(config);
  const selection = selectionOrder(config.categoryBeforeAttribute);
  const selectionRank = new Map(selection.map((k, i) => [k, i]));
  const nearestFirst = config.depthMode === 'nearest_organization_first';

  const books = new Map(input.books.map((b) => [b.id, b]));
  const baseBook = input.books.find((b) => b.isSystem) ?? null;

  // Rows indexed by what they select, so a line meets only its own rows and
  // the selection-wide ones.
  const baseByProduct = new Map<string, BookRow[]>();
  const baseByVariant = new Map<string, BookRow[]>();
  const byProduct = new Map<string, BookRow[]>();
  const byVariant = new Map<string, BookRow[]>();
  const broad: BookRow[] = [];
  const push = (map: Map<string, BookRow[]>, key: string, row: BookRow) => {
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  };
  for (const row of input.rows) {
    const book = books.get(row.bookId);
    if (!book) continue;
    if (book.isSystem) {
      // A base book holds product and variant rows only (FR-009).
      if (row.variantId !== null) push(baseByVariant, row.variantId, row);
      else if (row.productId !== null && row.priceType === 'fixed') push(baseByProduct, row.productId, row);
      continue;
    }
    if (row.variantId !== null) push(byVariant, row.variantId, row);
    else if (row.productId !== null) push(byProduct, row.productId, row);
    else broad.push(row);
  }

  const bestTier = (rows: readonly BookRow[] | undefined, quantity: number): BookRow | null => {
    let best: BookRow | null = null;
    for (const row of rows ?? []) {
      if (!covers(row, quantity)) continue;
      if (best === null || row.minQuantity > best.minQuantity || (row.minQuantity === best.minQuantity && row.id < best.id)) {
        best = row;
      }
    }
    return best;
  };

  const selectionMatches = (row: BookRow, line: ResolverLine): boolean => {
    if (row.categoryId !== null && !line.categoryIds.has(row.categoryId)) return false;
    if (row.attributeKey !== null) {
      const attribute = eligibleAttributes.get(row.attributeKey);
      if (!attribute || row.attributeValue === null) return false;
      if (!matchesAttributeValue(attribute.valueType, line.attributes[row.attributeKey], row.attributeValue)) {
        return false;
      }
    }
    return true;
  };

  /** The leading order-key components of a buyer cell. */
  const buyerRank = (cell: CellCode, depth: number): number[] => {
    const rank = cellRank.get(cell) ?? Number.MAX_SAFE_INTEGER;
    if (!nearestFirst) return [rank, depth];
    return cell.startsWith('org.') ? [0, depth, rank] : [1, 0, rank];
  };

  return {
    resolve(line: ResolverLine): BookResolution {
      const q = line.quantity;

      // 1. BASE
      let base: TierAnswer | null = null;
      if (baseBook) {
        const productRow = bestTier(baseByProduct.get(line.productId), q);
        const productBase = productRow ? priceOf(productRow, null) : null;
        if (line.variantId !== null) {
          const variantRow = bestTier(baseByVariant.get(line.variantId), q);
          if (variantRow) {
            const amount = priceOf(variantRow, productBase);
            if (amount !== null) {
              base = {
                amount,
                bookId: baseBook.id,
                bookName: baseBook.name,
                rowId: variantRow.id,
                startQuantity: variantRow.minQuantity,
                endQuantity: variantRow.maxQuantity,
                cell: null,
                reference: variantRow.priceType === 'fixed' ? null : productBase,
              };
            }
          }
        }
        if (base === null && productRow && productBase !== null) {
          base = {
            amount: productBase,
            bookId: baseBook.id,
            bookName: baseBook.name,
            rowId: productRow.id,
            startQuantity: productRow.minQuantity,
            endQuantity: productRow.maxQuantity,
            cell: null,
            reference: null,
          };
        }
      }

      // The rows this line can meet, by tier.
      const catalogueRows: Array<{ row: BookRow; book: ResolverBook }> = [];
      const buyerRows: Array<{ row: BookRow; book: ResolverBook }> = [];
      const saleRows: Array<{ row: BookRow; book: ResolverBook }> = [];
      const consider = (row: BookRow) => {
        if (!covers(row, q) || !selectionMatches(row, line)) return;
        const book = books.get(row.bookId)!;
        if (book.type === 'sale') saleRows.push({ row, book });
        else if (book.audience.kind === 'everyone') catalogueRows.push({ row, book });
        else buyerRows.push({ row, book });
      };
      if (line.variantId !== null) for (const row of byVariant.get(line.variantId) ?? []) consider(row);
      for (const row of byProduct.get(line.productId) ?? []) consider(row);
      for (const row of broad) consider(row);

      const cellOf = (book: ResolverBook, kind: SelectionKind): CellCode | null =>
        book.audience.kind === 'organizations'
          ? (`org.${kind}` as CellCode)
          : book.audience.kind === 'customer_groups'
            ? (`group.${kind}` as CellCode)
            : null;
      const depthOf = (book: ResolverBook): number =>
        book.audience.kind === 'organizations' ? book.audience.depth : 0;

      const ranked = (
        rows: Array<{ row: BookRow; book: ResolverBook }>,
        reference: string | null,
        rankOf: (book: ResolverBook, kind: SelectionKind, cell: CellCode | null) => number[],
      ): Candidate[] => {
        const out: Candidate[] = [];
        for (const { row, book } of rows) {
          const amount = priceOf(row, reference);
          if (amount === null) continue;
          const kind = rowSelectionKind(row);
          const cell = cellOf(book, kind);
          out.push({ row, book, kind, cell, amount, reference, rank: rankOf(book, kind, cell) });
        }
        return out.sort(compareCandidates);
      };

      const bySelection = (_book: ResolverBook, kind: SelectionKind) => [selectionRank.get(kind) ?? 99];

      // 2. CATALOGUE — reference: the base.
      const catalogueCandidates = ranked(catalogueRows, base?.amount ?? null, bySelection);
      const catalogue = catalogueCandidates[0] ? answerOf(catalogueCandidates[0]) : null;
      const c = catalogue?.amount ?? base?.amount ?? null;

      // 3. BUYER — reference: the catalogue price.
      const buyerCandidates = ranked(buyerRows, c, (book, _kind, cell) => buyerRank(cell!, depthOf(book)));
      const buyer = buyerCandidates[0] ? answerOf(buyerCandidates[0]) : null;
      const r = buyer?.amount ?? c;

      // 4. SALE — buyer cells first, then everyone rows; reference: the catalogue price.
      const saleCandidates = ranked(saleRows, c, (book, kind, cell) =>
        cell === null ? [1, selectionRank.get(kind) ?? 99, 0, 0] : [0, ...buyerRank(cell, depthOf(book))],
      );
      const sale = saleCandidates[0] ? answerOf(saleCandidates[0]) : null;

      // 5. CHARGE — a sale only when strictly lower (FR-015, FR-046).
      let price: ResolvedBookPrice | null = null;
      let deciding: { answer: TierAnswer; candidates: Candidate[] } | null = null;
      let tier: PriceSource | null = null;
      if (sale && (r === null || compareDecimal(sale.amount, r) < 0)) {
        tier = 'sale';
        deciding = { answer: sale, candidates: saleCandidates };
        price = { ...priceFrom(sale, 'sale'), compareAt: r };
      } else if (buyer) {
        tier = 'buyer';
        deciding = { answer: buyer, candidates: buyerCandidates };
        price = priceFrom(buyer, 'buyer');
      } else if (catalogue) {
        tier = 'catalogue';
        deciding = { answer: catalogue, candidates: catalogueCandidates };
        price = priceFrom(catalogue, 'catalogue');
      } else if (base) {
        tier = 'base';
        deciding = { answer: base, candidates: [] };
        price = priceFrom(base, 'base');
      }

      return {
        price,
        base,
        catalogue,
        buyer,
        sale,
        explanation: {
          tier,
          cell: deciding?.answer.cell ?? null,
          bookId: deciding?.answer.bookId ?? null,
          bookName: deciding?.answer.bookName ?? null,
          rowId: deciding?.answer.rowId ?? null,
          reference: deciding?.answer.reference ?? null,
          precedenceVersion: precedence.version,
          candidates: (deciding?.candidates ?? [])
            .slice(0, PRICE_BOOK_MAX_EXPLANATION_CANDIDATES)
            .map((cand) => ({ cell: cand.cell, bookId: cand.book.id, rowId: cand.row.id, amount: cand.amount })),
        },
      };
    },
  };
}

function priceFrom(answer: TierAnswer, source: PriceSource): ResolvedBookPrice {
  return {
    amount: answer.amount,
    source,
    compareAt: null,
    bookId: answer.bookId,
    bookName: answer.bookName,
    rowId: answer.rowId,
    startQuantity: answer.startQuantity,
  };
}
