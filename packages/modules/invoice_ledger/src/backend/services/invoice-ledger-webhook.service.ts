import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  InvoiceKsefAssignmentPort,
  InvoiceLedgerDeliveryPort,
  InvoiceLedgerWebhookEventInput,
  InvoiceLedgerWebhookPort,
  InvoiceNumberingHostPort,
  InvoicePaidHostPort,
  LedgerDeliveryRecord,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { InvoiceLedgerDocumentMap } from '../entities/invoice-ledger-document-map.entity.js';
import { InvoiceLedgerDelivery } from '../entities/invoice-ledger-delivery.entity.js';
import { InvoiceLedgerWebhookReceipt } from '../entities/invoice-ledger-webhook-receipt.entity.js';

const APPLIED_TYPES = new Set([
  'async_invoice_creation_success',
  'async_invoice_creation_error',
  'invoice_paid',
  'send_to_ksef_success',
  'send_to_ksef_error',
]);

export interface InvoiceLedgerWebhookServiceDeps {
  emFactory: () => EntityManager;
  deliveries: InvoiceLedgerDeliveryPort;
  numbering: InvoiceNumberingHostPort;
  paid: InvoicePaidHostPort;
  ksefAssignment: InvoiceKsefAssignmentPort;
}

type MapLookup =
  | { kind: 'unique'; invoiceId: string }
  | { kind: 'none' }
  | { kind: 'ambiguous' };

/**
 * Receipt claim + apply for authenticated ledger-vendor webhooks.
 * HMAC stays on the adapter route. Apply uses frozen delivery columns.
 */
export class InvoiceLedgerWebhookService implements InvoiceLedgerWebhookPort {
  constructor(private readonly deps: InvoiceLedgerWebhookServiceDeps) {}

