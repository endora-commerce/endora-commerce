import { randomUUID } from 'crypto';
import {
  ERROR_CODES,
  INVOICE_LEDGER_DELIVERY_QUEUED_EVENT,
  type InvoiceCopyHostPort,
  type InvoiceLedgerDeliveryListItem,
  type InvoiceLedgerDeliveryListQuery,
  type InvoiceLedgerDeliveryQueuedEvent,
  type LedgerDeliveryRecord,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { effectiveState } from '@endora-commerce/platform/kernel';
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
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const numbers = await this.invoiceNumbers(page.map((row) => row.invoiceId));
    return {
      data: page.map((row) => ({
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceNumber: numbers.get(row.invoiceId) ?? null,
        adapterId: row.adapterId,
        status: row.status,
        lastError: mappedDeliveryError(row.lastError ?? null),
        environment: row.environment,
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

  private async invoiceNumbers(invoiceIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(invoiceIds)];
    const out = new Map<string, string>();
    if (unique.length === 0 || !effectiveState.isPresent('invoices')) return out;
    await Promise.all(
      unique.map(async (invoiceId) => {
        const copy = await this.invoiceCopy.getById(invoiceId);
        if (copy?.number) out.set(invoiceId, copy.number);
      }),
    );
    return out;
  }
}
