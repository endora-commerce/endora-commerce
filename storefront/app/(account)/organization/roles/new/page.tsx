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
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
  isNameError,
  roleErrorKey,
} from '../../../../../lib/account/organization-roles';
import { RolePermissionsFields } from '../../../../../components/account/RolePermissionsFields';
import { CartSubmitButton } from '../../../../../components/CartSubmitButton';
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
 * A refused save comes back as `?error=<code>`; a taken name is reported on
 * the name field.
 */
export default async function NewOrganizationRolePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<ReactNode> {
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

  const { error } = await searchParams;
  const errorKey = roleErrorKey(error);
  const nameInvalid = isNameError(error);

  return (
    <>
      {back}
      {heading}
      {errorKey && !nameInvalid ? (
        <p className="b2b-auth__error" role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      <form action={createRoleAction} className="b2b-auth__form max-w-[720px]">
        <div className="b2b-auth__field">
          <label htmlFor="role-name">{t('account.roles.editor.name')}</label>
          <input
            id="role-name"
            name="name"
            required
            maxLength={ROLE_NAME_MAX_LENGTH}
            placeholder=" "
            autoComplete="off"
            aria-invalid={nameInvalid || undefined}
            aria-describedby={nameInvalid ? 'role-name-error' : 'role-name-hint'}
          />
        </div>
        {nameInvalid && errorKey ? (
          <p id="role-name-error" className="b2b-auth__error m-0" role="alert">
            {t(errorKey)}
          </p>
        ) : (
          <p id="role-name-hint" className="m-0 text-[12px] text-muted">
            {t('account.roles.editor.nameHint')}
          </p>
        )}
        <div className="b2b-auth__field">
          <label htmlFor="role-description">{t('account.roles.editor.description')}</label>
          <textarea
            id="role-description"
            name="description"
            rows={2}
            maxLength={ROLE_DESCRIPTION_MAX_LENGTH}
            placeholder=" "
          />
        </div>
        <RolePermissionsFields groups={groups} granted={[]} locale={locale} />
        <div className="b2b-auth__actions flex flex-wrap items-center gap-3">
          <CartSubmitButton
            className="btn btn--dark min-h-11"
            label={t('account.roles.editor.create')}
            pendingLabel={t('account.roles.editor.creating')}
          />
          <LocalizedLink href="/organization/roles" className="btn btn--ghost min-h-11">
            {t('account.common.cancel')}
          </LocalizedLink>
        </div>
      </form>
    </>
  );
}
