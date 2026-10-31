import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  listPendingInvitations,
  removeMember,
  revokeInvitation,
} from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { codeLabel } from '../../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Members list + invite form (T155 / FR-043). Backend enforces
 * Organization Admin via `requireCustomer` + a server-side role check; we
 * also gate the page in the layout to fail closed.
 */

export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; email?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  const roleLabel = (role: string): string => codeLabel(t, 'account.role', role);
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>{t('account.members.heading')}</h2>
        <p className="b2b-auth__error">{t('account.members.adminRequired')}</p>
      </>
    );
  }
  const [members, pendingInvitations] = await Promise.all([
    listMembers(session),
    listPendingInvitations(session),
  ]);
  const params = await searchParams;

  return (
    <>
      <h2>{t('account.members.heading')}</h2>
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
              <td>{roleLabel(m.role)}</td>
              <td>
                <form action={changeRoleAction} className="inline-flex gap-[0.25rem]">
                  <input type="hidden" name="memberId" value={m.id} />
                  <select name="role" defaultValue={m.role}>
                    <option value="organization_admin">{roleLabel('organization_admin')}</option>
                    <option value="regular_user">{roleLabel('regular_user')}</option>
                  </select>
                  <button type="submit">{t('account.common.save')}</button>
                </form>{' '}
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
                  <td>{roleLabel(inv.role)}</td>
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
            <select id="invite-role" name="role" defaultValue="regular_user">
              <option value="regular_user">{roleLabel('regular_user')}</option>
              <option value="organization_admin">{roleLabel('organization_admin')}</option>
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
  const role = (formData.get('role') as 'regular_user' | 'organization_admin') ?? 'regular_user';
  try {
    await inviteMember(session, { email, role });
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
  const role = (formData.get('role') as 'regular_user' | 'organization_admin') ?? 'regular_user';
  try {
    await changeMemberRole(session, memberId, role);
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
