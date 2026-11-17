import type { ReactNode } from 'react';
import { codeLabel } from '../../../../lib/account/labels';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { ReturnFormConfig } from '@endora-commerce/contracts';
import { listMyOrders } from '../../../../lib/api/orders';
import { publicApiBaseUrl } from '../../../../lib/env.mjs';
import { getReturnFormConfig, getReturnable, listReturnReasons, type ReturnReason } from '../../../../lib/api/returns';
import { listAddresses, type AddressSummary } from '../../../../lib/api/organization';
import { format } from '../../../../lib/i18n/format';
import { RETURN_FORM_LIMITS, tooLargeSentence } from '../../../../lib/returns/attachments';
import {
  RETURNS_ATTEMPT_COOKIE,
  decodeReturnsAttempt,
  type ReturnsAttempt,
} from '../../../../lib/returns/returnForm';
import { AttachmentField } from '../../../../components/returns/AttachmentField';
import { ClauseList } from '../../../../components/returns/ClauseList';
import { OffPlatformLines } from '../../../../components/returns/OffPlatformLines';
import { AddressFields } from '../../../../components/account/AddressFields';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { getMe } from '../../../../lib/api/account';
import { memberSession } from '../../../../lib/commerce-permissions';
import {
  mayStartReturn,
  parseReturnKind,
  returnFormHref,
  returnFormModel,
  type ReturnKind,
} from '../../../../lib/returns/returnForm';
import { ReturnFormLines } from '../../../../components/returns/ReturnFormLines';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * New return/complaint submission (feature 046, US1). Without an `orderId` the
 * customer picks an order; with one, the order's lines are shown for selection.
 *
 * Feature 155 (FR-018, FR-020, FR-021): the kind is chosen first and carried in the address
 * (`?kind=complaint`), because what a line allows depends on it and the page works without
 * JavaScript — one decision per step (Hick's Law). In a return a non-returnable line is shown
 * with its reason and cannot be selected; in a complaint every line can. An order with no
 * returnable line (`no_returnable_lines`) no longer gets a dead end: it gets the complaint form,
 * with a sentence saying why a return is not offered (Peak-End Rule).
 */
export default async function NewReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; kind?: string; origin?: string; error?: string }>;
}): Promise<ReactNode> {
  const [params, { locale, ctx }] = await Promise.all([searchParams, getServerContext()]);
  const { orderId, kind: kindParam } = params;
  const session = await getSessionCookie();
  // D-14 — back to the very page asked for, query included (a CMS link to the no-order form).
  if (!session) return await localeRedirect(`/login?next=${encodeURIComponent(currentPath(params))}`);
  const t = tForLocale(locale);

  // Feature 170 (FR-052, FR-057): without `returns.create` the whole page would end in a refusal,
  // so it says why instead — before any order is read, as the server's gate is judged. A session
  // that cannot be read keeps today's page; `POST /api/v1/returns` is the boundary.
  const me = await getMe(session).catch(() => null);
  if (!mayStartReturn(memberSession(me))) {
    return (
      <div className="b2b-auth b2b-stacked max-w-[720px]">
        <h1>{t('returns.new.heading')}</h1>
        <p role="note" className="rounded-md border border-line bg-surface-alt px-[14px] py-[10px] text-[13px] text-fg-soft">
          {t('account.returns.new.notAllowed')}
        </p>
        <p>
          <LocalizedLink href="/returns" className="b2b-account__link b2b-account__link--standalone">{t('returns.new.backToReturns')}</LocalizedLink>
        </p>
      </div>
    );
  }

  // 180 §C1 — the toggles, the clauses, the limits. Unreadable: the form as before.
  const config = await formConfig(session, orderId ? { kind: parseReturnKind(kindParam), orderId } : {});
  const attempt = await readAttempt();
  // The codes travel in the attempt cookie; the address says only that there was a refusal
  // (`refused`, read as the generic failure without the cookie) or `too_large` (D-9).
  const errors = attempt && attempt.errors.length > 0 ? attempt.errors : params.error ? [params.error] : [];
  const elsewhere = config?.offPlatformComplaintsEnabled === true;

  // 180 US5 — the complaint without an order; while switched off the address falls back to step 1.
  if (params.origin === 'elsewhere' && elsewhere && !orderId) {
    const [elsewhereConfig, reasons, addresses] = await Promise.all([
      formConfig(session, { kind: 'complaint' }),
      listReturnReasons(session).catch((): ReturnReason[] => []),
      listAddresses(session, 'delivery').catch((): AddressSummary[] => []),
    ]);
    return (
      <OffPlatformForm
        t={t}
        locale={locale}
        config={elsewhereConfig ?? config}
        reasons={reasons.filter((r) => r.appliesTo === 'both' || r.appliesTo === 'complaint')}
        me={me}
        address={addresses.find((a) => a.isDefault) ?? addresses[0] ?? null}
        attempt={attempt}
        errors={errors}
        search={{ apiBaseUrl: browserApiBaseUrl(), salesChannelCode: ctx.salesChannelCode }}
      />
    );
  }

  // Step 1 — choose an order.
  if (!orderId) {
    const orders = await listMyOrders(session);
    return (
      <div className="b2b-auth b2b-stacked max-w-[720px]">
        <h1>{t('returns.new.heading')}</h1>
        <ErrorSummary t={t} locale={locale} errors={errors} />
        {elsewhere && orders.length > 0 ? (
          // 180 R-1 — above the list: a long list hides what comes after it (Serial Position).
          <p className="b2b-auth__notice">
            {t('returns.elsewhere.entry')}{' '}
            <LocalizedLink href="/returns/new?origin=elsewhere" className="b2b-account__link">{t('returns.elsewhere.entryLink')} →</LocalizedLink>
          </p>
        ) : null}
        <p>{t('returns.new.chooseOrder')}</p>
        {orders.length === 0 ? (
          elsewhere ? (
            <>
              <p>{t('returns.elsewhere.noOrders')}</p>
              <p>
                <LocalizedLink href="/returns/new?origin=elsewhere" className="btn btn--outline">
                  {t('returns.elsewhere.noOrdersAction')}
                </LocalizedLink>
              </p>
            </>
          ) : (
            <p>{t('returns.new.noOrders')}</p>
          )
        ) : (
          <ul>
            {orders.map((o) => (
              <li key={o.id}>
                <LocalizedLink href={`/returns/new?orderId=${encodeURIComponent(o.id)}`} className="b2b-account__link b2b-account__link--standalone">
                  {o.businessId} — {new Date(o.placedAt).toLocaleDateString(locale)}
                </LocalizedLink>
              </li>
            ))}
          </ul>
        )}
        <p>
          <LocalizedLink href="/returns" className="b2b-account__link b2b-account__link--standalone">{t('returns.new.backToReturns')}</LocalizedLink>
        </p>
      </div>
    );
  }

  // Step 2 — pick lines + reasons.
  const [returnable, allReasons] = await Promise.all([
    getReturnable(session, orderId),
    listReturnReasons(session),
  ]);
  const model = returnFormModel(returnable, locale, parseReturnKind(kindParam));

  if (model.kind === null) {
    return (
      <div className="b2b-auth b2b-stacked max-w-[720px]">
        <h1>{t('returns.new.heading')}</h1>
        <p>{model.notice}</p>
        <p>
          <LocalizedLink href="/returns/new" className="b2b-account__link b2b-account__link--standalone">{t('returns.new.chooseAnotherOrder')}</LocalizedLink>
        </p>
      </div>
    );
  }

  const kind: ReturnKind = model.kind;
  // Only the reasons that apply to this kind: a return reason offered on a complaint is a
  // choice the buyer has to evaluate and the server would not want (Hick's Law).
  const reasons = allReasons.filter((r) => r.appliesTo === 'both' || r.appliesTo === kind);

  return (
    <div className="b2b-auth b2b-stacked max-w-[720px]">
      <h1>{t('returns.new.heading')}</h1>
      {model.mode === 'return_and_complaint' ? (
        <nav aria-label={t('returns.new.kind.legend')} className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted" aria-hidden="true">
            {t('returns.new.kind.legend')}
          </span>
          {(['return', 'complaint'] as const).map((k) => (
            <LocalizedLink
              key={k}
              href={returnFormHref(orderId, k)}
              {...(k === kind ? { 'aria-current': 'page' as const } : {})}
              className={
                k === kind
                  ? 'btn btn--outline btn--sm border-fg font-semibold text-fg'
                  : 'btn btn--ghost btn--sm'
              }
            >
              {t(k === 'return' ? 'returns.new.kind.return' : 'returns.new.kind.complaint')}
            </LocalizedLink>
          ))}
        </nav>
      ) : null}
      {model.notice ? (
        <p role="note" className="rounded-md border border-line bg-surface-alt px-[14px] py-[10px] text-[13px] text-fg-soft">
          {model.notice}
        </p>
      ) : null}
      {kind === 'return' && returnable.freeReturnEligible ? (
        <p className="muted">{t('returns.new.freeReturnWindow')}</p>
      ) : null}
      <ErrorSummary t={t} locale={locale} errors={errors} />
      {/* `noValidate`: the quantity inputs' native `min`/`max` bubble speaks the browser's
          language and refuses the whole form. The handler brings each quantity to at least 1;
          the API bounds it by what is left (U4). 180 research R-13: the form posts to a route
          handler, so it can carry files without JavaScript, and a post with no line is a
          refusal with an error (D-15). */}
      <form method="post" action="/returns/submit" encType="multipart/form-data" noValidate className="b2b-auth__form">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="submissionKey" value={randomUUID()} />
        <ReturnFormLines lines={model.lines} reasons={reasons} locale={locale} />

        <div className="b2b-auth__field">
          <label htmlFor="comment">{t('returns.new.comment')}</label>
          <textarea id="comment" name="comment" maxLength={2000} defaultValue={attempt?.answers['comment'] ?? ''} />
        </div>

        <AttachmentField
          type="photo"
          locale={locale}
          id="files-photo"
          label={t('returns.elsewhere.photos')}
          limits={config?.attachmentLimits ?? RETURN_FORM_LIMITS}
          kept={keptOf(attempt, 'photo')}
        />
        {config && config.clauses.length > 0 ? (
          <fieldset>
            <legend>{t('returns.clauses.legend')}</legend>
            <ClauseList clauses={config.clauses} t={t} />
          </fieldset>
        ) : null}

        <div className="b2b-stacked__actions">
          <button type="submit" className="btn btn--primary btn--lg">
            {t(kind === 'return' ? 'returns.new.submit.return' : 'returns.new.submit.complaint')}
          </button>
        </div>
      </form>
      <p>
        <LocalizedLink href="/returns/new" className="b2b-account__link b2b-account__link--standalone">{t('returns.new.chooseAnotherOrder')}</LocalizedLink>
      </p>
    </div>
  );
}

