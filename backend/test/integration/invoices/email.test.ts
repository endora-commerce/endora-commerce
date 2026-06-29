import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TransactionalEmailSendInput, TransactionalEmailSender } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InvoiceEmailDispatcher } from '../../../src/modules/invoices/services/invoice-email-dispatch.js';
import { InvoiceService } from '../../../src/modules/invoices/services/invoice-service.js';
import { InvoicePdfRenderer } from '../../../src/modules/invoices/services/invoice-pdf-renderer.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../../src/modules/invoices/services/invoice-number-generator.js';
import { SellerSettingsResolver } from '../../../src/modules/invoices/services/seller-settings.js';
import { Invoice } from '../../../src/modules/invoices/entities/invoice.entity.js';
import { ADMIN_COOKIE, seedInvoiceableOrder, setSellerSettings } from './helpers.js';

const CH = 'eeeeeeee-0000-4000-8000-000000000001';

class CapturingSender implements TransactionalEmailSender {
  readonly sent: TransactionalEmailSendInput[] = [];
  async send(input: TransactionalEmailSendInput): Promise<void> {
    this.sent.push(input);
  }
}

describe('invoices — invoice email dispatch (US5)', () => {
  let h: BackendServerHandle;
  let sender: CapturingSender;
  let dispatcher: InvoiceEmailDispatcher;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setSellerSettings(h);
    const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.invoice.pattern', 'FVEM {seq}/{YYYY}', null, audit);
    await h.settings.adminService.setValueForAllChannels('invoices.storefront_base_url', 'https://shop.example.com', null, audit);

    sender = new CapturingSender();
    const invoiceService = new InvoiceService(
      h.em,
      new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
      new SellerSettingsResolver(h.settings.settingsService),
    );
    dispatcher = new InvoiceEmailDispatcher({
      emFactory: h.em,
      invoiceService,
      pdfRenderer: new InvoicePdfRenderer(),
      settingsService: h.settings.settingsService,
      getSender: () => sender,
      resolveRecipientEmail: async () => 'buyer@example.com',
      resolveLanguage: async () => 'en-US',
    });
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function issue(): Promise<string> {
    const { orderId } = await seedInvoiceableOrder(h.em(), { salesChannelId: CH });
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('attachment mode sends one email with a PDF attachment', async () => {
    const id = await issue();
    const ok = await dispatcher.dispatch(id, { mode: 'attachment' });
    expect(ok).toBe(true);
    const last = sender.sent.at(-1)!;
    expect(last.code).toBe('invoice_issued');
    expect(last.to).toBe('buyer@example.com');
    expect(last.attachments).toHaveLength(1);
    expect(Buffer.from(last.attachments![0]!.content).subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('link mode sends no attachment but supplies a download URL variable', async () => {
    const id = await issue();
    const ok = await dispatcher.dispatch(id, { mode: 'link' });
    expect(ok).toBe(true);
    const last = sender.sent.at(-1)!;
    expect(last.attachments).toBeUndefined();
    const vars = last.variables as { invoice: { downloadUrl: string } };
    expect(vars.invoice.downloadUrl).toContain('https://shop.example.com/orders/');
  });

  it('uses an idempotent messageId per invoice by default', async () => {
    const id = await issue();
    await dispatcher.dispatch(id);
    const last = sender.sent.at(-1)!;
    expect(last.messageId).toBe(`invoice_issued:${id}`);
  });

  it('a failed email does not invalidate the issued invoice', async () => {
    const id = await issue();
    const throwingDispatcher = new InvoiceEmailDispatcher({
      emFactory: h.em,
      invoiceService: new InvoiceService(
        h.em,
        new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService)),
        new SellerSettingsResolver(h.settings.settingsService),
      ),
      pdfRenderer: new InvoicePdfRenderer(),
      settingsService: h.settings.settingsService,
      getSender: () => ({
        async send() {
          throw new Error('smtp down');
        },
      }),
      resolveRecipientEmail: async () => 'buyer@example.com',
      resolveLanguage: async () => 'en-US',
    });
    const ok = await throwingDispatcher.dispatch(id);
    expect(ok).toBe(false); // swallowed
    const inv = await h.em().findOneOrFail(Invoice, { id });
    expect(inv.status).toBe('ready'); // still valid
  });
});
