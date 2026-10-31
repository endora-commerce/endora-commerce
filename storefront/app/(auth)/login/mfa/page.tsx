import type { ReactNode } from 'react';
import { verifyCustomerMfa } from '../../../../lib/api/auth';
import {
  clearMfaChallengeCookie,
  getMfaChallengeCookie,
  setSessionCookie,
} from '../../../../lib/session';
import { Hook } from '../../../../components/Hook';
import { MfaCodeForm } from '../../../../components/MfaCodeForm';
import { getServerContext } from '../../../../lib/server-context';
import {
  CHANNEL_NOT_PERMITTED_ERROR,
  signInErrorMessage,
  signInErrorParam,
} from '../../../../lib/auth/sign-in-errors';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { tForLocale } from '../../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront second-step screen (feature 042, US1). Reached only after the
 * password step returned `mfaRequired`; the opaque challenge id is read from
 * the httpOnly `b2b_mfa_challenge` cookie. On success the session cookie is
 * persisted and the user is sent to `next`.
 */
export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const nextPath = sanitiseNext(params.next);
  const challengeId = await getMfaChallengeCookie();
  if (!challengeId) {
    return await localeRedirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  const { locale } = await getServerContext();
  const error = signInErrorMessage(params.error, locale);

  return (
    <>
      <Hook code="login.top" />
      <MfaCodeForm action={verifyAction} next={nextPath} error={error} locale={locale} />
      <Hook code="login.bottom" />
    </>
  );
}

async function verifyAction(formData: FormData): Promise<void> {
  'use server';
  const code = ((formData.get('code') as string) ?? '').trim();
  const next = sanitiseNext((formData.get('next') as string) ?? '/account');
  const challengeId = await getMfaChallengeCookie();
  if (!challengeId) {
    return await localeRedirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const t = tForLocale((await getServerContext()).locale);

  let result;
  try {
    result = await verifyCustomerMfa({ challengeId, code });
  } catch (err) {
    const message = signInErrorParam(err, t('auth.mfa.verifyFailed'));
    if (message === CHANNEL_NOT_PERMITTED_ERROR) {
      // `specs/154-sales-channel-access/` — the account may not use this store.
      // Another code would not change that, so the challenge is dropped and the
      // buyer is shown the refusal on the sign-in page, as the password step does.
      await clearMfaChallengeCookie();
      return await localeRedirect(`/login?error=${message}&next=${encodeURIComponent(next)}`);
    }
    return await localeRedirect(`/login/mfa?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }
  if (!result.sessionCookieValue) {
    return await localeRedirect(
      `/login/mfa?error=${encodeURIComponent(t('auth.mfa.verifyFailed'))}&next=${encodeURIComponent(next)}`,
    );
  }
  await setSessionCookie(result.sessionCookieValue);
  await clearMfaChallengeCookie();
  return await localeRedirect(next);
}

function sanitiseNext(input: string | undefined): string {
  if (!input) return '/account';
  if (!input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}
