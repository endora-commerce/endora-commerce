import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  QuoteRequestLineRecord,
  QuoteRequestReadPort,
  QuoteRequestRecord,
} from '@endora-commerce/contracts';
import { OPEN_QUOTE_REQUEST_STATUSES } from '@endora-commerce/contracts';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';

/**
 * The row-level read model `quote_requests` publishes (feature 075, Phase P).
 *
 * Two consumers, two questions. `carts` resolves the quote a cart was
 * converted from; `organizations` counts the open quotes per organisation on
 * the sales-rep screen, where the three open statuses had been written out as
 * a literal array in a module that does not own the lifecycle.
 *
 * The full customer-facing projection stays `RfqService` — this is the row,
 * for the callers that only need to count or cross-reference one.
 */
export class QuoteRequestReadService implements QuoteRequestReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<QuoteRequestRecord | null> {
    const quote = await this.emFactory().findOne(QuoteRequest, { id });
    return quote ? toQuoteRequestRecord(quote) : null;
  }

  /**
   * The business id is unique by construction (`QR-<uuid>` unless a caller
   * passes one) and the column carries a unique index, so `findOne` is the
   * whole of the lookup.
   */
  async findByBusinessId(businessId: string): Promise<QuoteRequestRecord | null> {
    const quote = await this.emFactory().findOne(QuoteRequest, { businessId });
    return quote ? toQuoteRequestRecord(quote) : null;
  }

  async listOpenForOrganizations(
    organizationIds: readonly string[],
  ): Promise<QuoteRequestRecord[]> {
    // A rep assigned nothing sees nothing. Answering the unfiltered set here
    // would be the opposite of what the caller means, and the caller is a
    // visibility screen.
    if (organizationIds.length === 0) return [];
    const quotes = await this.emFactory().find(QuoteRequest, {
      organizationId: { $in: [...organizationIds] },
      status: { $in: [...OPEN_QUOTE_REQUEST_STATUSES] },
    });
    return quotes.map(toQuoteRequestRecord);
  }

  /**
   * Added in feature 075's `carts` cut. The quote-to-cart conversion read
   * `QuoteRequestItem` itself; the money columns are deliberately not on the
   * record, because that conversion re-resolves every price against the
   * buyer's current list (FR-017) and a caller that cannot see the quoted
   * price cannot carry it over by accident.
   */
  async listItems(quoteRequestId: string): Promise<QuoteRequestLineRecord[]> {
    const items = await this.emFactory().find(
      QuoteRequestItem,
      { quoteRequestId },
      { orderBy: { createdAt: 'asc' } },
    );
    return items.map((item) => ({
      id: item.id,
      quoteRequestId: item.quoteRequestId,
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      packagingUnitName: item.packagingUnitName ?? null,
      packagingUnitBaseQuantity: item.packagingUnitBaseQuantity ?? null,
      lineCurrency: item.lineCurrency,
      agreedUnitPrice: item.agreedUnitPrice ?? null,
      desiredUnitPrice: item.desiredUnitPrice ?? null,
    }));
  }
}

export function toQuoteRequestRecord(quote: QuoteRequest): QuoteRequestRecord {
  return {
    id: quote.id,
    businessId: quote.businessId,
    organizationId: quote.organizationId,
    customerAccountId: quote.customerAccountId,
    createdByAdminUserId: quote.createdByAdminUserId ?? null,
    assignedAdminUserId: quote.assignedAdminUserId ?? null,
    status: quote.status,
    headerNote: quote.headerNote ?? null,
    cancellationReason: quote.cancellationReason ?? null,
    awaitingCustomerRevisionAcceptance: quote.awaitingCustomerRevisionAcceptance,
    lastCustomerSeenRevisionNumber: quote.lastCustomerSeenRevisionNumber,
    currentRevisionNumber: quote.currentRevisionNumber,
    submittedAt: quote.submittedAt ?? null,
    approvedAt: quote.approvedAt ?? null,
    canceledAt: quote.canceledAt ?? null,
    completedAt: quote.completedAt ?? null,
    expiredAt: quote.expiredAt ?? null,
    expiresAt: quote.expiresAt ?? null,
    convertedOrderId: quote.convertedOrderId ?? null,
    customFieldValues: quote.customFieldValues ?? {},
    version: quote.version,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}
