import type { ReactNode } from 'react';
import { codeLabel } from '../../lib/account/labels';
import type { MessageKey } from '../../lib/i18n/messages';
import { formatBytes } from '../../lib/returns/attachments';
import type { CaseView, CaseViewFile } from '../../lib/returns/caseView';

/**
 * The sections of a case page (`specs/181-guest-complaints/` design review F-12): the
 * signed-in customer's case page and the guest's tracking page show the same case the same
 * way (Similarity), from one `CaseView` (`lib/returns/caseView.ts`). Presentational Server
 * Components; the pages keep their own headers, notices and forms.
 */
type T = (key: MessageKey) => string;

/** One file as a download tile: an image preview where the view allows one, an icon otherwise. */
export function CaseFileLink({ file, t, locale }: { file: CaseViewFile; t: T; locale: string }): ReactNode {
  return (
    <a href={file.href} download={file.filename} rel="noreferrer" className="b2b-stacked__file">
      {file.preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private file behind the case's guarded route
        <img src={file.href} alt="" loading="lazy" />
      ) : (
        <span className="b2b-stacked__file-icon" aria-hidden="true">
          {t('returns.attachments.documentIcon')}
        </span>
      )}
      <span className="b2b-stacked__file-name">{file.filename}</span>
      <span className="b2b-stacked__file-meta">
        {codeLabel(t, 'returns.attachments.type', file.type)} · {formatBytes(file.sizeBytes, locale)}
      </span>
    </a>
  );
}

/** The products of a complaint without an order: each as given, with its own photos (180 R-3). */
export function CaseItems({ view, t, locale }: { view: CaseView; t: T; locale: string }): ReactNode {
  return (
    <ul className="b2b-stacked__items">
      {view.items.map((it) => (
        <li key={it.key}>
          <p className="b2b-stacked__item-name">
            <strong>{it.productName}</strong> <span className="text-muted">× {it.quantity}</span>
            {it.modelAsTyped ? <span className="b2b-stacked__item-note">{t('returns.case.modelAsTyped')}</span> : null}
          </p>
          <dl className="b2b-stacked__dl">
            {it.reasonLabel ? (
              <>
                <dt>{t('returns.case.reason')}</dt>
                <dd>{it.reasonLabel}</dd>
              </>
            ) : null}
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
          {it.files.length > 0 ? (
            <ul className="b2b-stacked__files" aria-label={t('returns.elsewhere.photos')}>
              {it.files.map((file) => (
                <li key={file.id}>
                  <CaseFileLink file={file} t={t} locale={locale} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** The purchase, and the contact and return address as given with the case (180 FR-B16). */
export function CasePurchaseContact({ view, t, locale }: { view: CaseView; t: T; locale: string }): ReactNode {
  const { purchase, contact, returnAddress } = view;
  if (!purchase && !contact && !returnAddress) return null;
  return (
    <div className="b2b-stacked__pair">
      {purchase ? (
        <section className="b2b-stacked__card">
          <h2>{t('returns.case.purchase')}</h2>
          <dl className="b2b-stacked__dl">
            <dt>{t('returns.case.purchaseDate')}</dt>
            <dd>{purchase.date ? new Date(`${purchase.date}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' }) : t('returns.case.notGiven')}</dd>
            <dt>{t('returns.case.purchaseNumber')}</dt>
            <dd>{purchase.proofNumber ?? t('returns.case.notGiven')}</dd>
          </dl>
        </section>
      ) : null}
      {contact || returnAddress ? (
        <section className="b2b-stacked__card">
          <h2>{t('returns.case.contactAndAddress')}</h2>
          <p className="text-[13px] text-muted">{t('returns.case.asGiven')}</p>
          {contact ? (
            <p className="m-0 text-fg">
              {contact.name}
              <br />
              {contact.email}
              {contact.phone ? (
                <>
                  <br />
                  {contact.phone}
                </>
              ) : null}
            </p>
          ) : null}
          {returnAddress ? (
            <address className="not-italic text-fg">
              {returnAddress.name}
              {returnAddress.company ? (
                <>
                  <br />
                  {returnAddress.company}
                </>
              ) : null}
              <br />
              {returnAddress.street}
              <br />
              {returnAddress.postalCode} {returnAddress.city}, {returnAddress.countryCode}
            </address>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/** The case's own files, or the line saying there are none. */
export function CaseFiles({ view, t, locale }: { view: CaseView; t: T; locale: string }): ReactNode {
  return view.caseFiles.length === 0 ? (
    <p className="text-[13px] text-muted">{t('returns.attachments.none')}</p>
  ) : (
    <ul className="b2b-stacked__files">
      {view.caseFiles.map((file) => (
        <li key={file.id}>
          <CaseFileLink file={file} t={t} locale={locale} />
        </li>
      ))}
    </ul>
  );
}

/** The customer-visible conversation; `authorLabel` names each author for the page's reader. */
export function CaseConversation({
  view,
  t,
  locale,
  authorLabel,
}: {
  view: CaseView;
  t: T;
  locale: string;
  authorLabel: (author: string) => string;
}): ReactNode {
  return view.comments.length === 0 ? (
    <p className="text-[13px] text-muted">{t('account.return.noMessages')}</p>
  ) : (
    <ul className="b2b-account__comments">
      {view.comments.map((c) => (
        <li key={c.id}>
          <small>
            {authorLabel(c.author)} · {new Date(c.createdAt).toLocaleString(locale)}
          </small>
          <p>{c.body}</p>
        </li>
      ))}
    </ul>
  );
}