  async handleAuthenticatedEvent(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<{ outcome: 'applied' | 'duplicate' | 'acknowledged' }> {
    return enterSystemScope('invoice ledger webhook', () => this.run(input));
  }

  private async run(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<{ outcome: 'applied' | 'duplicate' | 'acknowledged' }> {
    const claimed = await this.claim(input);
    if (!claimed) return { outcome: 'duplicate' };
    const outcome = await this.apply(input);
    await this.settle(input, 'processed');
    return { outcome };
  }

  private async claim(input: InvoiceLedgerWebhookEventInput): Promise<boolean> {
    const em = this.deps.emFactory();
    // command-coverage-ignore: claim INSERT … ON CONFLICT for this module's
    // webhook ledger — see InpostWebhookLedger.claim.
    const rows = await em.execute<Array<{ id: string }>>(
      `insert into "invoice_ledger_webhook_receipts"
         ("id", "adapter_id", "event_id", "event_type", "state", "attempts", "received_at")
       values (?, ?, ?, ?, 'received', 1, now())
       on conflict ("adapter_id", "event_id") do update
          set "attempts" = "invoice_ledger_webhook_receipts"."attempts" + 1,
              "received_at" = now(),
              "state" = 'received',
              "error" = null
        where "invoice_ledger_webhook_receipts"."state" in ('failed', 'received')
       returning "id"`,
      [randomUUID(), input.adapterId, input.eventId.slice(0, 128), input.eventType.slice(0, 64)],
    );
    return rows.length > 0;
  }

  private async settle(
    input: InvoiceLedgerWebhookEventInput,
    state: 'processed' | 'ignored' | 'failed',
  ): Promise<void> {
    // command-coverage-ignore: closes this module's own webhook ledger row —
    // see `claim` above.
    const em = this.deps.emFactory();
    await em.nativeUpdate(
      InvoiceLedgerWebhookReceipt,
      { adapterId: input.adapterId, eventId: input.eventId.slice(0, 128) },
      { state, appliedAt: new Date(), error: null },
    );
  }

  private async apply(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<'applied' | 'acknowledged'> {
    if (!APPLIED_TYPES.has(input.eventType)) return 'acknowledged';

    if (input.eventType === 'async_invoice_creation_success') {
      return this.applyCreationSuccess(input);
    }
    if (input.eventType === 'async_invoice_creation_error') {
      return this.applyCreationError(input);
    }

    const lookup = await this.lookupUniqueMap(input.adapterId, input.remoteDocumentId);
    if (lookup.kind !== 'unique') return 'acknowledged';
    const delivery = await this.deps.deliveries.findByInvoice(input.adapterId, lookup.invoiceId);

    if (input.eventType === 'invoice_paid') {
      await this.deps.paid.recordPaidFromLedger(lookup.invoiceId);
      if (delivery) {
        await this.stampRemotePaid(delivery.id);
      }
      return 'applied';
    }
    if (input.eventType === 'send_to_ksef_success') {
      if (delivery?.ksefRouting !== 'vendor' || !input.ksefReferenceNumber) {
        return 'acknowledged';
      }
      await this.deps.ksefAssignment.recordKsefAssignment(lookup.invoiceId, {
        ksefReferenceNumber: input.ksefReferenceNumber,
        ksefProcessedAt: new Date(),
      });
      return 'applied';
    }
    if (input.eventType === 'send_to_ksef_error') {
      if (delivery) {
        await this.deps.deliveries.markFailed(
          delivery.id,
          input.errorMessage ?? 'Infakt KSeF send failed.',
        );
      }
      return 'applied';
    }
    return 'acknowledged';
  }

  private async applyCreationSuccess(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<'applied' | 'acknowledged'> {
    const delivery = await this.findCreationDelivery(input);
    if (!delivery) return 'acknowledged';
    if (delivery.numberingMode === 'vendor' && input.vendorNumber) {
      await this.deps.numbering.applyVendorAssignedNumber(delivery.invoiceId, input.vendorNumber);
    }
    if (delivery.ksefRouting === 'vendor' && input.ksefReferenceNumber) {
      await this.deps.ksefAssignment.recordKsefAssignment(delivery.invoiceId, {
        ksefReferenceNumber: input.ksefReferenceNumber,
        ksefProcessedAt: new Date(),
      });
    }
    if (input.remoteDocumentId) {
      await this.deps.deliveries.markSucceeded(delivery.id, input.remoteDocumentId);
    }
    return 'applied';
  }

  private async applyCreationError(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<'applied' | 'acknowledged'> {
    const delivery = await this.findCreationDelivery(input);
    if (!delivery) return 'acknowledged';
    await this.deps.deliveries.markFailed(
      delivery.id,
      input.errorMessage ?? 'Infakt async invoice creation failed.',
    );
    return 'applied';
  }

  private async findCreationDelivery(
    input: InvoiceLedgerWebhookEventInput,
  ): Promise<LedgerDeliveryRecord | null> {
    if (input.asyncTaskId) {
      const row = await this.deps.emFactory().findOne(InvoiceLedgerDelivery, {
        adapterId: input.adapterId,
        asyncTaskId: input.asyncTaskId,
      });
      if (row) return this.deps.deliveries.getById(row.id);
    }
    if (input.remoteDocumentId) {
      const row = await this.deps.emFactory().findOne(InvoiceLedgerDelivery, {
        adapterId: input.adapterId,
        remoteDocumentId: input.remoteDocumentId,
      });
      if (row) return this.deps.deliveries.getById(row.id);
    }
    return null;
  }

  private async lookupUniqueMap(
    adapterId: string,
    remoteDocumentId: string | null,
  ): Promise<MapLookup> {
    if (!remoteDocumentId) return { kind: 'none' };
    const maps = await this.deps.emFactory().find(InvoiceLedgerDocumentMap, {
      adapterId,
      remoteDocumentId,
    });
    if (maps.length === 0) return { kind: 'none' };
    if (maps.length > 1) return { kind: 'ambiguous' };
    const invoiceId = maps[0]?.invoiceId;
    if (!invoiceId) return { kind: 'none' };
    return { kind: 'unique', invoiceId };
  }

  private async stampRemotePaid(deliveryId: string): Promise<void> {
    const em = this.deps.emFactory();
    const row = await em.findOne(InvoiceLedgerDelivery, { id: deliveryId });
    if (!row) return;
    row.remotePaidAt = new Date();
    await em.flush();
  }
}
