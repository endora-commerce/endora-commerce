import type { ReactNode } from 'react';
import { randomUUID } from 'node:crypto';
import type { ReturnFormConfig } from '@endora-commerce/contracts';
import type { ReturnReason } from '../../lib/api/returns';
import type { AddressSummary } from '../../lib/api/organization';
import type { getMe } from '../../lib/api/account';
import { codeLabel } from '../../lib/account/labels';
import { format } from '../../lib/i18n/format';
import type { MessageKey } from '../../lib/i18n/messages';
import { LocalizedLink } from '../../lib/i18n/localized-link';
import { RETURN_FORM_LIMITS, tooLargeSentence } from '../../lib/returns/attachments';
import { keptByLine, keptOf, type ReturnsAttempt } from '../../lib/returns/returnForm';
import { AddressFields } from '../account/AddressFields';
import { CartSubmitButton } from '../CartSubmitButton';
import { AttachmentField } from './AttachmentField';
import { ClauseList } from './ClauseList';
import { OffPlatformLines } from './OffPlatformLines';

type Me = Awaited<ReturnType<typeof getMe>> | null;

/** The guest's side of the form (`specs/181-guest-complaints/` design review S-5). */
export interface GuestFormMode {
  /** The verified address: shown as locked text, never posted (FR-031, F-4). */
  readonly email: string;
  /** A customer session is present in this browser too: say the complaint will be a guest's. */
  readonly signedIn: boolean;
}

/**
 * The complaint about a product bought elsewhere (`specs/180-off-platform-complaints/` US5;
 * design review R-2): one page of numbered sections that works without JavaScript, posting
 * multipart to a route handler.
 *
 * Two modes, one form (`specs/181-guest-complaints/` design review F-10; Constitution IX):
 *
 * - **customer** — contact and address come prefilled from the account and its delivery
 *   address, collapsed behind a summary, and changing them here changes neither (FR-B16).
 * - **guest** — the verified e-mail is locked text with *Use a different address* beside it,
 *   name, phone and address are open and empty (FR-031), a signed-in browser is told the
 *   complaint will be a guest's, there is no order to choose instead, *Cancel* goes home,
 *   and the files upload through the guest handler.
 */
