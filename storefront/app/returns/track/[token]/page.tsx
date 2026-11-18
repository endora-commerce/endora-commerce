import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { GuestCaseView } from '@endora-commerce/contracts';
import { getTrackedCase } from '../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../lib/api/client';
import { codeLabel, richText } from '../../../../lib/account/labels';
import { format } from '../../../../lib/i18n/format';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { localizedPath } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { RETURN_ATTACHMENT_TYPES, RETURN_FORM_LIMITS, acceptAttribute } from '../../../../lib/returns/attachments';
import { caseViewOfGuest } from '../../../../lib/returns/caseView';
import { getServerContext } from '../../../../lib/server-context';
import { CartSubmitButton } from '../../../../components/CartSubmitButton';
import { FilePicker } from '../../../../components/returns/FilePicker';
import { CaseConversation, CaseFiles, CaseItems, CasePurchaseContact } from '../../../../components/returns/CaseSections';

/** Not indexed (FR-011); `Referrer-Policy: no-referrer` and `X-Robots-Tag` come from `next.config.js` (F-5). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The comment results the handler names in the address (design review S-7). */
const COMMENT_RESULTS: Readonly<Record<string, MessageKey>> = {
  added: 'returns.guest.track.commentAdded',
  comments_per_case: 'returns.guest.track.commentLimit',
  rate_limited: 'returns.guest.errors.rate_limited',
  closed: 'returns.guest.track.closedMeanwhile',
  refused: 'returns.guest.track.commentRefused',
};
/** The file results, 180's sentences (design review S-7). */
const ATTACHMENT_RESULTS: Readonly<Record<string, MessageKey>> = {
  added: 'returns.attachments.added',
  too_many: 'returns.attachments.full',
  too_large: 'returns.attachments.caseRefused',
  invalid: 'returns.attachments.caseRefused',
  refused: 'returns.attachments.caseRefused',
  rate_limited: 'returns.guest.errors.rate_limited',
  closed: 'returns.guest.track.closedMeanwhile',
};

/**
 * The guest's tracking page, `/returns/track/[token]` (`specs/181-guest-complaints/` US2;
 * FR-040 – FR-043; owner ruling O-1; design review S-7, F-6, F-12, F-15).
 *
 * The token is the only access to the case: it is forwarded to the backend in a header,
 * never in the backend URL (research R-5), and this page loads no analytics (F-2), sends no
 * referrer and is not indexed (F-5). The case renders through the account case page's
 * sections (F-12). "Anyone with this link can see this complaint" is said on every visit
 * (FR-041). While open, the guest adds a message and files; once closed the page is
 * read-only and says until when it works (FR-042); a rejected complaint says why (O-1).
 *
 * Every invalid link — mistyped, guessed, expired, replaced, erased — is `notFound()` here,
 * so the segment's one neutral page renders (FR-043, SC-007); module-off is the layout's.
 */
