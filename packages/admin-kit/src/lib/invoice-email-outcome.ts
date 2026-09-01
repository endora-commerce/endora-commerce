import type {
  InvoiceEmailNotSentReason,
  IssueInvoiceEmailOutcome,
  SendInvoiceEmailResult,
} from '@endora-commerce/contracts';

/**
 * The words an operator reads about an invoice e-mail, for the three surfaces
 * that can trigger one — issuing an invoice from the order, and re-sending one
 * from the invoice list or detail — so the answer reads the same wherever it
 * reaches them.
 *
 * **Published by feature 091, P8.** The file sat under `invoices`' admin
 * directory and `orders`' order detail imported it, which is the one
 * `cross-module-imports/orders.ts` key. Nothing here is `invoices`' code: the
 * three outcome shapes are `@endora-commerce/contracts`', and the sentences are
 * `core`'s.
 *
 * **That last part was already true when P8 opened, and is why this needed no
 * key move.** `plan.md`'s P8 row rules that the three key families move to
 * `core` because *"what crosses the seam is `invoices`' i18n namespace"*.
 * Measured from the component rather than from the prefix (R-1 §9.2, the
 * discipline P5a set): the file reads twelve keys — seven
 * `invoices.emailNotSent.*`, `invoices.emailSent`, `invoices.emailNotSentNotice`
 * and three `orderDetail.issueInvoice.*` — and all twelve are already in
 * `core`'s bundle in both shipped languages, in neither `invoices`' nor
 * `orders`'. All three call sites already hold a `useTranslation('core')`. The
 * `invoices.` and `orderDetail.` prefixes are key names inside `core`, not
 * namespaces, exactly as `pageBuilder.*` is after P5a.
 */

/** The scope-bound translator `useTranslation` hands out. */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The sentence for one of the seven reasons an invoice e-mail did not go out
 * (issue #103 named them, issue #149 put them on the wire).
 */
export function invoiceEmailNotSentReason(reason: InvoiceEmailNotSentReason, t: Translate): string {
  return t(`invoices.emailNotSent.${reason}`);
}

/**
 * What to tell the operator who asked for a re-send, and whether it is good
 * news. Both invoice surfaces reported `invoices.emailSent` unconditionally,
 * over a response body that could already say the message had been suppressed.
 */
export function sendInvoiceEmailMessage(
  result: SendInvoiceEmailResult,
  t: Translate,
): { ok: boolean; message: string } {
  if (result.ok) return { ok: true, message: t('invoices.emailSent') };
  return {
    ok: false,
    message: t('invoices.emailNotSentNotice', {
      reason: invoiceEmailNotSentReason(result.reason, t),
    }),
  };
}

/**
 * What to tell the operator after "issue invoice", given what became of the
 * notification.
 *
 * All three answers are distinct, and the middle one matters most: send-on-issue
 * being switched off is a configured choice, so it reads as a plain "issued"
 * rather than as a message that failed. A missing `email` field — an older
 * server, or a response shape a caller did not read — falls back to the same
 * plain confirmation, which is what the screen said before it could do better.
 */
export function issueInvoiceNotice(
  outcome: IssueInvoiceEmailOutcome | undefined,
  t: Translate,
): string {
  if (outcome?.status === 'sent') return t('orderDetail.issueInvoice.doneEmailSent');
  if (outcome?.status === 'not_sent') {
    return t('orderDetail.issueInvoice.doneEmailNotSent', {
      reason: invoiceEmailNotSentReason(outcome.reason, t),
    });
  }
  return t('orderDetail.issueInvoice.done');
}
