import type { ReactNode } from 'react';
import { loginCustomer } from '../../../lib/api/auth';
import { beginMfaSetupTicket } from '../../../lib/api/mfa';
import {
  clearAnonCartCookie,
  setCartMergeFlash,
  setMfaChallengeCookie,
  setMfaSetupTicketCookie,
  setSessionCookie,
} from '../../../lib/session';
import { Hook } from '../../../components/Hook';
import { SocialLoginButtons } from '../../../components/SocialLoginButtons';
import { getServerContext } from '../../../lib/server-context';
import { getFederatedSignInProviders } from '../../../lib/api/federated-sign-in';
import type { Metadata } from 'next';
import { backendBaseUrl } from '../../../lib/env.mjs';
import { tForLocale } from '../../../lib/i18n/messages';
import { signInErrorMessage, signInErrorParam } from '../../../lib/auth/sign-in-errors';
import { SIGN_IN_REQUIRED_REASON } from '../../../lib/channel/closed-store';
import { localeRedirect, localizedPath } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Storefront login page (T151 / FR-040). Submits via a server action,
 * persists the session cookie via `setSessionCookie`, and redirects to the
 * `next` query parameter (default: `/account`). The form exposes an
 * optional 2FA code field — passed straight through to the backend so
 * second-factor enforcement can be turned on without a UI change.
 */

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; reason?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const nextPath = sanitiseNext(params.next);

  // Issue #193 — the federated block is decided **before the HTML is sent**, so
  // it renders its final shape on first paint: no button appears and then
  // vanishes under a cursor on the most security-sensitive screen in the shop.
  //
  // Two inputs, and `mfa` absent short-circuits the second: presence is
  // projected from `/module-presence` (Constitution XVII item 5 — the frontend
  // resolves absence from the server's effective enabled-set, it does not
  // hard-code a module list), and the provider list is the channel-scoped
  // "configured AND enabled" answer. Both settings default to `false`, so the
  // honest default rendering is nothing at all.
  const { ctx, locale, modules, anonymousAccess } = await getServerContext();
  const t = tForLocale(locale);
  // `specs/154-sales-channel-access/` — a refusal because this account may not
  // use this store arrives as a stable code from the password step, the second
  // factor and the federated callback alike, and is shown translated.
  const error = signInErrorMessage(params.error, locale);
  // The middleware sends an anonymous visitor of a store closed to them here.
  // Shown only while the store is closed, so a stale link cannot claim it is.
  const signInRequired = params.reason === SIGN_IN_REQUIRED_REASON && !anonymousAccess;
  const mfaPresent = modules.isPresent('mfa');
  const federatedProviders = mfaPresent
    ? await getFederatedSignInProviders(ctx)
    : [];

  return (
    <>
      <Hook code="login.top" />
      <div className="b2b-auth">
        <h1>{t('auth.login.heading')}</h1>
        <p>{t('auth.login.intro')}</p>
        {signInRequired ? (
          <p className="b2b-auth__notice" role="status">
            {t('auth.login.signInRequired')}
          </p>
        ) : null}
        {error ? (
          <div className="b2b-auth__error" role="alert">
            {error}
          </div>
        ) : null}
        <form action={loginAction} className="b2b-auth__form">
          <input type="hidden" name="next" value={nextPath} />
          <div className="b2b-auth__field">
            <label htmlFor="login-email">{t('auth.field.email')}</label>
            <input id="login-email" name="email" type="email" required autoComplete="email" placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="login-password">{t('auth.field.password')}</label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder=" "
            />
          </div>
          <div className="b2b-auth__actions">
            <button type="submit">{t('auth.login.submit')}</button>
          </div>
        </form>
        <SocialLoginButtons
          backendBaseUrl={backendBaseUrl()}
          // Feature 167 — the return address under this page's prefix, from which the
          // backend learns the language to come back in.
          next={await localizedPath(nextPath)}
          locale={locale}
          modulePresent={mfaPresent}
          availableProviders={federatedProviders}
          salesChannelCode={ctx.salesChannelCode}
        />
        <p className="b2b-auth__hint">
          {t('auth.login.forgotPrompt')}{' '}
          <LocalizedLink href="/password-reset/request">{t('auth.login.forgotLink')}</LocalizedLink>.
        </p>
        <p className="b2b-auth__hint">
          {t('auth.login.newPrompt')}{' '}
          <LocalizedLink href="/register">{t('auth.login.registerLink')}</LocalizedLink>.
        </p>
      </div>
      <Hook code="login.bottom" />
    </>
  );
}

async function loginAction(formData: FormData): Promise<void> {
  'use server';
  const email = (formData.get('email') as string) ?? '';
  const password = (formData.get('password') as string) ?? '';
  const next = sanitiseNext((formData.get('next') as string) ?? '/account');

  // Only the network/auth call is wrapped — the `redirect()` calls below must
  // stay OUTSIDE the try, otherwise Next's `NEXT_REDIRECT` control-flow throw
  // is caught here and re-routed into the error branch, blanking the page.
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  let result;
  try {
    result = await loginCustomer({ email, password });
  } catch (err) {
    const message = signInErrorParam(err, t('auth.login.failed'));
    return await localeRedirect(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
  }
  // Feature 042 — two-step login. An account with active 2FA gets routed to the
  // second-step code screen; the opaque challenge id rides in an httpOnly cookie.
  if (result.status === 'mfaRequired') {
    await setMfaChallengeCookie(result.challengeId);
    return await localeRedirect(`/login/mfa?next=${encodeURIComponent(next)}`);
  }
  if (result.status === 'mfaSetupRequired') {
    // Enforced-but-unenrolled — begin enrolment with the ticket and route to the
    // forced-setup screen (the secret rides in an httpOnly cookie, not the URL).
    let begun;
    try {
      begun = await beginMfaSetupTicket(result.setupTicket);
    } catch {
      return await localeRedirect(
        `/login?error=${encodeURIComponent(t('auth.login.setupStartFailed'))}&next=${encodeURIComponent(next)}`,
      );
    }
    await setMfaSetupTicketCookie({
      setupTicket: result.setupTicket,
      secret: begun.secret,
      otpauthUri: begun.otpauthUri,
    });
    return await localeRedirect(`/login/setup?next=${encodeURIComponent(next)}`);
  }
  if (!result.sessionCookieValue) {
    return await localeRedirect(
      `/login?error=${encodeURIComponent(t('auth.login.failed'))}&next=${encodeURIComponent(next)}`,
    );
  }
  await setSessionCookie(result.sessionCookieValue);
  // Feature 037 — when the login carried an anonymous cart and the
  // backend's merge had an observable effect, write a short-lived flash
  // cookie so the next page render can show the confirmation toast.
  // `noop` outcomes deliberately skip the flash (FR-018).
  if (
    result.cartMerge?.outcome === 'adopted' ||
    result.cartMerge?.outcome === 'merged'
  ) {
    // The anon cart was drained into the customer cart and marked completed
    // backend-side; drop the now-stale anon cookie so later reads (e.g. after
    // a session expiry) don't fall back to that emptied cart and make the cart
    // appear to vanish.
    await clearAnonCartCookie();
    await setCartMergeFlash(result.cartMerge.outcome);
  }
  return await localeRedirect(next);
}

/** Only allow same-origin paths in `?next=` to defend against open-redirect. */
function sanitiseNext(input: string | undefined): string {
  if (!input) return '/account';
  if (!input.startsWith('/') || input.startsWith('//')) return '/account';
  return input;
}
