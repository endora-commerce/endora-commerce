import type { ReactNode } from 'react';
import { revalidatePath } from 'next/cache';
import { addReturnComment, getMyReturn } from '../../../../lib/api/returns';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { codeLabel, richText } from '../../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Return / RMA case detail + conversation (feature 046, US1/US4).
 */
export default async function ReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) return await localeRedirect(`/login?next=/returns/${id}`);

  let detail;
  try {
    detail = await getMyReturn(session, id);
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
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <div className="b2b-auth max-w-[720px]">
      <p>
        <LocalizedLink href="/returns">{t('returns.new.backToReturns')}</LocalizedLink>
      </p>
      <h1>{detail.rmaNumber ?? t('account.return.fallbackTitle')}</h1>
      <p>
        {richText(t('account.return.status'), { status: <strong>{detail.statusLabel}</strong> })} ·{' '}
        {codeLabel(t, 'returns.new.kind', detail.kind)}
      </p>
      {detail.rejectionReason ? (
        <p className="muted">{format(t('account.return.rejectionReason'), { reason: detail.rejectionReason })}</p>
      ) : null}

      <h2>{t('account.common.items')}</h2>
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
        </tbody>
      </table>

      <h2>{t('account.return.conversation')}</h2>
      {detail.comments.length === 0 ? (
        <p>{t('account.return.noMessages')}</p>
      ) : (
        <ul className="b2b-account__comments">
          {detail.comments.map((c) => (
            <li key={c.id}>
              <span className="muted">
                {codeLabel(t, 'account.returnAuthor', c.authorKind)} · {new Date(c.createdAt).toLocaleString(locale)}
              </span>
              <div>{c.body}</div>
            </li>
          ))}
        </ul>
      )}

      {!isTerminal ? (
        <form action={addComment} className="b2b-auth__form">
          <label htmlFor="body">{t('account.return.addMessage')}</label>
          <textarea id="body" name="body" required maxLength={2000} />
          <button type="submit">{t('account.return.send')}</button>
        </form>
      ) : (
        <p className="muted">{t('account.return.closed')}</p>
      )}
    </div>
  );
}
