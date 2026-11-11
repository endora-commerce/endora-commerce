import {
  evaluateOrderMinimums,
  LINE_QUANTITY_MAX,
  type OrderMinimumLine,
  type OrderMinimumProduct,
  type ProductAudience,
  type QuickOrderImportResponse,
  type RecognizedQuickOrderItem,
  type RejectedQuickOrderItem,
} from '@endora-commerce/contracts';
import { resolveVariant, type VariantLike } from './variant-resolver.js';
import type { NormalizedRow, ParseOutcome } from './import-rows.js';

/**
 * Catalog lookups the pipeline needs, injected so the row-resolution logic
 * stays unit-testable without a database (mirrors the repo's injected-draw
 * pattern, e.g. BusinessIdGenerator). The DB-backed implementation lives in
 * `catalog-lookup.ts`.
 */
export interface ProductLike {
  id: string;
  sku: string;
  status: string;
  deletedAt?: Date | null;
  /**
   * Feature 163 — set when the product is archived (the Archive action). The one
   * reading of "archived": the status is not one (FR-010, FR-019).
   */
  archivedAt?: Date | null;
  /** Feature 155 — the product type; minimums apply to `simple` / `configurable` only. */
  type?: string;
  /** Feature 155 — the pieces minimum; `null` or absent = none. */
  minOrderQuantity?: number | null;
}

/** Feature 155 — the two fields of a parent product the minimum rule reads. */
export interface ParentMinimumRule {
  type: string;
  minOrderQuantity: number | null;
}

export interface VariantBySku {
  id: string;
  sku: string;
  parentProductId: string;
  /**
   * Feature 155 — the parent's minimum rule, so a row naming a variant by its
   * own SKU is judged against its product's minimum. Absent = no rule known.
   */
  parent?: ParentMinimumRule;
}

/**
 * Feature 155 (research R20, threat F4) — the most rows one preview reads,
 * whatever `quick_order.import_max_rows` is set to, so the evaluation is
 * bounded. A module constant, not a contract.
 */
export const QUICK_ORDER_IMPORT_ROWS_CEILING = 10_000;

/** Clamps a resolved row cap to `[1, QUICK_ORDER_IMPORT_ROWS_CEILING]`; absent = the ceiling. */
export function clampImportMaxRows(maxRows: number | undefined): number {
  if (typeof maxRows !== 'number' || !Number.isFinite(maxRows)) return QUICK_ORDER_IMPORT_ROWS_CEILING;
  return Math.min(QUICK_ORDER_IMPORT_ROWS_CEILING, Math.max(1, Math.floor(maxRows)));
}

/**
 * Who an import run answers for (issue #227) — a buyer's audience, or the
 * operator surface `'unrestricted'`.
 *
 * The second arm is not a bypass looking for a home: `POST
 * /api/v1/admin/quick-order/import` is gated by `orders:write` and the operator
 * names the organisation on the *build* call, one step later, so at import time
 * there is no buyer to answer for and the permission is the enforcement. It is
 * spelled as a literal rather than as an optional argument because an optional
 * one is the same bypass with nothing to grep for.
 *
 * **`'unrestricted'` waives the sales-channel narrowing too** (issue #259), and
 * on the same ground rather than as a second exemption: the operator names the
 * organisation one step later, so at import time there is no buyer *and*
 * therefore no storefront this paste is happening on. The channel the admin's
 * own request resolved to is the resolver's step-4 default unless the SPA sent
 * `X-Sales-Channel`, and narrowing an operator's paste against a channel nobody
 * chose would refuse SKUs the operator can see on every admin screen. The waiver
 * lives in one place — `CatalogPortLookup.#publishedHere`, which reads this
 * literal — so it cannot drift apart from the audience half it travels with.
 */
export type QuickOrderImportAudience = ProductAudience | 'unrestricted';