export default async function TrackedComplaintPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ comment?: string; attachment?: string }>;
}): Promise<ReactNode> {
  const [{ token }, query, { locale, ctx }] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ comment?: string; attachment?: string }>({}),
    getServerContext(),
  ]);
  let rc: GuestCaseView;
  try {
    rc = await getTrackedCase(token, { ctx });
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 404) notFound();
    throw error;
  }
  const t = tForLocale(locale);
  const base = await localizedPath(`/returns/track/${token}`);
  const view = caseViewOfGuest(rc, base);
  const commentResult = query.comment ? COMMENT_RESULTS[query.comment] : undefined;
  const attachmentResult = query.attachment ? ATTACHMENT_RESULTS[query.attachment] : undefined;
  const author = (kind: string): string => t(kind === 'shop' ? 'returns.guest.track.authorShop' : 'returns.guest.track.authorYou');
  const open = !rc.isClosed;
  const room = view.fileCount < RETURN_FORM_LIMITS.maxFilesPerCase;

  return (
    <div className="b2b-auth b2b-stacked">
      <h1 className="mb-2">{rc.rmaNumber ?? format(t('returns.case.title.complaint'), { reference: rc.reference })}</h1>
      <p className="b2b-stacked__meta">
        <span className="b2b-stacked__status">{richText(t('account.return.status'), { status: <strong>{rc.status.label}</strong> })}</span>
        <span className="b2b-badge">{t('returns.boughtElsewhere')}</span>
      </p>
      <p role="note" className="b2b-auth__notice mb-3">
        {t('returns.guest.track.anyone')}
      </p>
      {rc.rejectionReason ? (
        <p className="b2b-auth__notice mb-3">{format(t('account.return.rejectionReason'), { reason: rc.rejectionReason })}</p>
      ) : null}
      {!open ? (
        <p className="b2b-auth__notice mb-3">
          {rc.linkValidUntil ? `${format(t('returns.guest.track.closed'), { date: new Date(rc.linkValidUntil).toLocaleDateString(locale) })} ` : ''}
          {t('returns.guest.track.closedTail')} {t('returns.guest.track.questions')}{' '}
          <LocalizedLink href="/kontakt" rel="noreferrer">
            {t('returns.guest.contact')}
          </LocalizedLink>
        </p>
      ) : null}

      <section className="b2b-stacked__card">
        <h2>{t('account.common.items')}</h2>
        <CaseItems view={view} t={t} locale={locale} />
      </section>

      <CasePurchaseContact view={view} t={t} locale={locale} />

      <section className="b2b-stacked__card">
        <h2 id="files" tabIndex={-1}>
          {t('returns.attachments.heading')}
        </h2>
        {attachmentResult ? (
          <p className={query.attachment === 'added' ? 'b2b-auth__success' : 'b2b-auth__notice'}>{t(attachmentResult)}</p>
        ) : null}
        <CaseFiles view={view} t={t} locale={locale} />
        <p className="text-[13px] text-muted">
          {format(t('returns.attachments.caseBudget'), { count: String(view.fileCount), max: String(RETURN_FORM_LIMITS.maxFilesPerCase) })}
        </p>
        {open && room ? (
          <form method="post" action={`${base}/attachments`} encType="multipart/form-data" className="b2b-stacked__add-file">
            <h3>{t('returns.attachments.add')}</h3>
            <div className="b2b-auth__row">
              {rc.lines.length > 0 ? (
                <div className="b2b-auth__field">
                  <label htmlFor="attachment-line">{t('returns.attachments.concerns')}</label>
                  <select id="attachment-line" name="lineIndex" defaultValue="">
                    <option value="">{t('returns.attachments.wholeCase')}</option>
                    {rc.lines.map((line, index) => (
                      <option key={index} value={String(index)}>
                        {line.productName}
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
              <p id="attachment-hint" className="text-[12px] text-muted">
                {t('returns.attachments.hint')}
              </p>
            </div>
            <div>
              <CartSubmitButton trackNativeSubmit className="btn btn--outline" label={t('returns.attachments.upload')} />
            </div>
          </form>
        ) : open ? (
          <p className="text-[13px] text-muted">{t('returns.attachments.full')}</p>
        ) : null}
      </section>

      <section className="b2b-stacked__card">
        <h2 id="conversation" tabIndex={-1}>
          {t('account.return.conversation')}
        </h2>
        {commentResult ? (
          <p className={query.comment === 'added' ? 'b2b-auth__success' : 'b2b-auth__notice'}>{t(commentResult)}</p>
        ) : null}
        <CaseConversation view={view} t={t} locale={locale} authorLabel={author} />
        {open ? (
          <form method="post" action={`${base}/comments`} className="b2b-stacked__add-file">
            <div className="b2b-auth__field">
              <label htmlFor="body">{t('account.return.addMessage')}</label>
              <textarea id="body" name="body" required maxLength={2000} />
            </div>
            <div>
              <CartSubmitButton
                trackNativeSubmit
                className="btn btn--primary"
                label={t('account.return.send')}
                pendingLabel={t('returns.guest.track.sending')}
              />
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
