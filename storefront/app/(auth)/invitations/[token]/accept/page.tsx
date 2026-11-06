import type { ReactNode } from 'react';
import { loginCustomer } from '../../../../../lib/api/auth';
import { acceptInvitation } from '../../../../../lib/api/organization';
import { INVITATION_ACCEPT_ERRORS, type InvitationAcceptCode } from '../../../../../lib/auth/auth-errors';
import { signInErrorParam } from '../../../../../lib/auth/sign-in-errors';
import { setSessionCookie } from '../../../../../lib/session';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../../lib/server-context';
import { tForLocale } from '../../../../../lib/i18n/messages';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Invitation redemption (email link → `/invitations/:token/accept`).
 * Matches `buildInvitationEmail` in the backend; submits to
 * `POST /api/v1/organizations/invitations/:token/accept`, then signs in.
 *
 * **A code travels, never a sentence** (issue #808, `lib/url-errors.ts`): the
 * action carries a code of {@link INVITATION_ACCEPT_ERRORS} in `?error=`, and
 * the page words it, reading any other value as its generic failure. An empty
 * token goes to `/login` with a sign-in code.
 */

export default async function AcceptInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const { token } = await params;
  const { error } = await searchParams;
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  const errorKey = INVITATION_ACCEPT_ERRORS.errorKey(error);

  return (
    <div className="b2b-auth">
      <h1>{t('auth.invitation.heading')}</h1>
      <p>{t('auth.invitation.intro')}</p>
      {errorKey ? <div className="b2b-auth__error">{t(errorKey)}</div> : null}
      <form action={acceptInvitationAction} className="b2b-auth__form">
        <input type="hidden" name="token" value={token} />
        <div className="b2b-auth__field">
          <label htmlFor="invite-fn">{t('auth.field.firstName')}</label>
          <input id="invite-fn" name="firstName" required autoComplete="given-name" maxLength={120} placeholder=" " />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="invite-ln">{t('auth.field.lastName')}</label>
          <input id="invite-ln" name="lastName" required autoComplete="family-name" maxLength={120} placeholder=" " />
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="invite-pw">{t('auth.field.newPasswordMin')}</label>
          <input
            id="invite-pw"
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={256}
            autoComplete="new-password"
            placeholder=" "
          />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('auth.common.createAccount')}</button>
        </div>
      </form>
      <p className="b2b-auth__hint">
        {t('auth.invitation.wrongLinkBefore')}{' '}
        <LocalizedLink href="/login">{t('auth.invitation.wrongLinkLink')}</LocalizedLink>
        {t('auth.invitation.wrongLinkAfter')}
      </p>
    </div>
  );
}

async function acceptInvitationAction(formData: FormData): Promise<void> {
  'use server';

  const token = (formData.get('token') as string) ?? '';
  const firstName = ((formData.get('firstName') as string) ?? '').trim();
  const lastName = ((formData.get('lastName') as string) ?? '').trim();
  const password = (formData.get('password') as string) ?? '';

  if (!token.trim()) {
    return await localeRedirect(`/login?error=${signInErrorParam(null, 'INVITATION_INVALID')}`);
  }
  const redirectWithError = async (code: InvitationAcceptCode): Promise<never> =>
    await localeRedirect(`/invitations/${encodeURIComponent(token)}/accept?error=${code}`);

  let login: Awaited<ReturnType<typeof loginCustomer>>;
  try {
    const { customerAccount } = await acceptInvitation(token, {
      password,
      firstName,
      lastName,
    });
    login = await loginCustomer({
      email: customerAccount.email,
      password,
    });
  } catch (err) {
    return await redirectWithError(INVITATION_ACCEPT_ERRORS.failureCode(err, 'INVITATION_FAILED'));
  }
  // Feature 042 — a 2FA-protected/enforced account must finish the second
  // step via the normal login flow. Outside the `try`: a redirect is thrown.
  if (login.status !== 'authenticated' || !login.sessionCookieValue) {
    return await redirectWithError('SIGN_IN_TO_CONTINUE');
  }
  await setSessionCookie(login.sessionCookieValue);

  return await localeRedirect('/account');
}
