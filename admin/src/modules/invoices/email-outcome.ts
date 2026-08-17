import type {
  InvoiceEmailNotSentReason,
  IssueInvoiceEmailOutcome,
  SendInvoiceEmailResult,
} from '@b2b/contracts';

/** The scope-bound translator `useTranslation` hands out. */
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * The sentence for one of the seven reasons an invoice e-mail did not go out
 * (issue #103 named them, issue #149 put them on the wire).
 *
 * Shared by every surface that can trigger a send — issuing an invoice from the
 * order, and re-sending one from the invoice list or detail — so an operator
 * reads the same words wherever the answer reaches them.
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
