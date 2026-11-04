'use server';

import { createRole, deleteRole, updateRole } from '../../../../lib/api/organization';
import { getSessionCookie } from '../../../../lib/session';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import {
  createRoleRequest,
  deleteRoleRequest,
  roleFailureCode,
  roleIdOf,
  updateRoleRequest,
} from '../../../../lib/account/organization-roles';

/**
 * The administrator's role writes (`specs/170-organization-roles/`, FR-004,
 * FR-024; `contracts/storefront-api.md` §2). Each redirects to the roles list
 * with `?status=…` or back to its form with `?error=<code>`; the role, the
 * Organization and the version are the API's to check
 * (`lib/account/organization-roles.ts` says why a code and not a sentence).
 */

const LIST = '/organization/roles';

function rolePath(roleId: string): string {
  return `${LIST}/${encodeURIComponent(roleId)}`;
}

export async function createRoleAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await createRole(session, createRoleRequest(formData));
  } catch (err) {
    return await localeRedirect(`${LIST}/new?error=${roleFailureCode(err)}`);
  }
  return await localeRedirect(`${LIST}?status=created`);
}

export async function updateRoleAction(formData: FormData): Promise<void> {
  const roleId = roleIdOf(formData);
  if (!roleId) return await localeRedirect(LIST);
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await updateRole(session, roleId, updateRoleRequest(formData));
  } catch (err) {
    // A stale save lands on the role again, which now reads its current state (R-29).
    return await localeRedirect(`${rolePath(roleId)}?error=${roleFailureCode(err)}`);
  }
  return await localeRedirect(`${LIST}?status=saved`);
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const roleId = roleIdOf(formData);
  if (!roleId) return await localeRedirect(LIST);
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  let moved: { reassignedMembers: number; reassignedInvitations: number };
  try {
    moved = await deleteRole(session, roleId, deleteRoleRequest(formData));
  } catch (err) {
    return await localeRedirect(`${rolePath(roleId)}?error=${roleFailureCode(err)}`);
  }
  return await localeRedirect(
    `${LIST}?status=deleted&members=${moved.reassignedMembers}&invitations=${moved.reassignedInvitations}`,
  );
}
