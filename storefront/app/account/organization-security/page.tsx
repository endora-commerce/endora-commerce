import type { ReactNode } from 'react';
import { setOrganizationMfaPolicy } from '../../../lib/api/mfa';
import { StorefrontApiError } from '../../../lib/api/client';
import { getSessionCookie } from '../../../lib/session';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront organization-security page (feature 042, US3). An Organization
 * Administrator can require (or stop requiring) 2FA for their organization's
 * members. The backend enforces the org-admin role; a regular member's action
 * is refused.
 */
export default async function OrganizationSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/organization-security');
  const params = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <div className="b2b-auth">
      <h1>{t('auth.organizationSecurity.heading')}</h1>
      <p>{t('auth.organizationSecurity.intro')}</p>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}
      {params.done ? <p>{t('auth.organizationSecurity.done')}</p> : null}
      <form action={enforceAction} className="b2b-auth__form">
        <input type="hidden" name="value" value="true" />
        <button type="submit">{t('auth.organizationSecurity.require')}</button>
      </form>
      <form action={enforceAction} className="b2b-auth__form">
        <input type="hidden" name="value" value="false" />
        <button type="submit">{t('auth.organizationSecurity.stop')}</button>
      </form>
    </div>
  );
}

async function enforceAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/account/organization-security');
  const enforce = (formData.get('value') as string) === 'true';
  try {
    await setOrganizationMfaPolicy(session, enforce);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError
        ? err.detail
        : tForLocale((await getServerContext()).locale)('auth.organizationSecurity.failed');
    return await localeRedirect(`/account/organization-security?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect('/account/organization-security?done=1');
}
