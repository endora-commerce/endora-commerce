import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getSessionCookie } from '../../../../../lib/session';
import { getMe } from '../../../../../lib/api/account';
import {
  getPermissionCatalogue,
  getRole,
  listRoles,
  type OrganizationRoleView,
  type PermissionCatalogueGroup,
} from '../../../../../lib/api/organization';
import { localeRedirect } from '../../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../../lib/i18n/localized-link';
import { getServerContext } from '../../../../../lib/server-context';
import { tForLocale } from '../../../../../lib/i18n/messages';
import { format } from '../../../../../lib/i18n/format';
import { organizationAreaAccess } from '../../../../../lib/account/organization-area';
import { roleErrorKey } from '../../../../../lib/account/organization-roles';
import { RolePermissionsFields } from '../../../../../components/account/RolePermissionsFields';
import { RoleEditorForm } from '../../../../../components/account/RoleEditorForm';
import { CartSubmitButton } from '../../../../../components/CartSubmitButton';
import { deleteRoleAction, updateRoleAction } from '../actions';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * One role (`specs/170-organization-roles/`, FR-004, FR-024, FR-025; US 6).
 *
 * - *Administrator* is shown read-only: it holds every permission and cannot
 *   be changed.
 * - *Member* is built in: only its permissions are edited, and it cannot be
 *   deleted.
 * - A custom role edits its name, description and permissions, and is deleted
 *   behind a disclosure, away from *Save*: when members or pending invitations
 *   hold it the administrator chooses the role they move to, *Member*
 *   preselected; a role nobody holds is deleted without one.
 *
 * The save is `RoleEditorForm` (client): it carries the version the page read,
 * and a refusal — a stale save included — is shown in place with what was typed
 * kept; a stale form is reloaded only on request (R-29, owner ruling on PR
 * #715). The deletion is a plain server form that comes back as `?error=<code>`,
 * after which the page shows the role as it now is.
 */
export default async function OrganizationRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
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
  if (access === 'refused') {
    return (
      <>
        <h2>{t('account.roles.heading')}</h2>
        <p className="b2b-auth__error">{t('account.roles.adminRequired')}</p>
      </>
    );
  }

  let role: OrganizationRoleView | null;
  let groups: PermissionCatalogueGroup[];
  try {
    [role, groups] = await Promise.all([getRole(session, id, ctx), getPermissionCatalogue(session, ctx)]);
  } catch {
    return (
      <>
        {back}
        <h2>{t('account.roles.heading')}</h2>
        <p className="b2b-auth__error" role="alert">
          {t('account.roles.loadFailed')}{' '}
          <LocalizedLink href={`/organization/roles/${encodeURIComponent(id)}`}>{t('account.roles.retry')}</LocalizedLink>
        </p>
      </>
    );
  }
  if (!role) {
    return (
      <>
        {back}
        <h2>{t('account.roles.heading')}</h2>
        <p className="b2b-auth__error" role="alert">
          {t('account.roles.notFound')}
        </p>
      </>
    );
  }

  const { error } = await searchParams;
  // Only the deletion still answers by `?error=` (the save answers in place).
  const errorKey = roleErrorKey(error);
  const custom = role.kind === 'custom';
  const held = role.memberCount + role.pendingInvitationCount > 0;
  // The replacement choices are read only where a deletion needs one (FR-024).
  const replacements =
    custom && held ? (await listRoles(session, ctx).catch(() => [] as OrganizationRoleView[])).filter((r) => r.id !== role.id) : [];
  const memberRoleId = replacements.find((r) => r.kind === 'member')?.id;

  const heading = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="m-0">{role.name}</h2>
      <span className="industria-status industria-status--draft">
        {custom ? t('account.roles.kind.custom') : t('account.roles.kind.builtIn')}
      </span>
    </div>
  );

  if (role.kind === 'administrator') {
    return (
      <>
        {back}
        {heading}
        <p className="b2b-auth__hint">{format(t('account.roles.editor.administratorHint'), { role: role.name })}</p>
        <RolePermissionsFields groups={groups} granted={role.permissions} locale={locale} readOnly />
      </>
    );
  }

  return (
    <>
      {back}
      {heading}
      {role.description ? <p className="b2b-auth__hint">{role.description}</p> : null}
      {errorKey ? (
        <p className="b2b-auth__error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}

      <RoleEditorForm
        action={updateRoleAction}
        locale={locale}
        groups={groups}
        granted={role.permissions}
        role={{ id: role.id, kind: role.kind, name: role.name, description: role.description, version: role.version }}
        cancelHref="/organization/roles"
      />

      {custom ? (
        <details
          open={error === 'ORGANIZATION_ROLE_REPLACEMENT_REQUIRED'}
          className="mt-8 max-w-[720px] rounded-md border border-line p-[14px]"
        >
          <summary className="min-h-11 cursor-pointer content-center text-[13px] font-medium">
            {t('account.roles.delete.toggle')}
          </summary>
          <form action={deleteRoleAction} className="b2b-auth__form mt-3">
            <input type="hidden" name="id" value={role.id} />
            <input type="hidden" name="expectedVersion" value={String(role.version)} />
            {held ? (
              <>
                <p className="m-0 text-[13px]">
                  {format(t('account.roles.delete.held'), {
                    members: role.memberCount.toLocaleString(locale),
                    invitations: role.pendingInvitationCount.toLocaleString(locale),
                  })}
                </p>
                <div className="b2b-auth__field">
                  <label htmlFor="replacement-role">{t('account.roles.delete.replacement')}</label>
                  <select id="replacement-role" name="replacementRoleId" required defaultValue={memberRoleId}>
                    {replacements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p className="m-0 text-[13px]">{t('account.roles.delete.unheld')}</p>
            )}
            <p className="m-0 text-[12px] text-muted">{t('account.roles.delete.irreversible')}</p>
            <div>
              <CartSubmitButton
                className="btn btn--outline min-h-11 border-bad text-bad"
                label={t('account.roles.delete.confirm')}
                pendingLabel={t('account.roles.delete.deleting')}
              />
            </div>
          </form>
        </details>
      ) : null}
    </>
  );
}
