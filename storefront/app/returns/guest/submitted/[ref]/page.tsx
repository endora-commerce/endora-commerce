import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { richText } from '../../../../../lib/account/labels';
import { format } from '../../../../../lib/i18n/format';
import { tForLocale } from '../../../../../lib/i18n/messages';
import { localeRedirect, localizedPath } from '../../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../../lib/i18n/localized-link';
import { RETURNS_GUEST_FILED_COOKIE, decodeGuestFiled } from '../../../../../lib/returns/guest';
import { absoluteUrl } from '../../../../../lib/seo/site-url';
import { getServerContext } from '../../../../../lib/server-context';
import { getReturnsGuestSession } from '../../../../../lib/session';
import { CopyField } from '../../../../../components/returns/CopyField';

/** Not indexed (FR-011). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The end of a guest's filing, `/returns/guest/submitted/[ref]` (`specs/181-guest-complaints/`
 * US1 scenario 6; FR-036, FR-045; design review S-6, F-8, F-15).
 *
 * - **The confirmation is the `<h1>`**: text present at load is not reliably announced from
 *   a status region after a `303` (F-15). No processing time is promised (180 FR-B37); the
 *   confirmation sentence is unconditional, as the guest confirmation cannot be off (FR-045).
 * - **The tracking link** comes from the flash cookie the submit handler set, shown only when
 *   its reference is this page's — a guessed URL shows nothing, not even a false "received"
 *   (F-8). It is a read-only input — the way to take it without JavaScript — with *Copy link*
 *   as the one primary action (Peak-End), and *Open the complaint page* as a plain link, so
 *   the tracking page loads as a document without analytics (F-2) and sends no referrer.
 * - *File another complaint* while the guest session lives; *Done – end session* last.
 */
export default async function GuestSubmittedPage({ params }: { params: Promise<{ ref: string }> }): Promise<ReactNode> {
  const [{ ref }, { locale }] = await Promise.all([params, getServerContext()]);
  const filed = decodeGuestFiled((await cookies()).get(RETURNS_GUEST_FILED_COOKIE)?.value);
  let reference: string;
  try {
    reference = decodeURIComponent(ref);
  } catch {
    reference = ref;
  }
  if (!filed || filed.ref !== reference) return await localeRedirect('/returns/guest');
  const t = tForLocale(locale);
  const trackPath = await localizedPath(`/returns/track/${filed.trackingToken}`);
  const live = Boolean(await getReturnsGuestSession());

  return (
    <div className="b2b-auth b2b-stacked">
      <h1>{format(t('returns.guest.submitted.heading'), { reference: filed.ref })}</h1>
      <p>{richText(t('returns.guest.submitted.body'), { email: <strong>{filed.email}</strong> })}</p>
      <section className="b2b-stacked__card" aria-labelledby="guest-link-heading">
        <h2 id="guest-link-heading">{t('returns.guest.submitted.linkHeading')}</h2>
        <p>{t('returns.guest.submitted.keep')}</p>
        <p role="note" className="b2b-auth__notice">
          {t('returns.guest.submitted.anyone')}
        </p>
        <CopyField
          id="track-url"
          value={absoluteUrl(trackPath)}
          label={t('returns.guest.submitted.link')}
          copy={t('returns.guest.submitted.copy')}
          copied={t('returns.guest.submitted.copied')}
          failed={t('returns.guest.submitted.copyFailed')}
        />
        <p className="mt-3">
          <a href={trackPath} rel="noreferrer" className="btn btn--outline">
            {t('returns.guest.submitted.open')}
          </a>
        </p>
      </section>
      <div className="b2b-stacked__actions">
        {live ? <LocalizedLink href="/returns/guest/new">{t('returns.guest.submitted.another')}</LocalizedLink> : null}
        <form method="post" action="/returns/guest/leave">
          <button type="submit" className="btn btn--ghost">
            {t('returns.guest.submitted.done')}
          </button>
        </form>
      </div>
    </div>
  );
}
