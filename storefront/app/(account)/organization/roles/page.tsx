import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getSessionCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';
import { listRoles, type OrganizationRoleView } from '../../../../lib/api/organization';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { organizationAreaAccess } from '../../../../lib/account/organization-area';
import { countParam } from '../../../../lib/account/organization-roles';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The Organization's roles, for its administrators (`specs/170-organization-roles/`,
 * FR-004, FR-010; research R-12): each role with its kind, how many members and
 * pending invitations hold it and how many permissions it grants. *New role* is
 * the one primary action. The *Administrator* row offers nothing — it holds
 * every permission and cannot be changed; *Member* offers its permissions;
 * a custom role opens its editor, where it is also deleted.
 *
 * A personal Organization's member is sent to the account page (FR-070a), a
 * member who is not the administrator is told why the page is empty.
 */
export default async function OrganizationRolesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; members?: string; invitations?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  const access = organizationAreaAccess(me, 'roles');
  if (access === 'absent') return await localeRedirect('/account');
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);
  const heading = <h2>{t('account.roles.heading')}</h2>;
  if (access === 'refused') {
    return (
      <>
        {heading}
        <p className="b2b-auth__error">{t('account.roles.adminRequired')}</p>
      </>
    );
  }

  let roles: OrganizationRoleView[];
  try {
    roles = await listRoles(session, ctx);
  } catch {
    return (
      <>
        {heading}
        <p className="b2b-auth__error" role="alert">
          {t('account.roles.loadFailed')}{' '}
          <LocalizedLink href="/organization/roles">{t('account.roles.retry')}</LocalizedLink>
        </p>
      </>
    );
  }

  const params = await searchParams;
  const done =
    params.status === 'created'
      ? t('account.roles.done.created')
      : params.status === 'saved'
        ? t('account.roles.done.saved')
        : params.status === 'deleted'
          ? format(t('account.roles.done.deleted'), {
              members: countParam(params.members).toLocaleString(locale),
              invitations: countParam(params.invitations).toLocaleString(locale),
            })
          : null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {heading}
        <LocalizedLink href="/organization/roles/new" className="btn btn--dark min-h-11">
          {t('account.roles.new')}
        </LocalizedLink>
      </div>
      <p className="b2b-auth__hint">{t('account.roles.intro')}</p>
      {done ? (
        <p className="b2b-auth__success" role="status">
          {done}
        </p>
      ) : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.roles.col.name')}</th>
            <th>{t('account.roles.col.kind')}</th>
            <th>{t('account.roles.col.members')}</th>
            <th>{t('account.roles.col.invitations')}</th>
            <th>{t('account.roles.col.permissions')}</th>
            <th>{t('account.roles.col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id}>
              <td>{role.name}</td>
              <td>
                <span className="industria-status industria-status--draft">
                  {role.kind === 'custom' ? t('account.roles.kind.custom') : t('account.roles.kind.builtIn')}
                </span>
              </td>
              <td>{role.memberCount.toLocaleString(locale)}</td>
              <td>{role.pendingInvitationCount.toLocaleString(locale)}</td>
              <td>
                {role.kind === 'administrator'
                  ? t('account.roles.allPermissions')
                  : role.permissions.length.toLocaleString(locale)}
              </td>
              <td>
                {role.kind === 'administrator' ? null : (
                  <LocalizedLink
                    href={`/organization/roles/${encodeURIComponent(role.id)}`}
                    className="btn btn--outline btn--sm min-h-11"
                  >
                    {role.kind === 'member' ? t('account.roles.editPermissions') : t('account.roles.edit')}
                  </LocalizedLink>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
