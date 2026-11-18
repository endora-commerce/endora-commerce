import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { GuestFormConfig } from '@endora-commerce/contracts';
import { getGuestFormConfig } from '../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../lib/api/client';
import { publicApiBaseUrl } from '../../../../lib/env.mjs';
import { tForLocale } from '../../../../lib/i18n/messages';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { RETURNS_ATTEMPT_COOKIE, decodeReturnsAttempt } from '../../../../lib/returns/returnForm';
import { getServerContext } from '../../../../lib/server-context';
import { getReturnsGuestSession, getSessionCookie } from '../../../../lib/session';
import { OffPlatformForm } from '../../../../components/returns/OffPlatformForm';
import { GuestDisabledNotice } from '../../../../components/returns/GuestNotices';

/** Not indexed (FR-011). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The guest's complaint form, `/returns/guest/new` (`specs/181-guest-complaints/` US1
 * scenario 5; FR-030, FR-031; edge case *A signed-in customer opens a verification link*;
 * design review S-5).
 *
 * 180's no-order form in guest mode (`OffPlatformForm`): the verified address is locked
 * text, nothing is prefilled, and it posts — files too — through the guest handlers with the
 * guest session. The form's configuration (G5) is read with that session alone; a browser
 * that is also signed in is told the complaint will be a guest's, never attributed to the
 * account (FR-033).
 *
 * - No guest session, or one the backend no longer knows: back to the entry.
 * - Guest complaints switched off since the link: the disabled notice, nothing filed (FR-002).
 */
export default async function GuestComplaintFormPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const [params, { locale, ctx }] = await Promise.all([searchParams, getServerContext()]);
  const session = await getReturnsGuestSession();
  if (!session) return await localeRedirect('/returns/guest');
  const t = tForLocale(locale);

  let config: GuestFormConfig;
  try {
    config = await getGuestFormConfig(session, { ctx });
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 403) {
      return (
        <div className="b2b-auth">
          <h1>{t('returns.elsewhere.heading')}</h1>
          <GuestDisabledNotice t={t} />
        </div>
      );
    }
    if (error instanceof StorefrontApiError && error.status === 401) return await localeRedirect('/returns/guest');
    throw error;
  }

  const attempt = decodeReturnsAttempt((await cookies()).get(RETURNS_ATTEMPT_COOKIE)?.value);
  const errors = attempt && attempt.errors.length > 0 ? attempt.errors : params.error ? [params.error] : [];
  return (
    <OffPlatformForm
      mode="guest"
      action="/returns/guest/submit"
      uploadAction="/returns/guest/uploads"
      t={t}
      locale={locale}
      config={config}
      reasons={config.reasons.filter((r) => r.isActive && (r.appliesTo === 'both' || r.appliesTo === 'complaint'))}
      guest={{ email: config.verifiedEmail, signedIn: Boolean(await getSessionCookie()) }}
      attempt={attempt}
      errors={errors}
      search={{ apiBaseUrl: browserApiBaseUrl(), salesChannelCode: ctx.salesChannelCode }}
    />
  );
}

/** The browser's backend origin for the catalogue search, or `null` (a plain model-name field). */
function browserApiBaseUrl(): string | null {
  try {
    return publicApiBaseUrl();
  } catch {
    return null;
  }
}
