import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { getMe, type MeResult } from '../../../lib/api/account';
import { getMyCreditLimit } from '../../../lib/api/credit-limit';
import { getMyRole, type OwnRole } from '../../../lib/api/organization';
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
import { richText } from '../../../lib/account/labels';
import { isCompanyOrganization, isPersonalOrganization } from '../../../lib/account/organization-area';

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
 *
 * Feature 170 (FR-058): the role is the member's organization role, and the
 * page lists what it allows in plain language — `GET …/mine/role`, translated
 * by the API. When that read fails the role still shows from the session and
 * only the list is left out. A personal Organization's member sees neither,
 * and the list is not read (owner ruling on PR #715).
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
  const mePromise = getMe(session);
  // The own-role read waits only for `/me`, and is skipped where no role is shown.
  const ownRolePromise = mePromise.then((me) =>
    showsRole(me) ? getMyRole(session, ctx).catch((): OwnRole | null => null) : null,
  );
  const [me, creditLimit, pwaConfig, pushPreferences, ownRole] = await Promise.all([
    mePromise,
    getMyCreditLimit(session),
    fetchPwaConfig(ctx.salesChannelCode),
    getPushPreferences(session, ctx),
    ownRolePromise,
  ]);
  const role = showsRole(me) ? (ownRole?.role ?? me.customerAccount.organizationRole) : null;

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
          {role ? (
            <tr>
              <th scope="row">{t('account.common.role')}</th>
              <td>{role.name}</td>
            </tr>
          ) : null}
          <tr>
            <th scope="row">{t('account.profile.twoFactor')}</th>
            <td>{me.customerAccount.twoFactorEnabled
                ? t('account.profile.twoFactorEnabled')
                : t('account.profile.twoFactorDisabled')}</td>
          </tr>
          {/* A personal Organization is not a company: no row names it (issue #757). */}
          {isPersonalOrganization(me.organization) ? null : (
            <tr>
              <th scope="row">{t('account.profile.organization')}</th>
              <td>{me.organization?.name ?? '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
      {role && ownRole ? (
        <section aria-labelledby="role-allows-heading" className="mt-6">
          <h3 id="role-allows-heading">{t('account.profile.allows.heading')}</h3>
          {ownRole.permissions.length === 0 ? (
            <p className="text-[13px] text-muted">{t('account.profile.allows.none')}</p>
          ) : (
            <ul className="m-0 grid list-disc gap-1 pl-5 text-[13px]">
              {ownRole.permissions.map((p) => (
                <li key={p.code}>
                  {richText(t('account.profile.allows.item'), {
                    label: <strong className="font-medium">{p.label}</strong>,
                    description: p.description,
                  })}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
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

/**
 * Whether the profile shows the member's role and what it allows: only in a
 * company Organization. A personal Organization's member holds *Administrator*
 * (PR-3), which says nothing useful to a B2C buyer, so neither is shown nor read
 * there (owner ruling on PR #715) — the same `isPersonal` gate as the
 * organization screens.
 */
function showsRole(me: MeResult): boolean {
  return isCompanyOrganization(me.organization);
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
