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
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';

const CH = 'a0a0a0a0-0000-4000-8000-000000000001';

describe('invoices — audit logging (FR-035)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.invoice.pattern', 'FVAU {seq}/{YYYY}', null, {
      actorAdminUserId: '00000000-0000-0000-0000-000000000000',
    });
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
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    const provider = new CorrectiveInvoiceProvider(
      h.em,
      new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
      h.auditLogService,
    );
    const result = await provider.createCorrection({
      orderId,
      lines: [{ productName: 'X', quantity: 1, amount: 100 }],
      total: 100,
      currency: 'PLN',
    });
    const row = await h.em().findOne(AuditLogEntry, { action: 'invoice.corrected', objectId: result.invoiceId });
    expect(row).not.toBeNull();
  });
});