export interface QuickOrderCatalogLookup {
  /**
   * Products whose own SKU matches one of `skus`, **and that this buyer may
   * see** (issue #227).
   *
   * The audience is a parameter rather than a filter the pipeline applies
   * afterwards because that is what keeps the two answers identical: a SKU
   * nobody sells and a SKU restricted to another distributor both come back
   * absent, and the pipeline rejects both as `product_not_found` without
   * knowing there was a difference. A pasted SKU list is otherwise an
   * enumeration oracle over an operator's private assortment — the same defect
   * as issue #174's type-ahead, on the surface next to it.
   */
  findProductsBySku(
    skus: string[],
    audience: QuickOrderImportAudience,
    /**
     * Feature 163 — the channel the buyer's route resolved, asked explicitly so
     * a buyer paste is never answered by audience alone. Absent only for a
     * caller outside a request (a worker, a fixture), which reads the request
     * scope and, finding none, falls back to the audience filter.
     */
    salesChannelId?: string,
  ): Promise<ProductLike[]>;
  /**
   * Variants whose own SKU matches one of `skus` (row referenced a variant
   * directly), restricted by the **parent** product's answer — a variant has no
   * visibility of its own.
   */
  findVariantsBySku(
    skus: string[],
    audience: QuickOrderImportAudience,
    /** As {@link findProductsBySku}. */
    salesChannelId?: string,
  ): Promise<VariantBySku[]>;
  /** All variants under the given parent products (for attribute-column resolution). */
  findVariantsByParent(productIds: string[]): Promise<Array<VariantLike & { parentProductId: string }>>;
  /**
   * Feature 163 (FR-100) — the minimum order quantity of each product in the
   * buyer's channel, where it differs from nothing: the channel's effective
   * value. Empty for the operator (`'unrestricted'`, no channel at import time)
   * and outside a request with no channel named, where the global minimum stands.
   */
  channelMinimums(
    productIds: string[],
    audience: QuickOrderImportAudience,
    /** As {@link findProductsBySku}. */
    salesChannelId?: string,
  ): Promise<ReadonlyMap<string, number | null>>;
}

interface Candidate {
  line: number;
  raw: string;
  sku: string;
  quantity: number;
  attributes: Record<string, string>;
}

interface ResolvedLine {
  line: number;
  raw: string;
  sku: string;
  productId: string;
  variantId: string | null;
  resolvedVariantSku: string | null;
  quantity: number;
}

function isPurchasable(product: ProductLike): boolean {
  // Feature 163 (FR-010, FR-019) — `product_archived` means archived: `archivedAt`
  // is set, whatever the status. A product merely switched off (`inactive`) is not
  // judged here — on a channel the lookup's availability filter answers it
  // not-found, like any product the buyer may not acquire there.
  return !product.archivedAt && !product.deletedAt;
}

/**
 * QuickOrderImportPipeline (feature 039, FR-004/FR-009/FR-010). Turns parsed
 * rows into the recognized/rejected partition + summary:
 *   - validates sku + integer quantity,
 *   - resolves a concrete variant from attribute columns (or a direct variant SKU),
 *   - merges duplicate (product, variant) lines summing quantity,
 *   - caps the row count and reports overflow as `row_limit_exceeded`.
 */
export class QuickOrderImportPipeline {
  constructor(private readonly lookup: QuickOrderCatalogLookup) {}