export function OffPlatformForm({
  mode,
  action,
  uploadAction,
  t,
  locale,
  config,
  reasons,
  me = null,
  address = null,
  guest,
  attempt,
  errors,
  search,
}: {
  mode: 'customer' | 'guest';
  /** The route handler the form posts to. */
  action: string;
  /** The route handler the JS upload posts to; `AttachmentField`'s default otherwise. */
  uploadAction?: string;
  t: (key: MessageKey) => string;
  locale: string;
  /** The catalogue search behind each line's product field (`ProductField`). */
  search: { apiBaseUrl: string | null; salesChannelCode: string | undefined };
  config: ReturnFormConfig | null;
  reasons: readonly ReturnReason[];
  me?: Me;
  address?: AddressSummary | null;
  guest?: GuestFormMode;
  attempt: ReturnsAttempt | null;
  errors: readonly string[];
}): ReactNode {
  const isGuest = mode === 'guest';
  const answers = attempt?.answers ?? {};
  const limits = config?.attachmentLimits ?? RETURN_FORM_LIMITS;
  const clauses = config?.clauses ?? [];
  const value = (name: string, fallback: string): string => answers[name] ?? fallback;
  const label = (r: ReturnReason): string =>
    r.label[locale] ?? r.label[locale.split('-')[0]!] ?? r.label['en'] ?? Object.values(r.label)[0] ?? r.id;
  const account = isGuest ? undefined : me?.customerAccount;
  const fullName = account ? `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim() : '';
  const company = !isGuest && me?.organization && !me.organization.isPersonal ? me.organization.name : '';
  const prefill = isGuest ? null : address;
  const upload = uploadAction ? { uploadAction } : {};
  let n = 0;
  const next = (): number => (n += 1);

  const contactFields = (
    <>
      <div className="b2b-auth__field">
        <label htmlFor="contact-name">{t('returns.elsewhere.contactName')}</label>
        <input id="contact-name" name="contact.name" required maxLength={200} autoComplete="name" defaultValue={value('contact.name', fullName)} />
      </div>
      <div className="b2b-auth__row">
        {isGuest ? null : (
          <div className="b2b-auth__field">
            <label htmlFor="contact-email">{t('returns.elsewhere.contactEmail')}</label>
            <input id="contact-email" name="contact.email" type="email" required maxLength={254} autoComplete="email" defaultValue={value('contact.email', account?.email ?? '')} />
          </div>
        )}
        <div className="b2b-auth__field">
          <label htmlFor="contact-phone">{t('returns.elsewhere.contactPhone')}</label>
          <input id="contact-phone" name="contact.phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={value('contact.phone', prefill?.phone ?? '')} />
        </div>
      </div>
      <div className="b2b-auth__field">
        <label htmlFor="ret-addr-name">{t('returns.elsewhere.recipient')}</label>
        <input id="ret-addr-name" name="returnAddress.name" required maxLength={200} autoComplete="name" defaultValue={value('returnAddress.name', prefill?.recipientName ?? fullName)} />
      </div>
      <AddressFields
        t={t}
        idPrefix="ret-addr"
        namePrefix="returnAddress."
        company
        phone={false}
        defaults={{
          company: value('returnAddress.company', company),
          street: value('returnAddress.street', prefill?.street ?? ''),
          city: value('returnAddress.city', prefill?.city ?? ''),
          postalCode: value('returnAddress.postalCode', prefill?.postalCode ?? ''),
          country: value('returnAddress.country', prefill?.country ?? 'PL'),
        }}
        {...(errors.includes('returnAddress') ? { errors: { street: t('returns.errors.returnAddress') } } : {})}
      />
    </>
  );

  return (
    <div className="b2b-auth b2b-stacked max-w-[720px]">
      {isGuest && guest ? (
        <>
          {guest.signedIn ? (
            <p role="note" className="b2b-auth__notice mb-3">
              {t('returns.guest.form.signedIn')}{' '}
              <LocalizedLink href="/returns/new?origin=elsewhere" className="font-semibold">
                {t('returns.guest.form.signedInLink')}
              </LocalizedLink>
            </p>
          ) : null}
          {/* Outside the complaint form — a form cannot nest — and before anything is typed:
              leaving discards the answers (design review F-16). */}
          <form id="guest-leave" method="post" action="/returns/guest/leave" />
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
            <span>{t('returns.guest.form.filingAs')}</span>
            <span aria-hidden="true">·</span>
            <strong>{guest.email}</strong>
            <span className="b2b-badge">
              <span aria-hidden="true">✓</span> {t('returns.guest.form.verified')}
            </span>
            <span aria-hidden="true">·</span>
            <button type="submit" form="guest-leave" className="b2b-stacked__add">
              {t('returns.guest.form.useOther')}
            </button>
          </p>
        </>
      ) : (
        <p className="text-[13px]">
          <LocalizedLink href="/returns/new" className="b2b-account__link b2b-account__link--standalone">{t('returns.elsewhere.backToOrders')}</LocalizedLink>
        </p>
      )}
      <h1>{t('returns.elsewhere.heading')}</h1>
      <p>{isGuest && guest ? format(t('returns.guest.form.intro'), { email: guest.email }) : t('returns.elsewhere.intro')}</p>
      <ErrorSummary t={t} locale={locale} errors={errors} />
      <form method="post" action={action} encType="multipart/form-data" noValidate className="b2b-auth__form">
        <input type="hidden" name="origin" value="elsewhere" />
        <input type="hidden" name="submissionKey" value={randomUUID()} />
        {isGuest ? (
          // The honeypot (research R-8): off-screen, out of the tab order, never `display:none`.
          <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
            <input name="hp" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
        ) : null}

        <fieldset>
          <legend>{format(t('returns.elsewhere.section.product'), { n: String(next()) })}</legend>
          <OffPlatformLines
            t={t}
            locale={locale}
            reasons={reasons.map((r) => ({ id: r.id, label: label(r) }))}
            answers={answers}
            errors={errors}
            apiBaseUrl={search.apiBaseUrl}
            salesChannelCode={search.salesChannelCode}
            limits={limits}
            keptPhotos={keptByLine(attempt)}
            {...upload}
          />
        </fieldset>

        <fieldset>
          <legend>{format(t('returns.elsewhere.section.purchase'), { n: String(next()) })}</legend>
          <div className="b2b-auth__row">
            <div className="b2b-auth__field">
              <label htmlFor="purchase-date">{t('returns.elsewhere.purchaseDate')}</label>
              <input
                id="purchase-date"
                name="purchase.date"
                type="date"
                required
                {...(config?.today ? { max: config.today } : {})}
                defaultValue={value('purchase.date', '')}
                {...(errors.some((e) => e.startsWith('purchase_date')) ? { 'aria-invalid': true } : {})}
              />
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="purchase-number">{t('returns.elsewhere.purchaseNumber')}</label>
              <input id="purchase-number" name="purchase.proofNumber" maxLength={100} defaultValue={value('purchase.proofNumber', '')} />
            </div>
          </div>
          <AttachmentField
            type="proof_of_purchase"
            locale={locale}
            id="files-proof"
            label={`${t('returns.elsewhere.proof')} ${t(config?.proofOfPurchaseRequired ? 'returns.elsewhere.proofRequired' : 'returns.elsewhere.proofOptional')}`}
            limits={limits}
            kept={keptOf(attempt, 'proof_of_purchase')}
            {...upload}
          />
        </fieldset>

        <fieldset>
          <legend>{format(t('returns.elsewhere.section.contact'), { n: String(next()) })}</legend>
          {isGuest && guest ? (
            // Nothing to summarise for a guest, so no `<details>` (design review S-5): the
            // verified address as locked text first, then the open fields.
            <>
              <div className="b2b-auth__field">
                <span id="guest-email-label" className="b2b-stacked__label">
                  {t('returns.elsewhere.contactEmail')}
                </span>
                <p aria-labelledby="guest-email-label" className="m-0 flex flex-wrap items-center gap-2">
                  <span>{guest.email}</span>
                  <span className="b2b-badge">
                    <span aria-hidden="true">✓</span> {t('returns.guest.form.verified')}
                  </span>
                </p>
                <p className="text-[12px] text-muted">{t('returns.guest.form.emailLocked')}</p>
              </div>
              {contactFields}
            </>
          ) : (
            <>
              <p className="text-[13px] text-muted">{t('returns.elsewhere.changesStayHere')}</p>
              <details className="b2b-stacked__contact" open={errors.includes('contact') || errors.includes('returnAddress') || !fullName}>
                <summary>
                  <span className="min-w-0 truncate">
                    {value('contact.name', fullName)} · {value('contact.email', account?.email ?? '')}
                  </span>
                  <span className="shrink-0 text-[13px] font-medium text-accent">{t('returns.elsewhere.editContact')}</span>
                </summary>
                {contactFields}
              </details>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>{format(t('returns.elsewhere.section.documents'), { n: String(next()) })}</legend>
          <AttachmentField type="other" locale={locale} id="files-other" label={t('returns.elsewhere.otherFiles')} limits={limits} kept={keptOf(attempt, 'other')} {...upload} />
        </fieldset>

        {clauses.length > 0 ? (
          <fieldset>
            <legend>{format(t('returns.elsewhere.section.terms'), { n: String(next()) })}</legend>
            {errors.includes('clauses_changed') ? <p className="b2b-auth__notice">{t('returns.errors.clauses_changed')}</p> : null}
            <ClauseList clauses={clauses} t={t} />
          </fieldset>
        ) : null}

        <div className="b2b-stacked__actions">
          <CartSubmitButton
            trackNativeSubmit
            className="btn btn--primary btn--lg"
            label={t('returns.elsewhere.submit')}
            pendingLabel={t('returns.guest.form.submitting')}
          />
          <LocalizedLink href={isGuest ? '/' : '/returns'} className="btn btn--ghost">
            {t('returns.elsewhere.cancel')}
          </LocalizedLink>
        </div>
      </form>
    </div>
  );
}

/**
 * The refusals of the last attempt, at the top of the form (design review R-2.6): a title,
 * one entry per refusal, focusable for the announcement. A code the page does not know reads
 * as the generic failure, never as the raw value. The guest's own refusals — a limit, a
 * throttle, an expired session — have their sentences (181 design review F-17).
 */
export function ErrorSummary({ t, locale, errors }: { t: (key: MessageKey) => string; locale: string; errors: readonly string[] }): ReactNode {
  return (
    <div id="returns-errors" role="alert" tabIndex={-1} className={errors.length > 0 ? 'b2b-auth__error' : undefined}>
      {errors.length > 0 ? (
        <>
          <p className="font-semibold">{t('returns.errors.heading')}</p>
          <ul>
            {[...new Set(errors)].map((code) => (
              <li key={code}>{code === 'too_large' ? tooLargeSentence(locale) : errorText(t, code)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** The guest flow's refusal codes and their sentences (181). */
const GUEST_ERRORS: Readonly<Record<string, MessageKey>> = {
  guest_limit_cases_per_session: 'returns.guest.errors.cases_per_session',
  guest_limit_cases_per_address: 'returns.guest.errors.cases_per_address',
  RATE_LIMITED: 'returns.guest.errors.rate_limited',
  session_expired: 'returns.guest.errors.session_expired',
};

function errorText(t: (key: MessageKey) => string, code: string): string {
  const guest = GUEST_ERRORS[code];
  if (guest) return t(guest);
  const sentence = codeLabel(t, 'returns.errors', code);
  return sentence === code ? t('returns.errors.generic') : sentence;
}
