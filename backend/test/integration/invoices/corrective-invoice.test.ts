import { randomUUID } from 'crypto';
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
      () => new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issueBaseInvoice(
    opts: { lineTaxRate?: number } = {},
  ): Promise<{ orderId: string; itemIds: [string, string] }> {
    const { orderId, itemIds } = await seedInvoiceableOrder(h.em(), {
      salesChannelId: CH,
      ...(opts.lineTaxRate != null ? { lineTaxRate: opts.lineTaxRate } : {}),
    });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(res.statusCode).toBe(201);
    return { orderId, itemIds };
  }

  it('creates a correction referencing the original, with a correction-sequence number', async () => {
    const { orderId, itemIds } = await issueBaseInvoice();
    const result = await provider.createCorrection({
      orderId,
      lines: [
        { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 1107 },
      ],
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
    // The credited amount is the gross paid for the returned quantity.
    expect(Number(lines[0]!.grossValue)).toBe(1107);
  });

  it('caps the credited total at the original invoice gross', async () => {
    const { orderId, itemIds } = await issueBaseInvoice();
    const result = await provider.createCorrection({
      orderId,
      lines: [{ orderItemId: itemIds[0], productName: 'Everything', quantity: 1, amount: 999999 }],
      total: 999999,
      currency: 'PLN',
    });
    const corr = await h.em().findOneOrFail(Invoice, { id: result.invoiceId });
    expect(Number(corr.total)).toBe(6648.15); // original gross, not 999999
  });

  /**
   * Issue #131 — the correction mirrors the VAT rate of the line it corrects
   * (product ruling 2026-08-16), not the rate in force on the correction date
   * and not a constant.
   */
  it("carries the corrected line's non-zero VAT rate", async () => {
    const { orderId, itemIds } = await issueBaseInvoice();
    const result = await provider.createCorrection({
      orderId,
      lines: [
        { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 1107 },
      ],
      total: 1107,
      currency: 'PLN',
    });
    const em = h.em();
    const lines = await em.find(InvoiceLine, { invoiceId: result.invoiceId });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.taxRate)).toBe(0.23);
    expect(Number(lines[0]!.grossValue)).toBe(1107);
    expect(Number(lines[0]!.netValue)).toBe(900);
    expect(Number(lines[0]!.unitNetPrice)).toBe(900);
    expect(lines[0]!.orderItemId).toBe(itemIds[0]);

    // The document's own totals follow the lines: net + tax = gross.
    const corr = await em.findOneOrFail(Invoice, { id: result.invoiceId });
    expect(Number(corr.netTotal)).toBe(900);
    expect(Number(corr.taxTotal)).toBe(207);
    expect(Number(corr.total)).toBe(1107);
  });

  /**
   * The companion to the test above: a zero rate that is genuinely the
   * original's rate must survive, so a later "treat zero as absent" reading
   * cannot collapse the two cases silently.
   */
  it('still corrects a genuinely zero-rated line at zero', async () => {
    const { orderId, itemIds } = await issueBaseInvoice({ lineTaxRate: 0 });
    const result = await provider.createCorrection({
      orderId,
      lines: [
        { orderItemId: itemIds[0], productName: 'Example Server', quantity: 1, amount: 900 },
      ],
      total: 900,
      currency: 'PLN',
    });
    const em = h.em();
    const lines = await em.find(InvoiceLine, { invoiceId: result.invoiceId });
    expect(lines).toHaveLength(1);
    expect(Number(lines[0]!.taxRate)).toBe(0);
    expect(Number(lines[0]!.netValue)).toBe(900);
    expect(Number(lines[0]!.grossValue)).toBe(900);

    const corr = await em.findOneOrFail(Invoice, { id: result.invoiceId });
    expect(Number(corr.netTotal)).toBe(900);
    expect(Number(corr.taxTotal)).toBe(0);
  });

  it('refuses a corrective line with no counterpart on the original invoice', async () => {
    const { orderId } = await issueBaseInvoice();
    await expect(
      provider.createCorrection({
        orderId,
        lines: [{ orderItemId: randomUUID(), productName: 'Never invoiced', quantity: 1, amount: 100 }],
        total: 100,
        currency: 'PLN',
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  /**
   * A settled return on a never-invoiced order still produces its credit note
   * (the returns settlement path does not know whether an invoice exists).
   * There is no original line, so there is no rate to mirror — pinned here so
   * that changing it is a decision rather than a side effect.
   */
  it('credits a never-invoiced order at zero, with no original to mirror', async () => {
    const { orderId, itemIds } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const result = await provider.createCorrection({
      orderId,
      lines: [{ orderItemId: itemIds[0], productName: 'Serwer', quantity: 1, amount: 1107 }],
      total: 1107,
      currency: 'PLN',
    });
    const em = h.em();
    const corr = await em.findOneOrFail(Invoice, { id: result.invoiceId });
    expect(corr.originalInvoiceId).toBeFalsy();
    const lines = await em.find(InvoiceLine, { invoiceId: corr.id });
    expect(Number(lines[0]!.taxRate)).toBe(0);
  });
});