  async run(
    parse: ParseOutcome,
    opts: {
      maxRows?: number;
      audience: QuickOrderImportAudience;
      /** Feature 163 — the channel the buyer's route resolved (see `findProductsBySku`). */
      salesChannelId?: string;
    },
  ): Promise<QuickOrderImportResponse> {
    const rejected: RejectedQuickOrderItem[] = [];
    // Feature 155 — the operator's summary always carries `warningCount`.
    const noWarnings = opts.audience === 'unrestricted' ? 0 : undefined;

    if (!parse.headerOk) {
      for (const row of parse.rows) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'malformed_row' });
      }
      return this.finalize([], rejected, 0, false, noWarnings);
    }

    // Row cap (FR-010): overflow rows are reported, not silently dropped.
    // Feature 155 (R20) — never above the ceiling, however the Setting is set.
    let rows = parse.rows;
    let truncated = false;
    const maxRows = clampImportMaxRows(opts.maxRows);
    if (rows.length > maxRows) {
      for (const row of rows.slice(maxRows)) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'row_limit_exceeded' });
      }
      rows = rows.slice(0, maxRows);
      truncated = true;
    }

    const candidates = this.toCandidates(rows, rejected);
    if (candidates.length === 0) return this.finalize([], rejected, 0, truncated, noWarnings);

    const skus = Array.from(new Set(candidates.map((c) => c.sku)));
    const [products, variantsBySku] = await Promise.all([
      this.lookup.findProductsBySku(skus, opts.audience, opts.salesChannelId),
      this.lookup.findVariantsBySku(skus, opts.audience, opts.salesChannelId),
    ]);
    const productBySku = new Map(products.map((p) => [p.sku, p]));
    const variantBySku = new Map(variantsBySku.map((v) => [v.sku, v]));

    // Variants of every parent product referenced by SKU (for attribute resolution).
    const parentIds = products.map((p) => p.id);
    const variantsByParent = new Map<string, Array<VariantLike & { parentProductId: string }>>();
    if (parentIds.length > 0) {
      for (const v of await this.lookup.findVariantsByParent(parentIds)) {
        const list = variantsByParent.get(v.parentProductId) ?? [];
        list.push(v);
        variantsByParent.set(v.parentProductId, list);
      }
    }
    // Parent products of variants referenced directly by their own SKU, for the
    // purchasable check.
    const productById = new Map(products.map((p) => [p.id, p]));

    const resolvedLines: ResolvedLine[] = [];
    for (const c of candidates) {
      const product = productBySku.get(c.sku);
      if (product) {
        if (!isPurchasable(product)) {
          rejected.push({ line: c.line, raw: c.raw, reason: 'product_archived' });
          continue;
        }
        const variants = variantsByParent.get(product.id) ?? [];
        const resolution = resolveVariant(variants, c.attributes);
        if (resolution.kind === 'no_variants') {
          resolvedLines.push({
            line: c.line,
            raw: c.raw,
            sku: product.sku,
            productId: product.id,
            variantId: null,
            resolvedVariantSku: null,
            quantity: c.quantity,
          });
        } else if (resolution.kind === 'resolved') {
          resolvedLines.push({
            line: c.line,
            raw: c.raw,
            sku: product.sku,
            productId: product.id,
            variantId: resolution.variantId,
            resolvedVariantSku: resolution.variantSku,
            quantity: c.quantity,
          });
        } else if (resolution.kind === 'ambiguous') {
          rejected.push({ line: c.line, raw: c.raw, reason: 'variant_ambiguous' });
        } else {
          rejected.push({ line: c.line, raw: c.raw, reason: 'variant_not_resolved' });
        }
        continue;
      }

      const variant = variantBySku.get(c.sku);
      if (variant) {
        const parent = productById.get(variant.parentProductId);
        if (parent && !isPurchasable(parent)) {
          rejected.push({ line: c.line, raw: c.raw, reason: 'product_archived' });
          continue;
        }
        resolvedLines.push({
          line: c.line,
          raw: c.raw,
          sku: variant.sku,
          productId: variant.parentProductId,
          variantId: variant.id,
          resolvedVariantSku: variant.sku,
          quantity: c.quantity,
        });
        continue;
      }

      rejected.push({ line: c.line, raw: c.raw, reason: 'product_not_found' });
    }

    const { recognized: merged, mergedCount } = this.mergeDuplicates(resolvedLines, rejected);

    // Feature 155 (P1, R12.1) — the minimum rules of every product a
    // recognised row resolved to, from the records already loaded above.
    const rules = new Map<string, OrderMinimumProduct>();
    for (const product of products) rules.set(product.id, ruleOf(product.id, product));
    for (const variant of variantsBySku) {
      if (!rules.has(variant.parentProductId) && variant.parent) {
        rules.set(variant.parentProductId, ruleOf(variant.parentProductId, variant.parent));
      }
    }
    // Feature 163 (FR-100) — the buyer's channel's minimum replaces the global one.
    const channelMinimums = await this.lookup.channelMinimums([...rules.keys()], opts.audience, opts.salesChannelId);
    for (const [productId, minOrderQuantity] of channelMinimums) {
      const rule = rules.get(productId);
      if (rule) rules.set(productId, { ...rule, minOrderQuantity });
    }
    const judged = this.judgeMinimums(merged, rules, opts.audience);
    rejected.push(...judged.rejected);
    return this.finalize(judged.recognized, rejected, mergedCount, truncated, judged.warningCount);
  }

  /**
   * Feature 155 (FR-011 (a), P1, R12.1) — one evaluation over every recognised
   * row of the file after the merge, pieces only and without the cart, so a
   * product's total is the sum over all its rows and variants. Rows rejected
   * for another reason are not here and count toward nothing.
   *
   * A buyer's rows of a product below its minimum move to `rejected`; the
   * operator's (`'unrestricted'`) stay recognised with a `warning` — the build
   * judges them (US4 #1d). `warningCount` is the operator's alone.
   */
  private judgeMinimums(
    merged: Array<RecognizedQuickOrderItem & { raw: string }>,
    rules: ReadonlyMap<string, OrderMinimumProduct>,
    audience: QuickOrderImportAudience,
  ): { recognized: RecognizedQuickOrderItem[]; rejected: RejectedQuickOrderItem[]; warningCount?: number } {
    const lines: OrderMinimumLine[] = [];
    const evaluated: OrderMinimumProduct[] = [];
    for (const [index, item] of merged.entries()) {
      // A product with no known rule has no minimum here; the build judges it.
      if (!rules.has(item.productId)) continue;
      lines.push({
        key: String(index),
        productId: item.productId,
        quantity: item.quantity,
        packagingUnitId: null,
        packagingUnitBaseQuantity: null,
        exempt: false,
      });
    }
    for (const rule of rules.values()) evaluated.push(rule);
    const below = new Map<number, { minimum: number; productTotal: number }>();
    for (const violation of evaluateOrderMinimums(lines, { products: evaluated, packagingUnits: [] })) {
      if (violation.kind !== 'pieces') continue;
      below.set(Number(violation.key), { minimum: violation.minimum, productTotal: violation.total });
    }

    const operator = audience === 'unrestricted';
    const recognized: RecognizedQuickOrderItem[] = [];
    const rejected: RejectedQuickOrderItem[] = [];
    let warningCount = 0;
    for (const [index, item] of merged.entries()) {
      const { raw, ...row } = item;
      const verdict = below.get(index);
      if (verdict === undefined) {
        recognized.push(row);
      } else if (operator) {
        recognized.push({ ...row, warning: { reason: 'below_minimum', ...verdict } });
        warningCount += 1;
      } else {
        rejected.push({ line: row.line, raw, reason: 'below_minimum', ...verdict });
      }
    }
    return operator ? { recognized, rejected, warningCount } : { recognized, rejected };
  }

  /** Validate sku + integer quantity (1…`LINE_QUANTITY_MAX`), rejecting malformed rows with a reason. */
  private toCandidates(rows: NormalizedRow[], rejected: RejectedQuickOrderItem[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (const row of rows) {
      if (!row.sku) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'sku_missing' });
        continue;
      }
      const quantity = Number.parseInt(row.quantityRaw, 10);
      // Issue #351 — past the line bound the build would refuse the row, so it is
      // refused here, by row, instead of being recognised into a failing build.
      if (
        !Number.isFinite(quantity) ||
        quantity < 1 ||
        quantity > LINE_QUANTITY_MAX ||
        String(quantity) !== row.quantityRaw
      ) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'quantity_invalid' });
        continue;
      }
      candidates.push({
        line: row.rowNumber,
        raw: row.raw,
        sku: row.sku,
        quantity,
        attributes: row.attributes,
      });
    }
    return candidates;
  }

  /** Merge duplicate (productId, variantId) lines, summing quantity (FR-009). */
  /**
   * Issue #351 (architect ruling R3 on PR #1009) — a duplicate whose sum passes
   * `LINE_QUANTITY_MAX` is not recognised: every one of its rows is rejected as
   * `quantity_invalid`, the outcome a single row past the bound already has. The
   * import report is per row, so the rest of the file is still recognised.
   */
  private mergeDuplicates(
    lines: ResolvedLine[],
    rejected: RejectedQuickOrderItem[],
  ): {
    recognized: Array<RecognizedQuickOrderItem & { raw: string }>;
    mergedCount: number;
  } {
    type Merged = RecognizedQuickOrderItem & { raw: string; mergedFromLines: number[]; sources: ResolvedLine[] };
    const byKey = new Map<string, Merged>();
    for (const line of lines) {
      const key = `${line.productId}::${line.variantId ?? ''}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.mergedFromLines.push(line.line);
        existing.sources.push(line);
      } else {
        byKey.set(key, {
          line: line.line,
          raw: line.raw,
          sku: line.sku,
          productId: line.productId,
          variantId: line.variantId,
          resolvedVariantSku: line.resolvedVariantSku,
          quantity: line.quantity,
          mergedFromLines: [],
          sources: [line],
        });
      }
    }
    let mergedCount = 0;
    const recognized: Array<RecognizedQuickOrderItem & { raw: string }> = [];
    for (const item of byKey.values()) {
      const { mergedFromLines, sources, ...rest } = item;
      if (rest.quantity > LINE_QUANTITY_MAX) {
        for (const source of sources) rejected.push({ line: source.line, raw: source.raw, reason: 'quantity_invalid' });
        continue;
      }
      mergedCount += mergedFromLines.length;
      recognized.push(mergedFromLines.length > 0 ? { ...rest, mergedFromLines } : rest);
    }
    return { recognized, mergedCount };
  }

  private finalize(
    recognized: RecognizedQuickOrderItem[],
    rejected: RejectedQuickOrderItem[],
    mergedCount: number,
    truncated: boolean,
    warningCount?: number,
  ): QuickOrderImportResponse {
    return {
      recognized,
      rejected,
      summary: {
        recognizedCount: recognized.length,
        rejectedCount: rejected.length,
        mergedCount,
        truncated,
        ...(warningCount !== undefined ? { warningCount } : {}),
      },
    };
  }
}

function ruleOf(
  productId: string,
  source: { type?: string; minOrderQuantity?: number | null },
): OrderMinimumProduct {
  return { id: productId, type: source.type ?? '', minOrderQuantity: source.minOrderQuantity ?? null };
}
