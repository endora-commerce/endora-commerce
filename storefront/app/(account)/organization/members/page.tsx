import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../../lib/session';
import { getMe } from '../../../../lib/api/account';
import {
  changeMemberRole,
  inviteMember,
  listMembers,
  removeMember,
} from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';

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
  if (!session) redirect('/login');
  const me = await getMe(session);
  if (me.customerAccount.role !== 'organization_admin') {
    return (
      <>
        <h2>Members</h2>
        <p className="b2b-auth__error">Organization Admin role required.</p>
      </>
    );
  }
  const members = await listMembers(session);
  const params = await searchParams;

  return (
    <>
      <h2>Members</h2>
      {params.status === 'invited' ? (
        <p className="b2b-auth__success">Invitation sent to {params.email}.</p>
      ) : null}
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td>
                {m.firstName} {m.lastName}
              </td>
              <td>{m.email}</td>
              <td>{m.role}</td>
              <td>
                <form action={changeRoleAction} style={{ display: 'inline-flex', gap: '0.25rem' }}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <select name="role" defaultValue={m.role}>
                    <option value="organization_admin">organization_admin</option>
                    <option value="regular_user">regular_user</option>
                  </select>
                  <button type="submit">Save</button>
                </form>{' '}
                {m.id === me.customerAccount.id ? null : (
                  <form action={removeAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="memberId" value={m.id} />
                    <button type="submit">Remove</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Invite a new member</h3>
      <form action={inviteAction} className="b2b-auth__form">
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="invite-email">Email</label>
            <input id="invite-email" name="email" type="email" required />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" name="role" defaultValue="regular_user">
              <option value="regular_user">regular_user</option>
              <option value="organization_admin">organization_admin</option>
            </select>
          </div>
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Send invitation</button>
        </div>
      </form>
    </>
  );
}

async function inviteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const email = (formData.get('email') as string) ?? '';
  const role = (formData.get('role') as 'regular_user' | 'organization_admin') ?? 'regular_user';
  try {
    await inviteMember(session, { email, role });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not send invitation.';
    redirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  redirect(`/organization/members?status=invited&email=${encodeURIComponent(email)}`);
}

async function changeRoleAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const memberId = (formData.get('memberId') as string) ?? '';
  const role = (formData.get('role') as 'regular_user' | 'organization_admin') ?? 'regular_user';
  try {
    await changeMemberRole(session, memberId, role);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not change role.';
    redirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  redirect(`/organization/members`);
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const memberId = (formData.get('memberId') as string) ?? '';
  try {
    await removeMember(session, memberId);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not remove member.';
    redirect(`/organization/members?error=${encodeURIComponent(message)}`);
  }
  redirect(`/organization/members`);
}
