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
import { INVOICES_SETTING_CODES } from '../../../src/modules/invoices/manifest.js';

/**
 * D-59 — the invoice e-mail names the document it delivers, so its delivery
 * record can be found by the invoice an operator is asked about.
 *
 * The record is written at the seam that knows the outcome, not by the
 * dispatcher, so what the dispatcher owes it is the one piece of context only
 * it holds: which legal document went into this message. Without it the row
 * carries a recipient and a template code, and answering "was invoice FV 1/2026
 * delivered" means guessing from a message id.
 */

const INVOICE_ID = 'ffffffff-0000-4000-8000-000000000001';
const ORDER_ID = 'ffffffff-0000-4000-8000-000000000002';

const PLATFORM_WIDE: Readonly<Record<string, unknown>> = {
  [INVOICES_SETTING_CODES.EMAIL_SEND_ON_ISSUE]: true,
  [INVOICES_SETTING_CODES.EMAIL_DELIVERY_MODE]: 'link',
  [INVOICES_SETTING_CODES.STOREFRONT_BASE_URL]: 'https://shop.example.com',
};

class CapturingSender implements TransactionalEmailSender {
  readonly sent: TransactionalEmailSendInput[] = [];
  async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
    this.sent.push(input);
    return { status: 'sent' };
  }
}

function deps(sender: TransactionalEmailSender): InvoiceEmailDispatchDeps {
  return {
    emFactory: () =>
      ({
        findOne: async () => ({ id: ORDER_ID, businessId: 'ORD-1' }),
      }) as unknown as ReturnType<InvoiceEmailDispatchDeps['emFactory']>,
    invoiceService: {
      buildDetail: async () => ({
        id: INVOICE_ID,
        orderId: ORDER_ID,
        number: 'FV 1/2026',
        grossTotal: 123.45,
        currency: 'PLN',
        salesChannelId: null,
      }),
    } as unknown as InvoiceEmailDispatchDeps['invoiceService'],
    pdfRenderer: {
      render: async () => Buffer.from('%PDF-fake'),
    } as unknown as InvoiceEmailDispatchDeps['pdfRenderer'],
    settingsService: {
      async get<T>(code: string, _channel: string | null, schema: z.ZodType<T>): Promise<T> {
        return schema.parse(PLATFORM_WIDE[code]);
      },
    },
    getSender: () => sender,
    resolveRecipientEmail: async () => 'buyer@example.com',
    resolveLanguage: async () => 'en-US',
    log: () => undefined,
  };
}

describe('invoices — the invoice e-mail names its document (D-59)', () => {
  it('passes the invoice as the delivered document', async () => {
    const sender = new CapturingSender();
    await expect(new InvoiceEmailDispatcher(deps(sender)).dispatch(INVOICE_ID)).resolves.toEqual({
      sent: true,
    });

    expect(sender.sent[0]!.document).toEqual({ type: 'invoice', id: INVOICE_ID });
  });
});
