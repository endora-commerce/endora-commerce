import type {
  ProductAudience,
  QuickOrderImportResponse,
  RecognizedQuickOrderItem,
  RejectedQuickOrderItem,
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
}

export interface VariantBySku {
  id: string;
  sku: string;
  parentProductId: string;
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
  ): Promise<ProductLike[]>;
  /**
   * Variants whose own SKU matches one of `skus` (row referenced a variant
   * directly), restricted by the **parent** product's answer — a variant has no
   * visibility of its own.
   */
  findVariantsBySku(
    skus: string[],
    audience: QuickOrderImportAudience,
  ): Promise<VariantBySku[]>;
  /** All variants under the given parent products (for attribute-column resolution). */
  findVariantsByParent(productIds: string[]): Promise<Array<VariantLike & { parentProductId: string }>>;
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
  sku: string;
  productId: string;
  variantId: string | null;
  resolvedVariantSku: string | null;
  quantity: number;
}

function isPurchasable(product: ProductLike): boolean {
  // Feature 032 renamed the withdrawn product status `archived` → `inactive`.
  // The `product_archived` rejection reason code is kept for contract stability.
  return product.status !== 'inactive' && !product.deletedAt;
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
    opts: { maxRows?: number; audience: QuickOrderImportAudience },
  ): Promise<QuickOrderImportResponse> {
    const rejected: RejectedQuickOrderItem[] = [];

    if (!parse.headerOk) {
      for (const row of parse.rows) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'malformed_row' });
      }
      return this.finalize([], rejected, 0, false);
    }

    // Row cap (FR-010): overflow rows are reported, not silently dropped.
    let rows = parse.rows;
    let truncated = false;
    const maxRows = opts.maxRows;
    if (typeof maxRows === 'number' && Number.isFinite(maxRows) && rows.length > maxRows) {
      for (const row of rows.slice(maxRows)) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'row_limit_exceeded' });
      }
      rows = rows.slice(0, maxRows);
      truncated = true;
    }

    const candidates = this.toCandidates(rows, rejected);
    if (candidates.length === 0) return this.finalize([], rejected, 0, truncated);

    const skus = Array.from(new Set(candidates.map((c) => c.sku)));
    const [products, variantsBySku] = await Promise.all([
      this.lookup.findProductsBySku(skus, opts.audience),
      this.lookup.findVariantsBySku(skus, opts.audience),
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
            sku: product.sku,
            productId: product.id,
            variantId: null,
            resolvedVariantSku: null,
            quantity: c.quantity,
          });
        } else if (resolution.kind === 'resolved') {
          resolvedLines.push({
            line: c.line,
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

    const { recognized, mergedCount } = this.mergeDuplicates(resolvedLines);
    return this.finalize(recognized, rejected, mergedCount, truncated);
  }

  /** Validate sku + integer quantity, rejecting malformed rows with a reason. */
  private toCandidates(rows: NormalizedRow[], rejected: RejectedQuickOrderItem[]): Candidate[] {
    const candidates: Candidate[] = [];
    for (const row of rows) {
      if (!row.sku) {
        rejected.push({ line: row.rowNumber, raw: row.raw, reason: 'sku_missing' });
        continue;
      }
      const quantity = Number.parseInt(row.quantityRaw, 10);
      if (!Number.isFinite(quantity) || quantity < 1 || String(quantity) !== row.quantityRaw) {
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
  private mergeDuplicates(lines: ResolvedLine[]): {
    recognized: RecognizedQuickOrderItem[];
    mergedCount: number;
  } {
    const byKey = new Map<string, RecognizedQuickOrderItem & { mergedFromLines: number[] }>();
    let mergedCount = 0;
    for (const line of lines) {
      const key = `${line.productId}::${line.variantId ?? ''}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.mergedFromLines.push(line.line);
        mergedCount += 1;
      } else {
        byKey.set(key, {
          line: line.line,
          sku: line.sku,
          productId: line.productId,
          variantId: line.variantId,
          resolvedVariantSku: line.resolvedVariantSku,
          quantity: line.quantity,
          mergedFromLines: [],
        });
      }
    }
    const recognized = Array.from(byKey.values()).map((item) => {
      const { mergedFromLines, ...rest } = item;
      return mergedFromLines.length > 0 ? { ...rest, mergedFromLines } : rest;
    });
    return { recognized, mergedCount };
  }

  private finalize(
    recognized: RecognizedQuickOrderItem[],
    rejected: RejectedQuickOrderItem[],
    mergedCount: number,
    truncated: boolean,
  ): QuickOrderImportResponse {
    return {
      recognized,
      rejected,
      summary: {
        recognizedCount: recognized.length,
        rejectedCount: rejected.length,
        mergedCount,
        truncated,
      },
    };
  }
}
