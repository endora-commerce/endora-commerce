import { describe, expect, it } from 'vitest';
import {
  issueInvoiceNotice,
  sendInvoiceEmailMessage,
} from '../../../src/modules/invoices/email-outcome';

/**
 * Issue #149 — the words an operator reads for each invoice-e-mail outcome.
 *
 * `t` echoes the key and appends the params, so an assertion says which key was
 * chosen and which reason it carried, without pinning the copy.
 */
const t = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key}|${Object.values(params).join(',')}`;

describe('invoice e-mail outcome copy', () => {
  it('distinguishes the three send-on-issue answers', () => {
    expect(issueInvoiceNotice({ status: 'sent' }, t)).toBe(
      'orderDetail.issueInvoice.doneEmailSent',
    );
    expect(issueInvoiceNotice({ status: 'not_requested' }, t)).toBe(
      'orderDetail.issueInvoice.done',
    );
    expect(issueInvoiceNotice({ status: 'not_sent', reason: 'no_transport' }, t)).toBe(
      'orderDetail.issueInvoice.doneEmailNotSent|invoices.emailNotSent.no_transport',
    );
  });

  it('falls back to the plain confirmation when the server said nothing about the e-mail', () => {
    expect(issueInvoiceNotice(undefined, t)).toBe('orderDetail.issueInvoice.done');
  });

  it('reports a re-send that was suppressed as not-ok, with its reason', () => {
    expect(sendInvoiceEmailMessage({ ok: true }, t)).toEqual({
      ok: true,
      message: 'invoices.emailSent',
    });
    expect(sendInvoiceEmailMessage({ ok: false, reason: 'deactivated' }, t)).toEqual({
      ok: false,
      message: 'invoices.emailNotSentNotice|invoices.emailNotSent.deactivated',
    });
  });
});
