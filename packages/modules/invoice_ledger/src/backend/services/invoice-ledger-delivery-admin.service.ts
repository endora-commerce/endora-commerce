import { randomUUID } from 'crypto';
import {
  ERROR_CODES,
  INVOICE_LEDGER_DELIVERY_QUEUED_EVENT,
  type InvoiceCopyHostPort,
  type InvoiceCopyRecord,
  type InvoiceLedgerDeliveryListItem,
  type InvoiceLedgerDeliveryListQuery,
  type InvoiceLedgerDeliveryQueuedEvent,
  type LedgerDeliveryRecord,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import { makeRetryInvoiceLedgerDeliveryCommand } from '../commands/retry-delivery.command.js';
import type { InvoiceLedgerDeliveryService } from './invoice-ledger-delivery.service.js';
import { mappedDeliveryError } from './mapped-delivery-error.js';

type LedgerEvents = Record<string, EventBase> & {
  [INVOICE_LEDGER_DELIVERY_QUEUED_EVENT]: InvoiceLedgerDeliveryQueuedEvent;
};

export class InvoiceLedgerDeliveryAdminService {
  constructor(
    private readonly deliveries: InvoiceLedgerDeliveryService,
    private readonly invoiceCopy: InvoiceCopyHostPort,
    private readonly commandBus: CommandBus,
    private readonly eventBus: EventBus<LedgerEvents>,
  ) {}

  async list(query: InvoiceLedgerDeliveryListQuery): Promise<{
    data: InvoiceLedgerDeliveryListItem[];
    pagination: { cursor: string | null; hasMore: boolean; limit: number };
  }> {
    const limit = query.limit;
    const rows = await this.deliveries.listRows({
      limit,
      ...(query.status ? { status: query.status } : {}),
      ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const copies = await this.loadCopies(rows.map((row) => row.invoiceId));
    const scoped = rows.filter((row) => this.visibleToActor(copies.get(row.invoiceId)));
    const hasMore = scoped.length > limit;
    const page = scoped.slice(0, limit);
    return {
      data: page.map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceNumber: copies.get(row.invoiceId)?.number ?? null,
        adapterId: row.adapterId,
        status: row.status,
        lastError: mappedDeliveryError(row.lastError ?? null),
        environment: row.environment,
        remoteDocumentId: row.remoteDocumentId ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      pagination: {
        cursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
        hasMore,
        limit,
      },
    };
  }

  async retry(id: string): Promise<LedgerDeliveryRecord> {
    const before = await this.deliveries.getById(id);
    if (!before) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery not found.');
    }
    const copies = await this.loadCopies([before.invoiceId]);
    if (!this.visibleToActor(copies.get(before.invoiceId))) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery not found.');
    }
    if (before.status !== 'failed' && before.status !== 'dead') {
      throw new HttpError(
        409,
        ERROR_CODES.INVOICE_LEDGER_DELIVERY_NOT_RETRYABLE,
        'This delivery cannot be retried.',
      );
    }
    const result = await this.commandBus.run(
      makeRetryInvoiceLedgerDeliveryCommand({
        deliveryId: id,
        before,
        retry: async () => {
          const queued = await this.deliveries.requeue(id);
          if (!queued) {
            throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery not found.');
          }
          return queued;
        },
      }),
    );
    this.eventBus.emit(INVOICE_LEDGER_DELIVERY_QUEUED_EVENT, {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      deliveryId: result.id,
      adapterId: result.adapterId,
    });
    return result;
  }

  /**
   * Delivery is transitively scoped through Invoice → Order. There is no org
   * column on the row, so the ambient `isOrgInScope` check is the list/retry
   * guard — same as invoices' admin list. A missing copy (or invoices off)
   * attributes as `''`, which only an unrestricted admin may see.
   */
  private visibleToActor(copy: InvoiceCopyRecord | undefined): boolean {
    return isOrgInScope(copy?.organizationId ?? '');
  }

  private async loadCopies(invoiceIds: string[]): Promise<Map<string, InvoiceCopyRecord>> {
    const unique = [...new Set(invoiceIds)];
    const out = new Map<string, InvoiceCopyRecord>();
    if (unique.length === 0 || !effectiveState.isPresent('invoices')) return out;
    await Promise.all(
      unique.map(async (invoiceId) => {
        const copy = await this.invoiceCopy.getById(invoiceId);
        if (copy) out.set(invoiceId, copy);
      }),
    );
    return out;
  }
}
