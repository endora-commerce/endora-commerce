import type { ReactNode } from 'react';
import { setCartApprovalPolicy } from '../../../../../lib/api/cart';
import { getSessionCookie, getAnonCartCookie } from '../../../../../lib/session';
import { getMe } from '../../../../../lib/api/account';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../../lib/server-context';
import { tForLocale } from '../../../../../lib/i18n/messages';
import { format } from '../../../../../lib/i18n/format';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Cart-approval policy toggle (feature 027 US4).
 *
 * Org-Admin-only. Two server-action forms (turn-on / turn-off). Reading
 * the current value goes through `/api/v1/me` (the Organization payload
 * doesn't yet expose `requiresCartApproval`; until it does, we surface
 * a "status unknown — submit to change" affordance and rely on the
 * backend's idempotent setPolicyForOrganization).
 *
 * Browser-verification note: the form-action UX and the policy-off
 * cascading reset (every pending/approved cart in the Org returns to
 * not_required) need eyes.
 */
export default async function CartApprovalPolicyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  if (!me.organization) return await localeRedirect('/account');
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>{t('account.cartApproval.heading')}</h2>
        <p className="b2b-auth__error">{t('account.cartApproval.adminOnly')}</p>
      </>
    );
  }

  return (
    <>
      <h2>{t('account.cartApproval.heading')}</h2>
      <p className="b2b-auth__hint">
        {format(t('account.cartApproval.intro'), { organization: me.organization.name })}
      </p>

      {params.ok ? (
        <p className="b2b-auth__hint" style={{ color: '#3a7' }}>
          {params.ok === 'on' ? t('account.cartApproval.turnedOn') : t('account.cartApproval.turnedOff')}
        </p>
      ) : null}
      {params.error ? (
        <p className="b2b-auth__error">{params.error}</p>
      ) : null}

      <div className="b2b-auth__actions" style={{ gap: '1rem', marginTop: '1rem' }}>
        <form action={turnOnAction}>
          <button type="submit">{t('account.cartApproval.require')}</button>
        </form>
        <form action={turnOffAction}>
          <button type="submit">{t('account.cartApproval.notRequired')}</button>
        </form>
      </div>
    </>
  );
}

async function turnOnAction(_formData: FormData): Promise<void> {
  'use server';
  await applyPolicy(true);
}

async function turnOffAction(_formData: FormData): Promise<void> {
  'use server';
  await applyPolicy(false);
}

async function applyPolicy(requiresCartApproval: boolean): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await setCartApprovalPolicy(
      {
        ...(session ? { session } : {}),
        ...(anon ? { anon } : {}),
      },
      requiresCartApproval,
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : tForLocale((await getServerContext()).locale)('account.cartApproval.failed');
    return await localeRedirect(`/organization/settings/cart-approval?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/settings/cart-approval?ok=${requiresCartApproval ? 'on' : 'off'}`);
}