/**
 * The browser's backend origin for the catalogue search, or `null` where it is not configured:
 * the product field then stays a plain model-name field, as without JavaScript.
 */
function browserApiBaseUrl(): string | null {
  try {
    return publicApiBaseUrl();
  } catch {
    return null;
  }
}

/** The page asked for, path and query (D-14). */
function currentPath(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (typeof value === 'string' && key !== 'error') query.set(key, value);
  const qs = query.toString();
  return qs ? `/returns/new?${qs}` : '/returns/new';
}

async function formConfig(
  session: string,
  query: { kind?: 'return' | 'complaint'; orderId?: string },
): Promise<ReturnFormConfig | null> {
  try {
    return await getReturnFormConfig(session, query);
  } catch {
    return null;
  }
}

async function readAttempt(): Promise<ReturnsAttempt | null> {
  try {
    return decodeReturnsAttempt((await cookies()).get(RETURNS_ATTEMPT_COOKIE)?.value);
  } catch {
    return null;
  }
}

/** The case-level files a refused attempt kept, of one type (a line's photos are `keptByLine`'s). */
function keptOf(attempt: ReturnsAttempt | null, type: string): Array<{ uploadId: string; filename: string }> {
  return (attempt?.uploads ?? [])
    .filter((u) => u.type === type && u.line === undefined)
    .map((u) => ({ uploadId: u.uploadId, filename: u.filename }));
}

