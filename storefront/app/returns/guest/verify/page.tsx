import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getGuestAvailability, getGuestFormConfig } from '../../../../lib/api/returns-guest';
import type { RequestContext } from '../../../../lib/api/client';
import { format } from '../../../../lib/i18n/format';
import { tForLocale } from '../../../../lib/i18n/messages';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { RETURNS_GUEST_PENDING_COOKIE, RETURNS_GUEST_SESSION_COOKIE, decodeGuestPending } from '../../../../lib/returns/guest';
import { getServerContext } from '../../../../lib/server-context';
import { CartSubmitButton } from '../../../../components/CartSubmitButton';
import { GuestLinkRequestForm } from '../../../../components/returns/GuestLinkRequestForm';
import { GuestDisabledNotice } from '../../../../components/returns/GuestNotices';

/** Not indexed (FR-011); `Referrer-Policy: no-referrer` comes from `next.config.js` (F-5). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The verification link's page, `/returns/guest/verify` (`specs/181-guest-complaints/`
 * research R-3 item 3; owner ruling O-2; design review S-3, S-4, F-3, F-5).
 *
 * - **With a token**, the GET shows one *Continue* button that POSTs it. It redeems nothing,
 *   never redirects and never submits itself — no effect, no refresh, no autofocus — so a
 *   mail scanner or a link preview, which fetch and may even run the page, cannot use the
 *   one-time link up. It renders the same for every token, valid or not.
 * - **`?state=invalid`** is where a refused redemption lands (a used, expired or replaced
 *   link, or the second POST of a double click). While this browser holds any live guest
 *   session it continues to the form, which shows the verified address (O-2). Otherwise it
 *   says *this link no longer works* and offers a new one on the spot, the address filled in
 *   only when this browser asked for the link (O-3) — the backend never says whose it was.
 */
export default async function GuestVerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; state?: string; error?: string }>;
}): Promise<ReactNode> {
  const [params, { locale, ctx }] = await Promise.all([searchParams, getServerContext()]);
  const t = tForLocale(locale);
  const token = typeof params.token === 'string' && params.token.length > 0 && params.token.length <= 512 ? params.token : null;

  if (token && params.state !== 'invalid') {
    return (
      <div className="b2b-auth">
        <h1>{t('returns.guest.verify.heading')}</h1>
        <p>{t('returns.guest.verify.body')}</p>
        {params.error === 'rate_limited' ? (
          <div className="b2b-auth__error" role="alert">
            {t('returns.guest.errors.rate_limited')}
          </div>
        ) : null}
        <form method="post" action="/returns/guest/verify/continue" className="b2b-auth__form">
          <input type="hidden" name="token" value={token} />
          <CartSubmitButton
            trackNativeSubmit
            className="btn btn--primary btn--block"
            label={t('returns.guest.verify.continue')}
            pendingLabel={t('returns.guest.verify.opening')}
          />
        </form>
      </div>
    );
  }

  const jar = await cookies();
  const session = jar.get(RETURNS_GUEST_SESSION_COOKIE)?.value;
  if (session && (await liveSession(session, ctx))) return await localeRedirect('/returns/guest/new');
  const pending = decodeGuestPending(jar.get(RETURNS_GUEST_PENDING_COOKIE)?.value);
  const enabled = await getGuestAvailability({ ctx });

  return (
    <div className="b2b-auth">
      <h1>{t('returns.guest.invalid.heading')}</h1>
      <p>{format(t('returns.guest.invalid.body'), { minutes: String(pending?.linkValidMinutes ?? 60) })}</p>
      {enabled ? (
        <GuestLinkRequestForm t={t} email={pending?.email ?? ''} origin="invalid" submit="returns.guest.invalid.send" />
      ) : (
        <GuestDisabledNotice t={t} />
      )}
    </div>
  );
}

/** Whether the guest session this browser holds is live (G5 answers it). */
async function liveSession(session: string, ctx: RequestContext): Promise<boolean> {
  try {
    await getGuestFormConfig(session, { ctx });
    return true;
  } catch {
    return false;
  }
}
