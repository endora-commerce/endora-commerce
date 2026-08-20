import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CorrectiveInvoiceProvider } from '../../../src/modules/invoices/services/corrective-invoice.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../../src/modules/invoices/services/invoice-number-generator.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

// Feature 078, D-95: `{channel}` is rendered from the `sales_channels`

// row, so this file's channel has to be one. The per-file code keeps this

// file's numbers distinct in the shared test database, which is what the

// fabricated id used to be for.

let CH: string;

describe('invoices — audit logging (FR-035)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    CH = await ensureSalesChannelId(h.em(), 'inv-audit');
    await setSellerSettings(h);
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      ['inv-audit'],
      'FVAU {seq}/{YYYY}',
      null,
      { actorAdminUserId: '00000000-0000-0000-0000-000000000000' },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records invoice.issued on issuance', async () => {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    const id = (res.json() as { data: { id: string } }).data.id;
    const row = await h.em().findOne(AuditLogEntry, { action: 'invoice.issued', objectId: id });
    expect(row).not.toBeNull();
  });

  it('records invoice.corrected on a correction', async () => {
    const { orderId, itemIds } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    const provider = new CorrectiveInvoiceProvider(
      h.em,
      () => new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
      h.auditLogService,
    );
    const result = await provider.createCorrection({
      orderId,
      lines: [{ orderItemId: itemIds[0], productName: 'X', quantity: 1, amount: 100 }],
      total: 100,
      currency: 'PLN',
    });
    // The order was invoiced above, so a correction is due (#135).
    if (!result.issued) throw new Error(`Expected a correction: ${result.reason}`);
    const row = await h.em().findOne(AuditLogEntry, { action: 'invoice.corrected', objectId: result.invoiceId });
    expect(row).not.toBeNull();
  });
});
