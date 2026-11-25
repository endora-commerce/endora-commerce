import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { translatePlural } from './plural.js';
import { MS_PER_DAY, validityDeadlineDays } from './validity.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Who the share reaches, as the confirm names them: a name, else the e-mail, else "the customer". */
export function shareCustomerName(
  t: Translate,
  customer: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined,
): string {
  const name = [customer?.firstName, customer?.lastName].filter((part) => part && part.trim() !== '').join(' ');
  if (name !== '') return name;
  if (customer?.email) return customer.email;
  return t('share.confirm.customerFallback');
}

/**
 * `specs/192-quote-request-draft-share/` — the question before a share, on the
 * detail screen and before *Create and share*. Sharing tells the customer and
 * cannot be undone (FR-025), so the question names who is told and the
 * validity the share writes — the date the customer is held to, counted from
 * the share (FR-032) — before the operator commits to it. Read with
 * `useTranslation('quote_requests')`.
 */
export function shareConfirmMessage(
  t: Translate,
  input: { customer: string; days: number | null; now: Date; language: string },
): string {
  const days = validityDeadlineDays(input.days);
  const validity =
    days !== null
      ? translatePlural(t, input.language, 'share.confirm.validityDays', days, {
          days,
          date: formatDateTime(new Date(input.now.getTime() + days * MS_PER_DAY).toISOString(), input.language),
        })
      : t('share.confirm.validityNone');
  return t('share.confirm.message', { customer: input.customer, validity });
}
