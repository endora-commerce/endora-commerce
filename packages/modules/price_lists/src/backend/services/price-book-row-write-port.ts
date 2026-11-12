import type { BookProductRows, PriceBookRowWritePort } from '@endora-commerce/contracts';
import type { PriceBookService } from './price-book-service.js';

/**
 * Issue #1028 — `priceBookRowWritePort`, the seam through which a module (an
 * ERP or PIM connector) writes the rows of one product in one non-base book:
 * a customer-group, organization, catalogue or sale price.
 *
 * A facade, not a second write path: both writes are
 * `PriceBookService.replaceProductRows` / `removeProductRows`, which plan and
 * commit through the admin row batch's own planning and command
 * (`PUT /api/v1/admin/price-books/:id/rows`), so the port is refused for the
 * route's reasons and audited, versioned and invalidated the same way. The
 * port acts on every book (`ALL_BOOKS_SCOPE`): it serves a worker, not a
 * representative.
 *
 * Only rows the write shape can say are the port's: an administrator's
 * product-level adjustment or quantity-limited adjustment is neither replaced
 * nor removed (owner decision on issue #1028), and `bookRows` flags it with
 * `complete: false`.
 */
export function createPriceBookRowWritePort(deps: {
  priceBookService: Pick<PriceBookService, 'replaceProductRows' | 'removeProductRows' | 'productRows'>;
}): PriceBookRowWritePort {
  const { priceBookService } = deps;
  return {
    async replaceBookRows(bookId, productId, write) {
      await priceBookService.replaceProductRows(bookId, productId, write);
      return priceBookService.productRows(bookId, productId);
    },
    removeBookRows: (bookId, productId) => priceBookService.removeProductRows(bookId, productId),
    async bookRows(bookId, productId) {
      const rows = await priceBookService.productRows(bookId, productId);
      return holdsNothing(rows) ? null : rows;
    },
  };
}

function holdsNothing(rows: BookProductRows): boolean {
  return rows.complete && rows.product.length === 0 && Object.keys(rows.variants).length === 0;
}
