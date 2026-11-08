import type { AdminRoleRecord } from '@endora-commerce/contracts';

/** One flagged role and how many of its holders have no active enrolment. */
export interface UnenforceableRoleRequirement {
  readonly code: string;
  readonly unenrolledAdministrators: number;
}

export interface RoleRequirementBootWarningDeps {
  readonly hasEncryptionKey: boolean;
  readonly listRoles: () => Promise<readonly AdminRoleRecord[]>;
  /** The ids of the live administrators holding a role. */
  readonly holdersOf: (roleId: string) => Promise<readonly string[]>;
  /** The subset of these administrators with an active enrolment. */
  readonly activeAdminIds: (adminUserIds: readonly string[]) => Promise<readonly string[]>;
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * What an operator is told at boot when roles require a second factor that
 * this instance cannot enrol, or `null` when no role does.
 */
export function describeUnenforceableRoleRequirements(
  roles: readonly UnenforceableRoleRequirement[],
): string | null {
  if (roles.length === 0) return null;
  const named = roles.map((role) => `${role.code} (${role.unenrolledAdministrators})`).join(', ');
  return (
    'MFA_SECRET_ENCRYPTION_KEY is not set, so no second factor can be enrolled, yet these roles ' +
    `require one; the number of their administrators with no enrolled factor is in brackets: ${named}. ` +
    'Those administrators are sent to a setup step at sign-in that cannot be completed. Set ' +
    'MFA_SECRET_ENCRYPTION_KEY, or turn off "Requires two-step verification" on these roles ' +
    '(on the Roles screen as an administrator whose role does not require it, or with ' +
    '`update admin_roles set requires_two_factor = false where code = \'<code>\'`).'
  );
}

/**
 * Issue #349, M5 — without an encryption key this module composes but serves
 * no enrolment route, while `beginLogin` still answers `setup` for an
 * administrator a role binds. That is a lockout for every unenrolled holder,
 * so it is reported at every boot until it is gone, naming the roles and how
 * many holders each has without a factor. The role write already refuses the
 * flag in this state; this is for a flag set before the key went, or before
 * the refusal existed.
 */
export async function warnOfUnenforceableRoleRequirements(
  deps: RoleRequirementBootWarningDeps,
): Promise<void> {
  if (deps.hasEncryptionKey) return;
  const flagged = (await deps.listRoles()).filter((role) => role.requiresTwoFactor);
  if (flagged.length === 0) return;
  const roles: UnenforceableRoleRequirement[] = [];
  for (const role of flagged) {
    const holders = await deps.holdersOf(role.id);
    const enrolled = new Set(holders.length === 0 ? [] : await deps.activeAdminIds(holders));
    roles.push({
      code: role.code,
      unenrolledAdministrators: holders.filter((id) => !enrolled.has(id)).length,
    });
  }
  const message = describeUnenforceableRoleRequirements(roles);
  if (message !== null) deps.warn({ rolesRequiringTwoFactor: roles }, message);
}
