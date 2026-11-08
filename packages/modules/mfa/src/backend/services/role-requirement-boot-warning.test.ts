import { describe, expect, it } from 'vitest';
import type { AdminRoleRecord } from '@endora-commerce/contracts';
import {
  describeUnenforceableRoleRequirements,
  warnOfUnenforceableRoleRequirements,
} from './role-requirement-boot-warning.js';

/**
 * Issue #349, M5 — without `MFA_SECRET_ENCRYPTION_KEY` no second factor can be
 * enrolled, so a role's requirement is not applied there (issue #948, owner
 * ruling Q6). The instance says so at every boot, at error level as the
 * platform-wide setting's report does, naming the roles and how many of their
 * holders sign in on their password alone.
 */
function role(code: string, requiresTwoFactor: boolean): AdminRoleRecord {
  return {
    id: `id-${code}`,
    code,
    name: code,
    permissions: [],
    requiresTwoFactor,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function deps(hasKey: boolean, roles: AdminRoleRecord[]) {
  const warnings: Array<[Record<string, unknown>, string]> = [];
  return {
    warnings,
    deps: {
      hasEncryptionKey: hasKey,
      listRoles: async () => roles,
      holdersOf: async (roleId: string) =>
        roleId === 'id-accounting' ? ['a1', 'a2', 'a3'] : roleId === 'id-admins' ? ['a4'] : [],
      activeAdminIds: async (ids: readonly string[]) => ids.filter((id) => id === 'a2'),
      error: (fields: Record<string, unknown>, message: string) => {
        warnings.push([fields, message]);
      },
    },
  };
}

describe('the boot warning for a role requirement no enrolment can meet', () => {
  it('names each flagged role and its unenrolled holders when the key is missing', async () => {
    const { deps: d, warnings } = deps(false, [
      role('accounting', true),
      role('sales', false),
      role('admins', true),
    ]);
    await warnOfUnenforceableRoleRequirements(d);
    expect(warnings).toHaveLength(1);
    const [fields, message] = warnings[0]!;
    expect(fields).toEqual({
      rolesRequiringTwoFactor: [
        { code: 'accounting', unenrolledAdministrators: 2 },
        { code: 'admins', unenrolledAdministrators: 1 },
      ],
    });
    expect(message).toContain('MFA_SECRET_ENCRYPTION_KEY');
    expect(message).toContain('accounting (2)');
    expect(message).toContain('admins (1)');
    expect(message).toContain('not applied');
    expect(message).not.toContain('cannot be completed');
  });

  it('says nothing when the key is configured', async () => {
    const { deps: d, warnings } = deps(true, [role('accounting', true)]);
    await warnOfUnenforceableRoleRequirements(d);
    expect(warnings).toEqual([]);
  });

  it('says nothing when no role requires a second factor', async () => {
    const { deps: d, warnings } = deps(false, [role('sales', false)]);
    await warnOfUnenforceableRoleRequirements(d);
    expect(warnings).toEqual([]);
  });

  it('describes nothing for an empty list', () => {
    expect(describeUnenforceableRoleRequirements([])).toBeNull();
  });
});
