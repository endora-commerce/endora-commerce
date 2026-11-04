import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getSessionCookie } from '../../../../../lib/session';
import { getMe } from '../../../../../lib/api/account';
import { getPermissionCatalogue, type PermissionCatalogueGroup } from '../../../../../lib/api/organization';
import { localeRedirect } from '../../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../../lib/server-context';
import { tForLocale } from '../../../../../lib/i18n/messages';
import { organizationAreaAccess } from '../../../../../lib/account/organization-area';
import { RoleEditorForm } from '../../../../../components/account/RoleEditorForm';
import { createRoleAction } from '../actions';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A new custom role (`specs/170-organization-roles/`, FR-004, FR-025): a name,
 * an optional description and the permissions of the catalogue the API serves.
 * **Every permission starts unticked and nothing is copied from *Member***
 * (owner ruling Q1, 2026-11-04): a new role grants exactly what its
 * administrator ticks.
 *
 * The form is `RoleEditorForm`, a client component: a refused save is shown
 * by its code and keeps what was typed and ticked. The page reads nothing from
 * its URL, so no link can pre-fill a role or put a refusal on it.
 */
export default async function NewOrganizationRolePage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  const access = organizationAreaAccess(me, 'roles');
  if (access === 'absent') return await localeRedirect('/account');
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);
  const back = (
    <p className="mb-3 mt-0 text-[13px]">
      <LocalizedLink href="/organization/roles">← {t('account.roles.back')}</LocalizedLink>
    </p>
  );
  const heading = <h2>{t('account.roles.new')}</h2>;
  if (access === 'refused') {
    return (
      <>
        {heading}
        <p className="b2b-auth__error">{t('account.roles.adminRequired')}</p>
      </>
    );
  }

  let groups: PermissionCatalogueGroup[];
  try {
    groups = await getPermissionCatalogue(session, ctx);
  } catch {
    return (
      <>
        {back}
        {heading}
        <p className="b2b-auth__error" role="alert">
          {t('account.roles.editor.catalogueFailed')}{' '}
          <LocalizedLink href="/organization/roles/new">{t('account.roles.retry')}</LocalizedLink>
        </p>
      </>
    );
  }

  return (
    <>
      {back}
      {heading}
      <RoleEditorForm
        action={createRoleAction}
        locale={locale}
        groups={groups}
        granted={[]}
        role={null}
        cancelHref="/organization/roles"
      />
    </>
  );
}
