import type { EntityManager } from '@mikro-orm/postgresql';
import type { QuoteRequestReadPort, QuoteRequestRecord } from '@b2b/contracts';
import { OPEN_QUOTE_REQUEST_STATUSES } from '@b2b/contracts';
import { QuoteRequest } from '../entities/quote-request.entity.js';

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
