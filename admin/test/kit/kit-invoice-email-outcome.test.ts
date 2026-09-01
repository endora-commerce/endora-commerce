import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  invoiceEmailNotSentReason,
  issueInvoiceNotice,
  sendInvoiceEmailMessage,
} from '@endora-commerce/admin-kit/lib';
import { invoiceEmailNotSentReasonSchema } from '@endora-commerce/contracts';

/**
 * Issue #149 — the words an operator reads for each invoice-e-mail outcome.
 *
 * The three functions are `@endora-commerce/admin-kit/lib`'s since feature
 * 091's P8; the file used to import them from `invoices`' admin directory,
 * which is the reach `orders`' order detail also made.
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

/**
 * The keys the three functions read, derived from the contract enum rather than
 * written down: a reason added to `invoiceEmailNotSentReasonSchema` is a
 * sentence this screen owes, and a list here would go stale silently.
 */
const KEYS = [
  ...invoiceEmailNotSentReasonSchema.options.map(
    (reason) => `invoices.emailNotSent.${reason}`,
  ),
  'invoices.emailSent',
  'invoices.emailNotSentNotice',
  'orderDetail.issueInvoice.doneEmailSent',
  'orderDetail.issueInvoice.doneEmailNotSent',
  'orderDetail.issueInvoice.done',
];

const REPO_ROOT = resolve(process.cwd(), '..');

function bundle(module: string, language: 'en' | 'pl'): Record<string, string> {
  const raw = readFileSync(
    join(REPO_ROOT, 'packages/modules', module, 'i18n', `${language}.json`),
    'utf8',
  );
  return JSON.parse(raw) as Record<string, string>;
}

/**
 * **What crosses this seam is a key set, and R-1 rules that a namespace is
 * module knowledge.** `plan.md`'s P8 row says the three families move to `core`;
 * measured from the functions rather than from the `invoices.` prefix — R-1
 * §9.2's lesson and P5a's discipline — they were already there, and neither
 * `invoices`' bundle nor `orders`' carries a copy. So the assertion is the one
 * that keeps it true: nothing about a key that is not in the namespace the
 * callers hand in is loud, because `resolver.ts` returns `` `${scope}.${key}` ``
 * and every passthrough-bundle test stays green.
 */
describe('R-1 — the invoice e-mail sentences are `core`\'s, in both shipped languages', () => {
  it('carries every key the three functions read', () => {
    expect(KEYS.length).toBeGreaterThan(0);
    for (const language of ['en', 'pl'] as const) {
      const core = bundle('_i18n', language);
      expect(KEYS.filter((key) => !(key in core))).toEqual([]);
    }
  });

  it('leaves no copy behind in `invoices`\' or `orders`\' own bundles', () => {
    for (const module of ['invoices', 'orders']) {
      for (const language of ['en', 'pl'] as const) {
        const own = bundle(module, language);
        expect(KEYS.filter((key) => key in own)).toEqual([]);
      }
    }
  });

  it('reads the same reason key the contract enumerates, for every reason', () => {
    for (const reason of invoiceEmailNotSentReasonSchema.options) {
      expect(invoiceEmailNotSentReason(reason, t)).toBe(`invoices.emailNotSent.${reason}`);
    }
  });
});
