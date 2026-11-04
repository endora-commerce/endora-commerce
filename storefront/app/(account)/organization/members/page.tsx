import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  listPendingInvitations,
  listRoles,
  removeMember,
  revokeInvitation,
} from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';
import { organizationAreaAccess } from '../../../../lib/account/organization-area';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Members list + invite form (T155 / FR-043). Backend enforces the
 * *Administrator* role via `requireCustomer` + a server-side role check; the
 * page asks the same of the session to say so rather than render an empty
 * screen.
 *
 * Feature 170 (FR-008, US 1.2, US 5): each member's role is a select of the
 * Organization's roles, named by the API in the page's language; an
 * invitation names its role, *Member* preselected. A personal Organization's
 * member — its Administrator — is sent to the account page (PR-3, FR-070a).
 */

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; email?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  const access = organizationAreaAccess(me, 'members');
  if (access === 'absent') return await localeRedirect('/account');
  const { locale, ctx } = await getServerContext();
  const t = tForLocale(locale);
  if (access === 'refused') {
    return (
      <>
        <h2>{t('account.members.heading')}</h2>
        <p className="b2b-auth__error">{t('account.members.adminRequired')}</p>
      </>
    );
  }
  const [members, pendingInvitations, roles] = await Promise.all([
    listMembers(session, ctx),
    listPendingInvitations(session, ctx),
    listRoles(session, ctx),
  ]);
  const memberRoleId = roles.find((r) => r.kind === 'member')?.id;
  const roleOptions = roles.map((r) => (
    <option key={r.id} value={r.id}>
      {r.name}
    </option>
  ));
  const params = await searchParams;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2>{t('account.members.heading')}</h2>
        <LocalizedLink href="/organization/roles" className="btn btn--outline btn--sm min-h-11">
          {t('account.members.manageRoles')}
        </LocalizedLink>
      </div>
      {params.status === 'invited' ? (
        <p className="b2b-auth__success">
          {format(t('account.members.invited'), { email: params.email ?? '' })}
        </p>
      ) : null}
      {params.status === 'revoked' ? (
        <p className="b2b-auth__success">{t('account.members.revoked')}</p>
      ) : null}
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.common.name')}</th>
            <th>{t('account.common.email')}</th>
            <th>{t('account.common.role')}</th>
            <th>{t('account.members.col.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                {m.firstName} {m.lastName}
              </td>
              <td>{m.email}</td>
              <td>
                <form action={changeRoleAction} className="inline-flex gap-[0.25rem]">
                  <input type="hidden" name="memberId" value={m.id} />
                  <select
                    name="roleId"
                    defaultValue={m.organizationRole.id}
                    aria-label={format(t('account.members.roleOf'), { name: `${m.firstName} ${m.lastName}` })}
                  >
                    {roleOptions}
                  </select>
                  <button type="submit">{t('account.common.save')}</button>
                </form>
              </td>
              <td>
                {m.id === me.customerAccount.id ? null : (
                  <form action={removeAction} className="inline">
                    <input type="hidden" name="memberId" value={m.id} />
                    <button type="submit">{t('account.common.remove')}</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {pendingInvitations.length > 0 ? (
        <>
          <h3>{t('account.members.pending.heading')}</h3>
          <table className="b2b-account__table">
            <thead>
              <tr>
                <th>{t('account.common.email')}</th>
                <th>{t('account.common.role')}</th>
                <th>{t('account.members.pending.sent')}</th>
                <th>{t('account.members.pending.expires')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingInvitations.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>{inv.organizationRole.name}</td>
                  <td>{new Date(inv.createdAt).toLocaleDateString(locale)}</td>
                  <td>{new Date(inv.expiresAt).toLocaleDateString(locale)}</td>
                  <td>
                    <form action={revokeAction} className="inline">
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <button type="submit">{t('account.members.pending.revoke')}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h3>{t('account.members.invite.heading')}</h3>
      <form action={inviteAction} className="b2b-auth__form">
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="invite-email">{t('account.common.email')}</label>
            <input id="invite-email" name="email" type="email" required placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="invite-role">{t('account.common.role')}</label>
            <select id="invite-role" name="roleId" defaultValue={memberRoleId}>
              {roleOptions}
            </select>
          </div>
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">{t('account.members.invite.submit')}</button>
        </div>
      </form>
    </>
  );
}

/** A server action's own refusal, in the page's language. */
async function failure(key: MessageKey): Promise<string> {
  const { locale } = await getServerContext();
  return tForLocale(locale)(key);
}

async function inviteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const email = (formData.get('email') as string) ?? '';
  const roleId = formData.get('roleId');
  try {
    await inviteMember(session, { email, ...(typeof roleId === 'string' && roleId !== '' ? { roleId } : {}) });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.members.inviteFailed');
    return await localeRedirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/members?status=invited&email=${encodeURIComponent(email)}`);
}

async function changeRoleAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const memberId = (formData.get('memberId') as string) ?? '';
  const roleId = (formData.get('roleId') as string) ?? '';
  try {
    await changeMemberRole(session, memberId, roleId);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.members.roleFailed');
    return await localeRedirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/members`);
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const memberId = (formData.get('memberId') as string) ?? '';
  try {
    await removeMember(session, memberId);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.members.removeFailed');
    return await localeRedirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/members`);
}

async function revokeAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const invitationId = (formData.get('invitationId') as string) ?? '';
  try {
    await revokeInvitation(session, invitationId);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.members.revokeFailed');
    return await localeRedirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/members?status=revoked`);
}
