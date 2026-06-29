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
import { Invoice } from '../../../src/modules/invoices/entities/invoice.entity.js';
import { InvoiceLine } from '../../../src/modules/invoices/entities/invoice-line.entity.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';

const CH = 'cccccccc-0000-4000-8000-000000000001';

describe('invoices — corrective invoice from a return (US3)', () => {
  let h: BackendServerHandle;
  let provider: CorrectiveInvoiceProvider;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.invoice.pattern', 'FVCOR {seq}/{YYYY}', null, {
      actorAdminUserId: '00000000-0000-0000-0000-000000000000',
    });
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.correction.pattern', 'KOR-T {seq}/{YYYY}', null, {
      actorAdminUserId: '00000000-0000-0000-0000-000000000000',
    });
    provider = new CorrectiveInvoiceProvider(
      h.em,
      new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issueBaseInvoice(): Promise<{ orderId: string }> {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    return { orderId };
  }

  it('creates a correction referencing the original, with a correction-sequence number', async () => {
    const { orderId } = await issueBaseInvoice();
    const result = await provider.createCorrection({
      orderId,
      lines: [{ productName: 'Example Server', quantity: 1, amount: 1107 }],
      total: 1107,
      currency: 'PLN',
    });
    expect(result.number).toMatch(/^KOR-T \d+\/\d{4}$/);
    const em = h.em();
    const corr = await em.findOneOrFail(Invoice, { id: result.invoiceId });
    expect(corr.kind).toBe('correction');
    expect(corr.originalInvoiceId).toBeTruthy();
    const original = await em.findOneOrFail(Invoice, { id: corr.originalInvoiceId! });
    expect(original.kind).toBe('invoice');
    const lines = await em.find(InvoiceLine, { invoiceId: corr.id });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.netValue)).toBe(1107);
  });

  it('caps the credited total at the original invoice gross', async () => {
    const { orderId } = await issueBaseInvoice();
    const result = await provider.createCorrection({
      orderId,
      lines: [{ productName: 'Everything', quantity: 1, amount: 999999 }],
      total: 999999,
      currency: 'PLN',
    });
    const corr = await h.em().findOneOrFail(Invoice, { id: result.invoiceId });
    expect(Number(corr.total)).toBe(6648.15); // original gross, not 999999
  });
});
