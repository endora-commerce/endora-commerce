import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { richText } from '../../../../lib/account/labels';
import { tForLocale } from '../../../../lib/i18n/messages';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { GUEST_RESEND_AFTER_MS, RETURNS_GUEST_PENDING_COOKIE, decodeGuestPending } from '../../../../lib/returns/guest';
import { getServerContext } from '../../../../lib/server-context';
import { ResendButton } from '../../../../components/returns/ResendButton';

/** Not indexed (FR-011). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * *Check your inbox*, `/returns/guest/sent` (`specs/181-guest-complaints/` FR-021, US1
 * scenario 4, edge case *E-mail typo*; design review S-2, F-7).
 *
 * The page is the same for every address, so printing the one this browser typed reveals
 * nothing — and it is what catches a typo. *Send again* is outline: the next step happens
 * in the mailbox (Von Restorff). Without this browser's cookie (a direct visit, or expired)
 * the page names no address and offers only to enter one again.
 */
export default async function GuestSentPage({
  searchParams,
}: {
  searchParams: Promise<{ wait?: string; error?: string }>;
}): Promise<ReactNode> {
  const [params, { locale }] = await Promise.all([searchParams, getServerContext()]);
  const t = tForLocale(locale);
  const pending = decodeGuestPending((await cookies()).get(RETURNS_GUEST_PENDING_COOKIE)?.value);
  const sent = pending && pending.requestedAt > 0 ? pending : null;

  return (
    <div className="b2b-auth">
      <h1>{t('returns.guest.sent.heading')}</h1>
      {params.error === 'rate_limited' ? (
        <div className="b2b-auth__error" role="alert">
          {t('returns.guest.errors.rate_limited')}
        </div>
      ) : null}
      {sent ? (
        <p>
          {richText(t('returns.guest.sent.body'), {
            email: <strong>{sent.email}</strong>,
            minutes: String(sent.linkValidMinutes),
          })}
        </p>
      ) : (
        <p>{t('returns.guest.sent.bodyNoAddress')}</p>
      )}
      <p className="b2b-auth__hint">{t('returns.guest.sent.hint')}</p>
      {sent ? (
        <form method="post" action="/returns/guest/request" className="b2b-auth__form">
          <input type="hidden" name="origin" value="sent" />
          <input type="hidden" name="email" value={sent.email} />
          {params.wait === '1' ? (
            <p className="b2b-auth__notice" role="status">
              {t('returns.guest.sent.wait')}
            </p>
          ) : null}
          <ResendButton
            requestedAt={sent.requestedAt}
            waitMs={GUEST_RESEND_AFTER_MS}
            label={t('returns.guest.sent.again')}
            countdown={t('returns.guest.sent.countdown')}
            ready={t('returns.guest.sent.ready')}
          />
        </form>
      ) : null}
      <p className="b2b-auth__hint">
        <LocalizedLink href="/returns/guest">{t(sent ? 'returns.guest.sent.other' : 'returns.guest.sent.enterAgain')}</LocalizedLink>
      </p>
    </div>
  );
}
