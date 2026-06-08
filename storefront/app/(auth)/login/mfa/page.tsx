import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { verifyCustomerMfa } from '../../../../lib/api/auth';
import { StorefrontApiError } from '../../../../lib/api/client';
import {
  clearMfaChallengeCookie,
  getMfaChallengeCookie,
  setSessionCookie,
} from '../../../../lib/session';
import { Hook } from '../../../../components/Hook';
import { MfaCodeForm } from '../../../../components/MfaCodeForm';

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
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <>
      <Hook code="login.top" />
      <MfaCodeForm action={verifyAction} next={nextPath} error={params.error} />
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
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  let result;
  try {
    result = await verifyCustomerMfa({ challengeId, code });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : 'Verification failed. Please try again.';
    redirect(`/login/mfa?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }
  if (!result.sessionCookieValue) {
    redirect(
      `/login/mfa?error=${encodeURIComponent('Verification failed. Please try again.')}&next=${encodeURIComponent(next)}`,
    );
  }
  await setSessionCookie(result.sessionCookieValue);
  await clearMfaChallengeCookie();
  redirect(next);
}

function sanitiseNext(input: string | undefined): string {
  if (!input) return '/account';
  if (!input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}
