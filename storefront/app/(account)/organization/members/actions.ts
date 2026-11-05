'use server';

import { changeMemberRole, inviteMember, removeMember, revokeInvitation } from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';
import { getSessionCookie } from '../../../../lib/session';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { memberFailureCode, type MemberActionFailure } from '../../../../lib/account/organization-members';

/**
 * The administrator's member and invitation writes on `/organization/members`
 * (T155 / FR-043; feature 170 FR-008). Each answers with a redirect back to the
 * page — a success with `?status=…`, a refusal with `?error=<code>` and never
 * the API's sentence or the invitee's address (issue #740;
 * `lib/account/organization-members.ts` says why).
 */

const PAGE = '/organization/members';

async function refused(err: unknown, fallback: MemberActionFailure): Promise<never> {
  const code = memberFailureCode(err instanceof StorefrontApiError ? err.code : null, fallback);
  return await localeRedirect(`${PAGE}?error=${code}`);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function inviteAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const email = text(formData, 'email');
  const roleId = text(formData, 'roleId');
  try {
    await inviteMember(session, { email, ...(roleId !== '' ? { roleId } : {}) });
  } catch (err) {
    return await refused(err, 'INVITE_FAILED');
  }
  return await localeRedirect(`${PAGE}?status=invited`);
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await changeMemberRole(session, text(formData, 'memberId'), text(formData, 'roleId'));
  } catch (err) {
    return await refused(err, 'ROLE_FAILED');
  }
  return await localeRedirect(PAGE);
}

export async function removeAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await removeMember(session, text(formData, 'memberId'));
  } catch (err) {
    return await refused(err, 'REMOVE_FAILED');
  }
  return await localeRedirect(PAGE);
}

export async function revokeAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await revokeInvitation(session, text(formData, 'invitationId'));
  } catch (err) {
    return await refused(err, 'REVOKE_FAILED');
  }
  return await localeRedirect(`${PAGE}?status=revoked`);
}
