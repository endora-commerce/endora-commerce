import {
  INVOICE_LEDGER_SETTING_CODES,
  invoiceLedgerNumberingModeSchema,
  WFIRMA_DELIVERY_MESSAGES,
} from '@endora-commerce/contracts';
import { InvoiceLedgerDelivery } from '../../helpers/package-entities.js';
import type { InvoiceLedgerDelivery as InvoiceLedgerDeliveryRow } from '../../../../packages/modules/invoice_ledger/src/backend/entities/invoice-ledger-delivery.entity.js';
import { CorrectiveInvoiceProvider } from '../../../../packages/modules/invoices/dist/backend/services/corrective-invoice.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { setSellerSettings } from '../invoices/helpers.js';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { clearFamilyFor } from '../../helpers/capability-families.js';

type DeliveryRow = InvoiceLedgerDeliveryRow;

export const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
export const INFAKT_API_KEY = 'infakt-vat-push-key-119';
export const WFIRMA_ACCESS_KEY = 'wfirma-access-key-vat-push-129';
export const WFIRMA_SECRET_KEY = 'wfirma-secret-key-vat-push-129';
export const WFIRMA_APP_KEY = 'wfirma-app-key-vat-push-129';
export const WFIRMA_COMPANY_ID = '987654';
export const MISSING_NIP_MESSAGE =
  'The buyer NIP is missing, so this invoice cannot be copied to Infakt.';
export const WFIRMA_MISSING_NIP_MESSAGE = WFIRMA_DELIVERY_MESSAGES.missingNip;
const AUDIT = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

/**
 * Switch the instance vendor to Infakt: every **other** member of the invoice-ledger family
 * off, then Infakt on.
 *
 * The sibling used to be switched off **by name** (`wfirma`), which was right when the family
 * held two modules and `wfirma` was the other one. Feature 132 makes family membership a
 * manifest declaration the platform derives, so the siblings are derived here too: a third
 * vendor is handled by existing rather than by somebody remembering this file. The same D-100
 * shape as the array this feature deletes, one level up in the fixtures.
 *
 * What this does **not** change is the repair that put this helper in front of the two `infakt`
 * contract files: they call it instead of POSTing the activation raw, because the harness seeds
 * every module's operator axis to `true` and the raw POST met the vendor mutex.
 */
export async function activateInfakt(h: BackendServerHandle): Promise<void> {
  await clearFamilyFor(h, 'infakt');
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/modules/infakt/activation',
    ...ADMIN,
    payload: { active: true },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Infakt activation failed: ${res.statusCode} ${res.body}`);
  }
}

/** {@link activateInfakt}'s twin, and derived for the same reason. */
export async function activateWfirma(h: BackendServerHandle): Promise<void> {
  await clearFamilyFor(h, 'wfirma');
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/modules/wfirma/activation',
    ...ADMIN,
    payload: { active: true },
  });
  if (res.statusCode !== 200) {
    throw new Error(`wFirma activation failed: ${res.statusCode} ${res.body}`);
  }
}

export async function saveWfirmaConnection(h: BackendServerHandle): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/admin/wfirma/connection',
    ...ADMIN,
    payload: {
      accessKey: WFIRMA_ACCESS_KEY,
      secretKey: WFIRMA_SECRET_KEY,
      appKey: WFIRMA_APP_KEY,
      companyId: WFIRMA_COMPANY_ID,
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`wFirma connection upsert failed: ${res.statusCode} ${res.body}`);
  }
}

export async function deactivateWfirma(h: BackendServerHandle): Promise<void> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/modules/wfirma/activation',
    ...ADMIN,
    payload: { active: false },
  });
  if (res.statusCode !== 200) {
    throw new Error(`wFirma deactivation failed: ${res.statusCode} ${res.body}`);
  }
}

export async function deactivateInfakt(h: BackendServerHandle): Promise<void> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/modules/infakt/activation',
    ...ADMIN,
    payload: { active: false },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Infakt deactivation failed: ${res.statusCode} ${res.body}`);
  }
}

export async function saveInfaktConnection(
  h: BackendServerHandle,
  opts?: { webhookSecret?: string },
): Promise<void> {
  const res = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/admin/infakt/connection',
    ...ADMIN,
    payload: {
      apiKey: INFAKT_API_KEY,
      environment: 'sandbox',
      ...(opts?.webhookSecret !== undefined ? { webhookSecret: opts.webhookSecret } : {}),
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Infakt connection upsert failed: ${res.statusCode} ${res.body}`);
  }
}

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

export async function prepareWfirmaVatCopy(
  h: BackendServerHandle,
  channelCode: string,
  invoicePattern: string,
  proformaPattern?: string,
): Promise<string> {
  const channelId = await ensureSalesChannelId(h.em(), channelCode);
  await setSellerSettings(h);
  await h.settings.adminService.setValueForSubset(
    'invoices.numbering.invoice.pattern',
    [channelCode],
    invoicePattern,
    null,
    AUDIT,
  );
  if (proformaPattern !== undefined) {
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.proforma.pattern',
      [channelCode],
      proformaPattern,
      null,
      AUDIT,
    );
  }
  await h.settings.adminService.setValueForSubset(
    'invoices.numbering.correction.pattern',
    [channelCode],
    'KOR-WF {seq}/{YYYY}',
    null,
    AUDIT,
  );
  await activateWfirma(h);
  await saveWfirmaConnection(h);
  await setLedgerNumberingMode(h, 'vendor');
  return channelId;
}

export async function prepareInfaktVatCopy(
  h: BackendServerHandle,
  channelCode: string,
  invoicePattern: string,
  proformaPattern?: string,
): Promise<string> {
  const channelId = await ensureSalesChannelId(h.em(), channelCode);
  await setSellerSettings(h);
  await h.settings.adminService.setValueForSubset(
    'invoices.numbering.invoice.pattern',
    [channelCode],
    invoicePattern,
    null,
    AUDIT,
  );
  if (proformaPattern !== undefined) {
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.proforma.pattern',
      [channelCode],
      proformaPattern,
      null,
      AUDIT,
    );
  }
  await h.settings.adminService.setValueForSubset(
    'invoices.numbering.correction.pattern',
    [channelCode],
    'KOR-IL {seq}/{YYYY}',
    null,
    AUDIT,
  );
  await activateInfakt(h);
  await saveInfaktConnection(h);
  return channelId;
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
