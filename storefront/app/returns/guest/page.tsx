import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getGuestAvailability } from '../../../lib/api/returns-guest';
import { sanitiseNext } from '../../../lib/auth/next-path';
import { tForLocale } from '../../../lib/i18n/messages';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { CUSTOMER_ELSEWHERE_PATH, RETURNS_GUEST_PENDING_COOKIE, decodeGuestPending } from '../../../lib/returns/guest';
import { getServerContext } from '../../../lib/server-context';
import { getSessionCookie } from '../../../lib/session';
import { GuestLinkRequestForm } from '../../../components/returns/GuestLinkRequestForm';
import { GuestDisabledNotice } from '../../../components/returns/GuestNotices';

/** Not indexed (FR-011): a transactional page, of no use to a crawler. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The guest complaint entry, `/returns/guest` (`specs/181-guest-complaints/` FR-010, FR-011;
 * design review S-1): the stable address an operator links to, and where a signed-out visit
 * to the returns area lands.
 *
 * One card, two regions, one decision (Hick): *Have an account with us?* — sign in, `next` =
 * the page asked for — then *Continue without an account* with the e-mail field inline
 * (Tesler). Sign-in first: a purchase from this shop belongs in the account (US1 scenario 1).
 *
 * - Signed in: straight on to where they were going.
 * - Guest complaints not in effect: today's sign-in redirect (FR-010), unless the visitor
 *   was refused mid-flow (`?error=disabled`), who is told why (FR-002).
 * - The address this browser asked with prefills the field (design review F-7, O-3).
 */
export default async function GuestEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string; reason?: string }>;
}): Promise<ReactNode> {
  const [params, { locale, ctx }] = await Promise.all([searchParams, getServerContext()]);
  const from = sanitiseNext(params.from, CUSTOMER_ELSEWHERE_PATH);
  if (await getSessionCookie()) return await localeRedirect(from);
  const enabled = await getGuestAvailability({ ctx });
  const disabled = params.error === 'disabled';
  if (!enabled && !disabled) return await localeRedirect(`/login?next=${encodeURIComponent(from)}`);
  const t = tForLocale(locale);
  const pending = decodeGuestPending((await cookies()).get(RETURNS_GUEST_PENDING_COOKIE)?.value);
  const signIn = `/login?next=${encodeURIComponent(from)}`;

  return (
    <div className="b2b-auth">
      <h1>{t('returns.guest.entry.heading')}</h1>
      {params.error === 'rate_limited' ? (
        <div className="b2b-auth__error" role="alert">
          {t('returns.guest.errors.rate_limited')}
        </div>
      ) : null}
      <section aria-labelledby="guest-entry-account" className="flex flex-col gap-3">
        <h2 id="guest-entry-account" className="m-0 text-[17px] font-semibold">
          {t('returns.guest.entry.signInHeading')}
        </h2>
        <p className="m-0">{t('returns.guest.entry.signInBody')}</p>
        <LocalizedLink href={signIn} className="btn btn--outline btn--block">
          {t('returns.guest.entry.signIn')}
        </LocalizedLink>
      </section>
      <p className="b2b-auth__social-divider my-5">{t('returns.guest.entry.or')}</p>
      <section aria-labelledby="guest-entry-guest" className="flex flex-col gap-3">
        <h2 id="guest-entry-guest" className="m-0 text-[17px] font-semibold">
          {t('returns.guest.entry.guestHeading')}
        </h2>
        {disabled ? (
          <GuestDisabledNotice t={t} />
        ) : (
          <>
            {params.reason === 'session_expired' ? (
              <p className="b2b-auth__notice" role="note">
                {t('returns.guest.entry.sessionExpired')}
              </p>
            ) : null}
            <p className="m-0">{t('returns.guest.entry.guestBody')}</p>
            <GuestLinkRequestForm
              t={t}
              email={pending?.email ?? ''}
              invalid={params.error === 'email'}
              from={from}
              origin="entry"
              submit="returns.guest.entry.send"
            />
          </>
        )}
      </section>
    </div>
  );
}
