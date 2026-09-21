import type {
  CredentialsPort,
  InvoiceCopyHostPort,
  InvoiceKsefAssignmentPort,
  InvoiceLedgerDeliveryPort,
  InvoiceNumberingHostPort,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { LEDGER_FIXTURE_DELIVERY_MESSAGES } from '../messages.js';
import type { LedgerFixtureHttpPort } from '../ports.js';
import { loadFrozenLedgerFixtureAuth } from './credential.js';

/**
 * The fixture's delivery processor — every consumer-side call the free
 * `invoiceLedgerDeliveryPort` publishes, in the order a real vendor makes them.
 *
 * ## Why it implements the whole sequence rather than the happy path
 *
 * This is the consumer half of FR-063's argument, one family over from
 * `carrier_fixture`'s: after wave 4 no module in this workspace calls
 * `markAwaitingRemote`, `recordQueuedWait`, `rememberClient`, `findClientRemoteId`
 * or `findDocumentRemoteId`, so a breaking change to any of them would compile
 * green here. Each is called below, and `tsc` is what keeps that true.
 *
 * ## No queue
 *
 * `wfirma` and `infakt` each own a BullMQ queue and a worker; this module owns
 * neither, deliberately. The queue is a vendor's own scaling decision
 * (Principle X) and nothing about the ledger's contract is expressed through it —
 * both vendors' workers do nothing but call `process(deliveryId)`, which is what
 * the free suite drives directly through the harness handle. A fixture with a
 * queue would add a Redis dependency to the example deployment's boot and prove
 * nothing the free ledger owns.
 */

export interface LedgerFixtureDeliveryProcessorDeps {
  deliveries: InvoiceLedgerDeliveryPort;
  invoiceCopy: InvoiceCopyHostPort;
  credentials: CredentialsPort;
  http: LedgerFixtureHttpPort;
  numbering?: InvoiceNumberingHostPort;
  ksefAssignment?: InvoiceKsefAssignmentPort;
}

export function createLedgerFixtureDeliveryProcessor(deps: LedgerFixtureDeliveryProcessorDeps) {
  return {
    async process(deliveryId: string): Promise<void> {
      const delivery = await deps.deliveries.getById(deliveryId);
      if (!delivery) return;
      // Already delivered: the ledger's idempotency contract is that a second
      // call is a no-op rather than a second document.
      if (delivery.remoteDocumentId || delivery.status === 'succeeded') return;

      const copy = await deps.invoiceCopy.getById(delivery.invoiceId);
      if (!copy) {
        await deps.deliveries.markFailed(
          deliveryId,
          LEDGER_FIXTURE_DELIVERY_MESSAGES.invoiceMissing,
        );
        return;
      }

      let originalRemoteDocumentId: string | null = null;
      if (delivery.kind === 'correction') {
        if (!copy.originalInvoiceId) {
          await deps.deliveries.markFailed(
            deliveryId,
            LEDGER_FIXTURE_DELIVERY_MESSAGES.originalMissing,
          );
          return;
        }
        originalRemoteDocumentId = await deps.deliveries.findDocumentRemoteId({
          adapterId: delivery.adapterId,
          invoiceId: copy.originalInvoiceId,
        });
        if (!originalRemoteDocumentId) {
          // Stays `queued`, not `failed`: the original may still be in flight.
          await deps.deliveries.recordQueuedWait(
            deliveryId,
            LEDGER_FIXTURE_DELIVERY_MESSAGES.originalWait,
          );
          return;
        }
      }

      const taxId = copy.buyer.taxId.replace(/[\s-]/g, '');
      if (taxId === '') {
        await deps.deliveries.markFailed(deliveryId, LEDGER_FIXTURE_DELIVERY_MESSAGES.missingNip);
        return;
      }

      const auth = await loadFrozenLedgerFixtureAuth(delivery, deps.credentials);
      if (!auth) {
        await deps.deliveries.markFailed(
          deliveryId,
          LEDGER_FIXTURE_DELIVERY_MESSAGES.credentialsMissing,
        );
        return;
      }

      // The client map, which is the ledger's own per-organization remote-id
      // cache. Read first, written once.
      const remoteClientId = await deps.deliveries.findClientRemoteId({
        adapterId: delivery.adapterId,
        organizationId: copy.organizationId,
        environment: delivery.environment,
        credentialCode: delivery.credentialCode,
      });
      if (!remoteClientId) {
        await deps.deliveries.rememberClient({
          adapterId: delivery.adapterId,
          organizationId: copy.organizationId,
          nipUsed: taxId,
          remoteClientId: `fixture-client-${taxId}`,
          credentialCode: delivery.credentialCode,
          environment: auth.environment,
          salesChannelId: delivery.salesChannelId,
        });
      }

      const created = await deps.http.createDocument({
        apiKey: auth.apiKey,
        environment: auth.environment,
        number: delivery.numberingMode === 'endora' ? copy.number : null,
        buyerTaxId: taxId,
        currency: copy.currency,
        originalRemoteDocumentId,
        sendToKsef: delivery.ksefRouting === 'vendor',
      });
      if (!created.ok) {
        await deps.deliveries.markFailed(deliveryId, created.message, { dead: !created.transient });
        return;
      }

      // `markAwaitingRemote` before `markSucceeded`, so the intermediate state a
      // real vendor's asynchronous API produces is reachable here too. The
      // `asyncTaskId` is the remote document id, because this vendor has no
      // second identifier to invent.
      await deps.deliveries.markAwaitingRemote(deliveryId, created.remoteDocumentId, {
        originalInvoiceId: copy.originalInvoiceId,
      });

      if (delivery.numberingMode === 'vendor' && created.remoteVendorNumber && deps.numbering) {
        await deps.numbering.applyVendorAssignedNumber(
          delivery.invoiceId,
          created.remoteVendorNumber,
        );
      }
      if (delivery.ksefRouting === 'vendor' && created.ksefReferenceNumber && deps.ksefAssignment) {
        await deps.ksefAssignment.recordKsefAssignment(delivery.invoiceId, {
          ksefReferenceNumber: created.ksefReferenceNumber,
          ksefProcessedAt: new Date(),
        });
      }

      await deps.deliveries.markSucceeded(deliveryId, created.remoteDocumentId, {
        originalInvoiceId: copy.originalInvoiceId,
        remoteVendorNumber: created.remoteVendorNumber,
      });
    },
  };
}

export function bindLedgerFixtureDeliveryProcessor(deps: LedgerFixtureDeliveryProcessorDeps) {
  const bound = createLedgerFixtureDeliveryProcessor(deps);
  return {
    process: (deliveryId: string) =>
      enterSystemScope('ledger_vendor_fixture delivery', () => bound.process(deliveryId)),
  };
}
