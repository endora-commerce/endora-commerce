import type { z } from 'zod';
import {
  ERROR_CODES,
  basePricesWriteSchema,
  type BasePricesWrite,
  type BasePriceTier,
  type PriceBookSummary,
  type PriceBookWritePort,
  type ProductBasePrices,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { PriceBookReads } from './price-book-reads.js';
import { ALL_BOOKS_SCOPE, type PriceBookService } from './price-book-service.js';

/**
 * Feature 160, FR-049 (owner ruling 2026-10-22) — `priceBookWritePort`, the
 * PIM price import's seam (`specs/160-pricing-model-v2/contracts/price-book-write-port.md`).
 *
 * A facade, not a second write path: both writes are
 * `PriceBookService.setBasePrices`, the command behind
 * `PUT /api/v1/admin/price-books/base-prices/:productId`, and the input passes
 * the same schema that route parses, so the port is refused for the route's
 * reasons. The summary is the admin list (G1) with every book visible — the
 * port serves a worker, not a representative.
 */
export function createPriceBookWritePort(deps: {
  priceBookService: PriceBookService;
  reads: PriceBookReads;
}): PriceBookWritePort {
  const { priceBookService, reads } = deps;
  const basePrices = (productId: string): Promise<ProductBasePrices> => priceBookService.basePrices(productId);
  return {
    basePrices,
    async replaceProductBaseTiers(productId, tiersByCurrency) {
      const byCurrency: Record<string, { product: readonly BasePriceTier[]; variants: Record<string, never> }> = {};
      for (const [code, tiers] of Object.entries(tiersByCurrency)) {
        byCurrency[code.toUpperCase()] = { product: tiers, variants: {} };
      }
      const write = parseOr400(basePricesWriteSchema, { byCurrency });
      await priceBookService.setBasePrices(productId, write, { keepVariantRows: true });
      return basePrices(productId);
    },
    async replaceBasePrices(productId, write: BasePricesWrite) {
      const byCurrency: Record<string, unknown> = {};
      for (const [code, prices] of Object.entries(write.byCurrency)) byCurrency[code.toUpperCase()] = prices;
      await priceBookService.setBasePrices(productId, parseOr400(basePricesWriteSchema, { byCurrency }));
      return basePrices(productId);
    },
    async booksPricingProduct(productId, variantId) {
      const books: PriceBookSummary[] = [];
      for (let page = 1; ; page += 1) {
        const answer = await reads.list(
          { productId, ...(variantId ? { variantId } : {}), page, pageSize: 200 },
          ALL_BOOKS_SCOPE,
        );
        books.push(...answer.data);
        if (answer.data.length === 0 || books.length >= answer.meta.totalCount) return books;
      }
    },
  };
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(' '),
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
    );
  }
  return parsed.data;
}