/** Each line slot's photos a refused attempt kept. */
function keptByLine(attempt: ReturnsAttempt | null): Record<number, Array<{ uploadId: string; filename: string }>> {
  const out: Record<number, Array<{ uploadId: string; filename: string }>> = {};
  for (const u of attempt?.uploads ?? []) {
    if (u.line === undefined) continue;
    (out[u.line] ??= []).push({ uploadId: u.uploadId, filename: u.filename });
  }
  return out;
}

/**
 * The refusals of the last attempt, at the top of the form (design review R-2.6): a title,
 * one entry per refusal, focusable for the announcement. A code the page does not know reads
 * as the generic failure, never as the raw value.
 */
function ErrorSummary({ t, locale, errors }: { t: (key: MessageKey) => string; locale: string; errors: readonly string[] }): ReactNode {
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

function errorText(t: (key: MessageKey) => string, code: string): string {
  const sentence = codeLabel(t, 'returns.errors', code);
  return sentence === code ? t('returns.errors.generic') : sentence;
}

type Me = Awaited<ReturnType<typeof getMe>> | null;

/**
 * The complaint about a product bought elsewhere (`specs/180-off-platform-complaints/` US5;
 * design review R-2): one page of numbered sections that works without JavaScript, posting
 * multipart to the route handler. Contact and address come prefilled from the account and its
 * delivery address, and changing them here changes neither (FR-B16).
 */
function OffPlatformForm({
  t,
  locale,
  config,
  reasons,
  me,
  address,
  attempt,
  errors,
  search,
}: {
  t: (key: MessageKey) => string;
  locale: string;
  /** The catalogue search behind each line's product field (`ProductField`). */
  search: { apiBaseUrl: string | null; salesChannelCode: string | undefined };
  config: ReturnFormConfig | null;
  reasons: readonly ReturnReason[];
  me: Me;
  address: AddressSummary | null;
  attempt: ReturnsAttempt | null;
  errors: readonly string[];
}): ReactNode {
  const answers = attempt?.answers ?? {};
  const limits = config?.attachmentLimits ?? RETURN_FORM_LIMITS;
  const clauses = config?.clauses ?? [];
  const value = (name: string, fallback: string): string => answers[name] ?? fallback;
  const label = (r: ReturnReason): string =>
    r.label[locale] ?? r.label[locale.split('-')[0]!] ?? r.label['en'] ?? Object.values(r.label)[0] ?? r.id;
  const account = me?.customerAccount;
  const fullName = account ? `${account.firstName ?? ''} ${account.lastName ?? ''}`.trim() : '';
  const company = me?.organization && !me.organization.isPersonal ? me.organization.name : '';
  let n = 0;
  const next = (): number => (n += 1);
  return (
    <div className="b2b-auth b2b-stacked max-w-[720px]">
      <p className="text-[13px]">
        <LocalizedLink href="/returns/new" className="b2b-account__link b2b-account__link--standalone">{t('returns.elsewhere.backToOrders')}</LocalizedLink>
      </p>
      <h1>{t('returns.elsewhere.heading')}</h1>
      <p>{t('returns.elsewhere.intro')}</p>
      <ErrorSummary t={t} locale={locale} errors={errors} />
      <form method="post" action="/returns/submit" encType="multipart/form-data" noValidate className="b2b-auth__form">
        <input type="hidden" name="origin" value="elsewhere" />
        <input type="hidden" name="submissionKey" value={randomUUID()} />

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
          />
        </fieldset>

        <fieldset>
          <legend>{format(t('returns.elsewhere.section.contact'), { n: String(next()) })}</legend>
          <p className="text-[13px] text-muted">{t('returns.elsewhere.changesStayHere')}</p>
          <details className="b2b-stacked__contact" open={errors.includes('contact') || errors.includes('returnAddress') || !fullName}>
            <summary>
              <span className="min-w-0 truncate">
                {value('contact.name', fullName)} · {value('contact.email', account?.email ?? '')}
              </span>
              <span className="shrink-0 text-[13px] font-medium text-accent">{t('returns.elsewhere.editContact')}</span>
            </summary>
            <div className="b2b-auth__field">
              <label htmlFor="contact-name">{t('returns.elsewhere.contactName')}</label>
              <input id="contact-name" name="contact.name" required maxLength={200} autoComplete="name" defaultValue={value('contact.name', fullName)} />
            </div>
            <div className="b2b-auth__row">
              <div className="b2b-auth__field">
                <label htmlFor="contact-email">{t('returns.elsewhere.contactEmail')}</label>
                <input id="contact-email" name="contact.email" type="email" required maxLength={254} autoComplete="email" defaultValue={value('contact.email', account?.email ?? '')} />
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="contact-phone">{t('returns.elsewhere.contactPhone')}</label>
                <input id="contact-phone" name="contact.phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={value('contact.phone', address?.phone ?? '')} />
              </div>
            </div>
            <div className="b2b-auth__field">
              <label htmlFor="ret-addr-name">{t('returns.elsewhere.recipient')}</label>
              <input id="ret-addr-name" name="returnAddress.name" required maxLength={200} autoComplete="name" defaultValue={value('returnAddress.name', address?.recipientName ?? fullName)} />
            </div>
            <AddressFields
              t={t}
              idPrefix="ret-addr"
              namePrefix="returnAddress."
              company
              phone={false}
              defaults={{
                company: value('returnAddress.company', company),
                street: value('returnAddress.street', address?.street ?? ''),
                city: value('returnAddress.city', address?.city ?? ''),
                postalCode: value('returnAddress.postalCode', address?.postalCode ?? ''),
                country: value('returnAddress.country', address?.country ?? 'PL'),
              }}
              {...(errors.includes('returnAddress') ? { errors: { street: t('returns.errors.returnAddress') } } : {})}
            />
          </details>
        </fieldset>

        <fieldset>
          <legend>{format(t('returns.elsewhere.section.documents'), { n: String(next()) })}</legend>
          <AttachmentField type="other" locale={locale} id="files-other" label={t('returns.elsewhere.otherFiles')} limits={limits} kept={keptOf(attempt, 'other')} />
        </fieldset>

        {clauses.length > 0 ? (
          <fieldset>
            <legend>{format(t('returns.elsewhere.section.terms'), { n: String(next()) })}</legend>
            {errors.includes('clauses_changed') ? <p className="b2b-auth__notice">{t('returns.errors.clauses_changed')}</p> : null}
            <ClauseList clauses={clauses} t={t} />
          </fieldset>
        ) : null}

        <div className="b2b-stacked__actions">
          <button type="submit" className="btn btn--primary btn--lg">
            {t('returns.elsewhere.submit')}
          </button>
          <LocalizedLink href="/returns" className="btn btn--ghost">
            {t('returns.elsewhere.cancel')}
          </LocalizedLink>
        </div>
      </form>
    </div>
  );
}
