import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { getMe } from '../../../lib/api/account';
import { getMyCreditLimit } from '../../../lib/api/credit-limit';
import {
  fetchPwaConfig,
  getPushPreferences,
  updatePushPreferences,
} from '../../../lib/api/pwa-server';
import { CreditLimitWidget } from '../../../components/CreditLimitWidget';
import {
  PushNotificationsSection,
  pushPreferencesPatch,
} from '../../../components/pwa/PushPreferencesForm';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { tForLocale } from '../../../lib/i18n/messages';
import { codeLabel } from '../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Account profile (T154). Read-only summary of the current customer +
 * their organization role. Profile-edit is intentionally out of scope for
 * MVP — buyers update their name via support to keep audit trails simple.
 */
export default async function AccountProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ pushSaved?: string; pushError?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const sp = await searchParams;
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);
  // The push section (`specs/149-pwa-order-status-push/`) is read beside the
  // profile: the public config says what the channel offers, the preferences
  // what this customer chose. Either failing hides the section.
  const [me, creditLimit, pwaConfig, pushPreferences] = await Promise.all([
    getMe(session),
    getMyCreditLimit(session),
    fetchPwaConfig(ctx.salesChannelCode),
    getPushPreferences(session, ctx),
  ]);

  return (
    <>
      <h2>{t('account.profile.heading')}</h2>
      {creditLimit ? (
        <div className="mb-[16px]">
          <CreditLimitWidget limit={creditLimit} locale={locale} showReservations />
        </div>
      ) : null}
      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">{t('account.common.name')}</th>
            <td>
              {me.customerAccount.firstName} {me.customerAccount.lastName}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('account.common.email')}</th>
            <td>
              {me.customerAccount.email}{' '}
              {me.customerAccount.emailVerifiedAt ? (
                <span className="muted">{t('account.profile.verified')}</span>
              ) : (
                <span className="muted">{t('account.profile.unverified')}</span>
              )}
            </td>
          </tr>
          <tr>
            <th scope="row">{t('account.common.role')}</th>
            <td>{codeLabel(t, 'account.role', me.customerAccount.role)}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.profile.twoFactor')}</th>
            <td>{me.customerAccount.twoFactorEnabled
                ? t('account.profile.twoFactorEnabled')
                : t('account.profile.twoFactorDisabled')}</td>
          </tr>
          <tr>
            <th scope="row">{t('account.profile.organization')}</th>
            <td>{me.organization?.name ?? '—'}</td>
          </tr>
        </tbody>
      </table>
      <PushNotificationsSection
        config={pwaConfig}
        preferences={pushPreferences}
        locale={locale}
        saveAction={savePushPreferencesAction}
        saved={sp.pushSaved === '1'}
        failed={sp.pushError === '1'}
      />
    </>
  );
}

async function savePushPreferencesAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const patch = pushPreferencesPatch(formData);
  if (!patch) return await localeRedirect('/account');
  const { ctx } = await getServerContext();
  let saved = true;
  try {
    await updatePushPreferences(session, ctx, patch);
  } catch {
    saved = false;
  }
  // Outside the `try`: `redirect` throws by design.
  return await localeRedirect(saved ? '/account?pushSaved=1' : '/account?pushError=1');
}
