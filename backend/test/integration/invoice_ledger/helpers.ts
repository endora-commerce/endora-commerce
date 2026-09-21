import {
  INVOICE_LEDGER_SETTING_CODES,
  invoiceLedgerNumberingModeSchema,
} from '@endora-commerce/contracts';
import { InvoiceLedgerDelivery } from '../../helpers/package-entities.js';
import type { InvoiceLedgerDelivery as InvoiceLedgerDeliveryRow } from '../../../../packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-delivery.entity.js';
import { CorrectiveInvoiceProvider } from '../../../../packages/modules/invoices/dist/backend/services/corrective-invoice.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { setSellerSettings } from '../invoices/helpers.js';
import type { BackendServerHandle } from '../../helpers/test-server.js';

/**
 * The free ledger suite's shared collaborator — and since D-256, **only** the
 * half of it that names no vendor.
 *
 * ## What moved, and why the file had to be split rather than trimmed
 *
 * This file used to carry `activateInfakt`, `saveWfirmaConnection`,
 * `prepareInfaktVatCopy`, a vendor's delivery-message vocabulary and a dozen more
 * like them, and it had **37** consumers — 11 in this directory and 26 outside
 * it, of which
 * 25 are `wfirma`, `infakt` or `ksef` host files that leave this repository with
 * their package. So a *free* module's shared fixture was where three paid
 * vendors' connection shapes were written down, and
 * `contracts/extraction-procedure.md` **E5** stops on exactly that: a symbol out
 * of `packages/contracts/src/wfirma.ts` still answering outside
 * `packages/modules/wfirma`.
 *
 * Each vendor's half now sits in that vendor's own host directory —
 * `backend/test/integration/{infakt,wfirma}/helpers.ts` — which is where it
 * travels from, under D-252. What is left here is what `invoice_ledger` owns:
 * issuing a document, waiting for the row the ledger writes, and the ledger's own
 * routing writes. None of it knows which vendor is active, which is the property
 * that makes it survive wave 4 — and it is what
 * `fixture-vendor-delivery.test.ts` drives against a vendor that is not going
 * anywhere.
 *
 * **The recorded count of this file's consumers was 19, and it is 37.** D-256
 * reads *"19 consumers — 11 inside its own directory and 8 outside it"*; those 8
 * are the `contract/` consumers, and the derivation missed the 18 under
 * `integration/`. Re-derived here by import specifier rather than by symbol,
 * which is the instrument D-256's own closing paragraph asks for.
 */

type DeliveryRow = InvoiceLedgerDeliveryRow;

export const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const AUDIT = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

export async function issueCorrection(
  h: BackendServerHandle,
  input: { orderId: string; itemId: string; amount?: number },
): Promise<{ id: string; number: string }> {
  const provider = new CorrectiveInvoiceProvider(
    h.em,
    () => h.invoices.numberGenerator,
    h.auditLogService,
    h.eventBus,
    {
      numberingModeFor: async (salesChannelId) =>
        h.settings.settingsService.get(
          INVOICE_LEDGER_SETTING_CODES.NUMBERING_MODE,
          salesChannelId,
          invoiceLedgerNumberingModeSchema,
        ),
      activeVendorModuleId: () => h.invoiceLedgerRegistry.getActiveModuleId(),
    },
  );
  const amount = input.amount ?? 1107;
  const result = await withSystemScope('issue ledger correction', () =>
    provider.createCorrection({
      orderId: input.orderId,
      lines: [
        {
          orderItemId: input.itemId,
          productName: 'Example Server',
          quantity: 1,
          amount,
        },
      ],
      total: amount,
      currency: 'PLN',
    }),
  );
  if (!result.issued) {
    throw new Error(`Expected a correction: ${result.reason}`);
  }
  return { id: result.invoiceId, number: result.number };
}

export async function issueInvoice(
  h: BackendServerHandle,
  orderId: string,
  kind: 'invoice' | 'proforma' = 'invoice',
): Promise<{ id: string; number: string }> {
  const res = await h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/orders/${orderId}/invoices`,
    payload: { kind },
    ...ADMIN,
  });
  if (res.statusCode !== 201) {
    throw new Error(`Invoice issuance failed (${res.statusCode}): ${res.body}`);
  }
  const data = (res.json() as { data: { id: string; number: string } }).data;
  return data;
}

export async function waitForDelivery(
  h: BackendServerHandle,
  invoiceId: string,
  timeoutMs = 3_000,
): Promise<DeliveryRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await withSystemScope('test poll ledger delivery', () =>
      h.em().fork().findOne(InvoiceLedgerDelivery, { invoiceId }),
    );
    if (row) return row;
    if (Date.now() > deadline) {
      throw new Error(`No ledger delivery appeared for invoice ${invoiceId}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function findDelivery(
  h: BackendServerHandle,
  invoiceId: string,
): Promise<DeliveryRow | null> {
  return withSystemScope('test read ledger delivery', () =>
    h.em().fork().findOne(InvoiceLedgerDelivery, { invoiceId }),
  );
}

export async function setLedgerKsefRouting(
  h: BackendServerHandle,
  ksefRouting: 'native' | 'vendor',
): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/admin/invoice-ledger/routing',
    ...ADMIN,
    payload: { ksefRouting },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Ledger KSeF routing write failed: ${res.statusCode} ${res.body}`);
  }
}

export async function setLedgerNumberingMode(
  h: BackendServerHandle,
  numberingMode: 'endora' | 'vendor',
): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/admin/invoice-ledger/routing',
    ...ADMIN,
    payload: { numberingMode, confirm: true },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Ledger numbering mode write failed: ${res.statusCode} ${res.body}`);
  }
}

/**
 * The numbering arrangement every VAT-copy test needs before it issues anything:
 * a channel, the seller's own settings, and the patterns.
 *
 * It is here rather than in each vendor's half because none of it is a vendor's —
 * the patterns are `invoices`', the channel is `sales_channels`'. The two vendor
 * `prepare*VatCopy` fixtures differ only in the correction prefix they pass and
 * in what they do **after**, which is the vendor's half and stays there.
 */
export async function prepareLedgerNumbering(
  h: BackendServerHandle,
  input: {
    channelCode: string;
    invoicePattern: string;
    proformaPattern?: string;
    correctionPattern: string;
  },
): Promise<string> {
  const channelId = await ensureSalesChannelId(h.em(), input.channelCode);
  await setSellerSettings(h);
  await h.settings.adminService.setValueForSubset(
    'invoices.numbering.invoice.pattern',
    [input.channelCode],
    input.invoicePattern,
    null,
    AUDIT,
  );
  if (input.proformaPattern !== undefined) {
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.proforma.pattern',
      [input.channelCode],
      input.proformaPattern,
      null,
      AUDIT,
    );
  }
  await h.settings.adminService.setValueForSubset(
    'invoices.numbering.correction.pattern',
    [input.channelCode],
    input.correctionPattern,
    null,
    AUDIT,
  );
  return channelId;
}
