'use server';

import { createRole, deleteRole, updateRole } from '../../../../lib/api/organization';
import { getSessionCookie } from '../../../../lib/session';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import {
  createRoleRequest,
  deleteRoleRequest,
  roleIdOf,
  updateRoleRequest,
  type RoleFormState,
} from '../../../../lib/account/organization-roles';
import { roleFailureCode } from '../../../../lib/account/organization-role-failure';

/**
 * The administrator's role writes (`specs/170-organization-roles/`, FR-004,
 * FR-024; `contracts/storefront-api.md` §2). Each success redirects to the
 * roles list with `?status=…`. A refused create or edit answers its code as
 * `useActionState` state, so the client form keeps what was typed and no form
 * state is put in a URL (owner ruling on PR #715); a refused deletion redirects
 * back to the role with `?error=<code>`. The role, the Organization and the
 * version are the API's to check (`lib/account/organization-roles.ts` says why
 * a code and not a sentence).
 */

const LIST = '/organization/roles';

function rolePath(roleId: string): string {
  return `${LIST}/${encodeURIComponent(roleId)}`;
}

export async function createRoleAction(_previous: RoleFormState, formData: FormData): Promise<RoleFormState> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await createRole(session, createRoleRequest(formData));
  } catch (err) {
    return { error: roleFailureCode(err) };
  }
  return await localeRedirect(`${LIST}?status=created`);
}

export async function updateRoleAction(_previous: RoleFormState, formData: FormData): Promise<RoleFormState> {
  const roleId = roleIdOf(formData);
  if (!roleId) return await localeRedirect(LIST);
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  try {
    await updateRole(session, roleId, updateRoleRequest(formData));
  } catch (err) {
    // A stale save keeps the form as typed; the version it read stays, so it
    // cannot be saved over the other change until the role is reloaded (R-29).
    return { error: roleFailureCode(err) };
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
