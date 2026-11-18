import type { ReactNode } from 'react';
import { tForLocale } from '../../../../lib/i18n/messages';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../lib/server-context';

/**
 * The neutral page for a tracking link that opens nothing (`specs/181-guest-complaints/`
 * FR-043, SC-007; design review S-8, F-6): one page for every cause — mistyped, guessed,
 * expired, replaced or erased — that never says whether a case exists, and depends on
 * nothing of the token. HTTP `404`; `noindex` and `no-referrer` from `next.config.js`.
 *
 * No form: a guest cannot ask for a tracking link themselves, so the contact page is the
 * honest next step (Peak-End: an exit, not a dead end). While `returns` is off the layout
 * above answers first, with the site's generic page instead (F-6).
 */
export default async function TrackLinkNotFound(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth">
      <h1>{t('returns.guest.notFound.heading')}</h1>
      <p>{t('returns.guest.notFound.body')}</p>
      <p>
        {t('returns.guest.notFound.help')}{' '}
        <LocalizedLink href="/kontakt" rel="noreferrer">
          {t('returns.guest.contact')}
        </LocalizedLink>
      </p>
    </div>
  );
}
