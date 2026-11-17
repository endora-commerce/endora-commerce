import type { ReactNode } from 'react';
import { revalidatePath } from 'next/cache';
import { addReturnComment, getMyReturn, getReturnFormConfig } from '../../../../lib/api/returns';
import { RETURN_ATTACHMENT_TYPES, RETURN_FORM_LIMITS, acceptAttribute, formatBytes } from '../../../../lib/returns/attachments';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';
import { isRecordId } from '../../../../lib/record-id';
import type { Metadata } from 'next';
import { localeRedirect, localizedPath } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { codeLabel, richText } from '../../../../lib/account/labels';
import { getMe } from '../../../../lib/api/account';
import { filedByColleague } from '../../../../lib/returns/returnForm';
import { FilePicker } from '../../../../components/returns/FilePicker';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Return / RMA case detail + conversation (feature 046, US1/US4).
 *
 * Feature 170 (FR-053, Q-R2 = A): a holder of `returns.view_organization` also
 * opens a colleague's case. It is read-only — the follow-up actions stay the
 * filer's and the API answers them `404` to anyone else — so the page offers
 * none of them and says why in one line, and the filer's messages are not
 * credited to the reader.
 */
export default async function ReturnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ submitted?: string; attachment?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  const query = (await searchParams) ?? {};
  if (!session) return await localeRedirect(`/login?next=/returns/${id}`);
  // Issue #749 — an id that cannot name a case goes where an unknown one does, unasked.
  if (!isRecordId(id)) return await localeRedirect('/returns');

  let detail;
  let me;
  try {
    [detail, me] = await Promise.all([getMyReturn(session, id), getMe(session).catch(() => null)]);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return await localeRedirect('/returns');
    throw err;
  }

  async function addComment(formData: FormData): Promise<void> {
    'use server';
    const s = await getSessionCookie();
    if (!s) return await localeRedirect(`/login?next=/returns/${id}`);
    const body = String(formData.get('body') ?? '').trim();
    if (body) {
      await addReturnComment(s, id, body);
      revalidatePath(`/returns/${id}`);
    }
  }

  const isTerminal = ['rejected', 'closed', 'cancelled'].includes(detail.statusCode);
  const isColleaguesCase = filedByColleague(detail.customerAccountId, me?.customerAccount.id);
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  const charges = detail.chargeRefunds;
  const offPlatform = detail.offPlatform === true;
  const attachments = detail.attachments ?? [];
  const clauses = detail.acceptedClauses ?? [];
  const mayAdd = !isTerminal && !isColleaguesCase;
  // 180 FR-B37, D-11 — the confirmation promised only while the e-mail is on; no processing time.
  const config = query.submitted === '1' ? await getReturnFormConfig(session, {}).catch(() => null) : null;
  const kindWord = t(`returns.case.kind.${detail.kind}`);
  const showAttachments = offPlatform || attachments.length > 0;
  // The route handlers behind the download links, the previews and the add form, in the shop's language path.
  const caseBase = showAttachments ? await localizedPath(`/returns/${detail.id}`) : '';
  // 180 — a defect photo belongs to its line; the rest belong to the whole case.
  const lineFiles = (itemId: string): typeof attachments => attachments.filter((a) => a.returnCaseItemId === itemId);
  const caseFiles = attachments.filter((a) => !a.returnCaseItemId || !detail.items.some((it) => it.id === a.returnCaseItemId));
  const title = detail.rmaNumber
    ? detail.rmaNumber
    : detail.reference
      ? format(t(`returns.case.title.${detail.kind}`), { reference: detail.reference })
      : t('account.return.fallbackTitle');
  const fileLink = (a: (typeof attachments)[number]): ReactNode => (
    <a href={`${caseBase}/attachments/${a.id}`} download={a.filename} className="b2b-stacked__file">
      {a.mimeType.startsWith('image/') ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private file behind the case's guarded route
        <img src={`${caseBase}/attachments/${a.id}`} alt="" loading="lazy" />
      ) : (
        <span className="b2b-stacked__file-icon" aria-hidden="true">
          {t('returns.attachments.documentIcon')}
        </span>
      )}
      <span className="b2b-stacked__file-name">{a.filename}</span>
      <span className="b2b-stacked__file-meta">
        {codeLabel(t, 'returns.attachments.type', a.type)} · {formatBytes(a.sizeBytes, locale)}
      </span>
    </a>
  );

  return (
    <div className="b2b-auth b2b-stacked max-w-[720px]">
      <p className="text-[13px]">
        <LocalizedLink href="/returns" className="b2b-account__link b2b-account__link--standalone">{t('returns.new.backToReturns')}</LocalizedLink>
      </p>
      {query.submitted === '1' ? (
        // The end of the submission (Peak-End): what happened, where the e-mail went, where next.
        <div role="status" className="b2b-auth__success mb-4">
          <p className="m-0 font-semibold text-ok">
            {format(t('returns.case.received'), { kind: kindWord, reference: detail.reference ?? detail.rmaNumber ?? '' })}
          </p>
          {config?.confirmationEmailEnabled && (detail.contact?.email ?? me?.customerAccount.email) ? (
            <p className="m-0 mt-1 text-ok">{format(t('returns.case.confirmationOnItsWay'), { email: detail.contact?.email ?? me?.customerAccount.email ?? '' })}</p>
          ) : null}
        </div>
      ) : null}
      <h1 className="mb-2">{title}</h1>
      <p className="b2b-stacked__meta">
        <span className="b2b-stacked__status">
          {richText(t('account.return.status'), { status: <strong>{detail.statusLabel}</strong> })}
        </span>
        <span>{codeLabel(t, 'returns.new.kind', detail.kind)}</span>
        {offPlatform ? <span className="b2b-badge">{t('returns.boughtElsewhere')}</span> : null}
      </p>
      {detail.rejectionReason ? (
        <p className="b2b-auth__notice">{format(t('account.return.rejectionReason'), { reason: detail.rejectionReason })}</p>
      ) : null}

      <section className="b2b-stacked__card">
      <h2>{t('account.common.items')}</h2>
      {offPlatform ? (
        // 180 R-3 — no order, no money: each line as typed, without a refund column, with its photos.
        <ul className="b2b-stacked__items">
          {detail.items.map((it) => (
            <li key={it.id}>
              <p className="b2b-stacked__item-name">
                <strong>{it.productName}</strong> <span className="text-muted">× {it.quantity}</span>
                {it.productId == null ? <span className="b2b-stacked__item-note">{t('returns.case.modelAsTyped')}</span> : null}
              </p>
              <dl className="b2b-stacked__dl">
                {it.serialNumber ? (
                  <>
                    <dt>{t('returns.case.serial')}</dt>
                    <dd>{it.serialNumber}</dd>
                  </>
                ) : null}
                {it.description ? (
                  <>
                    <dt>{t('returns.case.description')}</dt>
                    <dd>{it.description}</dd>
                  </>
                ) : null}
              </dl>
              {lineFiles(it.id).length > 0 ? (
                <ul className="b2b-stacked__files" aria-label={t('returns.elsewhere.photos')}>
                  {lineFiles(it.id).map((a) => (
                    <li key={a.id}>{fileLink(a)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.common.product')}</th>
            <th>{t('account.common.quantity')}</th>
            <th className="text-right">{t('account.returns.col.refund')}</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it) => (
            <tr key={it.id}>
              <td>{it.productName}</td>
              <td>{it.quantity}</td>
              <td className="text-right">{it.approvedRefundAmount.toFixed(2)}</td>
            </tr>
          ))}
          {/* Issue #876 — what a withdrawal from the whole order refunds beside the goods. */}
          {charges && charges.delivery > 0 ? (
            <tr>
              <td colSpan={2}>{t('account.return.deliveryRefund')}</td>
              <td className="text-right">{charges.delivery.toFixed(2)}</td>
            </tr>
          ) : null}
          {charges && charges.surcharge > 0 ? (
            <tr>
              <td colSpan={2}>{t('account.return.surchargeRefund')}</td>
              <td className="text-right">{charges.surcharge.toFixed(2)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      )}
      </section>

      {detail.purchase || detail.contact || detail.returnAddress ? (
        <div className="b2b-stacked__pair">
          {detail.purchase ? (
            <section className="b2b-stacked__card">
              <h2>{t('returns.case.purchase')}</h2>
              <dl className="b2b-stacked__dl">
                <dt>{t('returns.case.purchaseDate')}</dt>
                <dd>{detail.purchase.date ? new Date(`${detail.purchase.date}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' }) : t('returns.case.notGiven')}</dd>
                <dt>{t('returns.case.purchaseNumber')}</dt>
                <dd>{detail.purchase.proofNumber ?? t('returns.case.notGiven')}</dd>
              </dl>
            </section>
          ) : null}
          {detail.contact || detail.returnAddress ? (
            <section className="b2b-stacked__card">
              <h2>{t('returns.case.contactAndAddress')}</h2>
              <p className="text-[13px] text-muted">{t('returns.case.asGiven')}</p>
              {detail.contact ? (
                <p className="m-0 text-fg">
                  {detail.contact.name}
                  <br />
                  {detail.contact.email}
                  {detail.contact.phone ? <><br />{detail.contact.phone}</> : null}
                </p>
              ) : null}
              {detail.returnAddress ? (
                <address className="not-italic text-fg">
                  {detail.returnAddress.name}
                  {detail.returnAddress.company ? <><br />{detail.returnAddress.company}</> : null}
                  <br />
                  {detail.returnAddress.street}
                  <br />
                  {detail.returnAddress.postalCode} {detail.returnAddress.city}, {detail.returnAddress.countryCode}
                </address>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {showAttachments ? (
        <section className="b2b-stacked__card">
          <h2>{t('returns.attachments.heading')}</h2>
          {query.attachment ? (
            <p role="status" className={query.attachment === 'added' ? 'b2b-auth__success' : 'b2b-auth__notice'}>
              {t(
                query.attachment === 'added'
                  ? 'returns.attachments.added'
                  : query.attachment === 'too_many'
                    ? 'returns.attachments.full'
                    : 'returns.attachments.caseRefused',
              )}
            </p>
          ) : null}
          {caseFiles.length === 0 ? (
            <p className="text-[13px] text-muted">{t('returns.attachments.none')}</p>
          ) : (
            <ul className="b2b-stacked__files">
              {caseFiles.map((a) => (
                <li key={a.id}>{fileLink(a)}</li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-muted">
            {format(t('returns.attachments.caseBudget'), { count: String(attachments.length), max: String(RETURN_FORM_LIMITS.maxFilesPerCase) })}
          </p>
          {mayAdd && attachments.length < RETURN_FORM_LIMITS.maxFilesPerCase ? (
            <form method="post" action={`${caseBase}/attachments`} encType="multipart/form-data" className="b2b-stacked__add-file">
              <h3>{t('returns.attachments.add')}</h3>
              <div className="b2b-auth__row">
                {offPlatform && detail.items.length > 0 ? (
                  <div className="b2b-auth__field">
                    <label htmlFor="attachment-item">{t('returns.attachments.concerns')}</label>
                    <select id="attachment-item" name="item" defaultValue="">
                      <option value="">{t('returns.attachments.wholeCase')}</option>
                      {detail.items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.productName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="b2b-auth__field">
                  <label htmlFor="attachment-type">{t('returns.attachments.type')}</label>
                  <select id="attachment-type" name="type" defaultValue="photo">
                    {RETURN_ATTACHMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {codeLabel(t, 'returns.attachments.type', type)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="b2b-auth__field">
                <label htmlFor="attachment-file">{t('returns.attachments.file')}</label>
                <FilePicker
                  id="attachment-file"
                  name="file"
                  required
                  accept={acceptAttribute()}
                  describedBy="attachment-hint"
                  chooseLabel={t('returns.attachments.chooseOne')}
                  noneLabel={t('returns.attachments.noFile')}
                />
                <p id="attachment-hint" className="text-[12px] text-muted">{t('returns.attachments.hint')}</p>
              </div>
              <div>
                <button type="submit" className="btn btn--outline">{t('returns.attachments.upload')}</button>
              </div>
            </form>
          ) : mayAdd ? (
            <p className="text-[13px] text-muted">{t('returns.attachments.full')}</p>
          ) : null}
        </section>
      ) : null}

      {clauses.length > 0 ? (
        <section className="b2b-stacked__card">
          <h2>{t('returns.clauses.heading')}</h2>
          {clauses.map((c) => (
            <details key={`${c.clauseId}:${c.revision}`} className="b2b-stacked__clause">
              <summary>
                {c.label}
                {detail.clausesAcceptedAt && c.mode === 'must_accept'
                  ? ` · ${new Date(detail.clausesAcceptedAt).toLocaleDateString(locale)}`
                  : ''}
              </summary>
              <p className="whitespace-pre-line text-[13px] text-fg-soft">{c.text}</p>
              {c.linkUrl ? (
                <p className="text-[13px]">
                  <a href={c.linkUrl} target="_blank" rel="noopener noreferrer" className="b2b-account__link">
                    {t('returns.clauses.fullTerms')}
                  </a>
                </p>
              ) : null}
            </details>
          ))}
        </section>
      ) : null}

      <section className="b2b-stacked__card">
        <h2>{t('account.return.conversation')}</h2>
        {detail.comments.length === 0 ? (
          <p className="text-[13px] text-muted">{t('account.return.noMessages')}</p>
        ) : (
          <ul className="b2b-account__comments">
            {detail.comments.map((c) => (
              <li key={c.id}>
                <small>
                  {codeLabel(
                    t,
                    'account.returnAuthor',
                    isColleaguesCase && c.authorKind === 'customer' ? 'colleague' : c.authorKind,
                  )} · {new Date(c.createdAt).toLocaleString(locale)}
                </small>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {isTerminal ? (
          <p className="text-[13px] text-muted">{t('account.return.closed')}</p>
        ) : isColleaguesCase ? (
          <p role="note" className="text-[13px] text-muted">{t('account.return.colleagueReadOnly')}</p>
        ) : (
          <form action={addComment} className="b2b-stacked__add-file">
            <div className="b2b-auth__field">
              <label htmlFor="body">{t('account.return.addMessage')}</label>
              <textarea id="body" name="body" required maxLength={2000} />
            </div>
            <div>
              <button type="submit" className="btn btn--primary">{t('account.return.send')}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
