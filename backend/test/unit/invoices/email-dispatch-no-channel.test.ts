import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type {
  TransactionalEmailSendInput,
  TransactionalEmailSender,
  TransactionalSendOutcome,
} from '@b2b/contracts';
import {
  InvoiceEmailDispatcher,
  type InvoiceEmailDispatchDeps,
} from '../../../src/modules/invoices/services/invoice-email-dispatch.js';
import { SettingsChannelIdInvalid } from '../../../src/kernel/settings/settings.service.js';
import { INVOICES_SETTING_CODES } from '../../../src/modules/invoices/manifest.js';

/**
 * Issue #103 — an invoice whose order carries no sales channel used to be
 * issued with its e-mail silently discarded.
 *
 * `salesChannelId: channelId ?? ''` reached the D-42 seam guard in
 * `SettingsService`, which rejects an empty string because it addresses no
 * `setting_values` row; the dispatcher's FR-029 `catch { return false }` then
 * absorbed the throw. Nothing was logged, nothing was returned, and the
 * operator saw a valid invoice and no message.
 *
 * "No channel" is `null` (D-41) and reads the platform-wide tier, so the three
 * tests below are: the settings reads reach that tier, the send names the same
 * `null`, and a send that genuinely does not happen says so.
 *
 * No database: every collaborator is a fake, and the fake settings reader is
 * the seam guard's own rule — a non-uuid string throws, `null` resolves.
 */

const INVOICE_ID = 'ffffffff-0000-4000-8000-000000000001';
const ORDER_ID = 'ffffffff-0000-4000-8000-000000000002';

/** The platform-wide values a `null` read resolves to in these tests. */
const PLATFORM_WIDE: Readonly<Record<string, unknown>> = {
  [INVOICES_SETTING_CODES.EMAIL_SEND_ON_ISSUE]: true,
  [INVOICES_SETTING_CODES.EMAIL_DELIVERY_MODE]: 'link',
  [INVOICES_SETTING_CODES.STOREFRONT_BASE_URL]: 'https://shop.example.com',
};

const CHANNEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FakeSettings {
  get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T>;
  readonly reads: Array<{ code: string; salesChannelId: string | null }>;
}

function fakeSettings(): FakeSettings {
  const reads: Array<{ code: string; salesChannelId: string | null }> = [];
  return {
    reads,
    async get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T> {
      // The `SettingsService` seam guard, verbatim in behaviour: anything that
      // is not a channel uuid and not `null` is a code defect, not a miss.
      if (salesChannelId !== null && !CHANNEL_UUID.test(salesChannelId)) {
        throw new SettingsChannelIdInvalid(code, salesChannelId);
      }
      reads.push({ code, salesChannelId });
      return schema.parse(PLATFORM_WIDE[code]);
    },
  };
}

class CapturingSender implements TransactionalEmailSender {
  readonly sent: TransactionalEmailSendInput[] = [];
  constructor(private readonly outcome: TransactionalSendOutcome = { status: 'sent' }) {}
  async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
    this.sent.push(input);
    return this.outcome;
  }
}

function deps(
  settings: FakeSettings,
  sender: TransactionalEmailSender | undefined,
  logged: Array<{ message: string; context: Record<string, unknown> }>,
): InvoiceEmailDispatchDeps {
  return {
    orderReadPort: {
      findById: async () => ({ id: ORDER_ID, businessId: 'ORD-1' }),
    } as unknown as InvoiceEmailDispatchDeps['orderReadPort'],
    invoiceService: {
      buildDetail: async () => ({
        id: INVOICE_ID,
        orderId: ORDER_ID,
        number: 'FV 1/2026',
        grossTotal: 123.45,
        currency: 'PLN',
        // The whole point: this order was placed with no sales channel.
        salesChannelId: null,
      }),
    } as unknown as InvoiceEmailDispatchDeps['invoiceService'],
    pdfRenderer: {
      render: async () => Buffer.from('%PDF-fake'),
    } as unknown as InvoiceEmailDispatchDeps['pdfRenderer'],
    settingsService: settings,
    getSender: () => sender,
    resolveRecipientEmail: async () => 'buyer@example.com',
    resolveLanguage: async () => 'en-US',
    log: (message, context) => logged.push({ message, context }),
  };
}

describe('invoices — dispatching the invoice e-mail with no sales channel (#103)', () => {
  it('reads send-on-issue platform-wide instead of answering "off"', async () => {
    const settings = fakeSettings();
    const dispatcher = new InvoiceEmailDispatcher(deps(settings, new CapturingSender(), []));

    await expect(dispatcher.sendOnIssueEnabled(null)).resolves.toBe(true);
    expect(settings.reads).toContainEqual({
      code: INVOICES_SETTING_CODES.EMAIL_SEND_ON_ISSUE,
      salesChannelId: null,
    });
  });

  it('sends the e-mail, naming the absent channel as null rather than ""', async () => {
    const settings = fakeSettings();
    const sender = new CapturingSender();
    const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
    const dispatcher = new InvoiceEmailDispatcher(deps(settings, sender, logged));

    await expect(dispatcher.dispatch(INVOICE_ID)).resolves.toEqual({ sent: true });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.salesChannelId).toBeNull();
    // The mode and the base URL were resolved platform-wide, not defaulted
    // without a read: `link` is the stored value, `attachment` the fallback.
    expect(sender.sent[0]!.attachments).toBeUndefined();
    const variables = sender.sent[0]!.variables as { invoice: { downloadUrl: string } };
    expect(variables.invoice.downloadUrl).toContain('https://shop.example.com/orders/');
    expect(logged).toHaveLength(0);
  });

  it('reports and logs a send the transport did not accept', async () => {
    const settings = fakeSettings();
    const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
    const dispatcher = new InvoiceEmailDispatcher(
      deps(settings, new CapturingSender({ status: 'no_transport' }), logged),
    );

    await expect(dispatcher.dispatch(INVOICE_ID)).resolves.toEqual({
      sent: false,
      reason: 'no_transport',
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.context).toMatchObject({ invoiceId: INVOICE_ID, reason: 'no_transport' });
  });

  it('contains a throwing send (FR-029) but names it in the result and the log', async () => {
    const settings = fakeSettings();
    const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
    const dispatcher = new InvoiceEmailDispatcher(
      deps(
        settings,
        {
          async send(): Promise<TransactionalSendOutcome> {
            throw new Error('smtp down');
          },
        },
        logged,
      ),
    );

    await expect(dispatcher.dispatch(INVOICE_ID)).resolves.toEqual({
      sent: false,
      reason: 'failed',
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]!.context).toMatchObject({ invoiceId: INVOICE_ID, reason: 'failed' });
    expect(String(logged[0]!.context['error'])).toContain('smtp down');
  });

  it('reports the absence of a sender rather than a silent false', async () => {
    const settings = fakeSettings();
    const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
    const dispatcher = new InvoiceEmailDispatcher(deps(settings, undefined, logged));

    await expect(dispatcher.dispatch(INVOICE_ID)).resolves.toEqual({
      sent: false,
      reason: 'no_sender',
    });
    expect(logged).toHaveLength(1);
  });
});
