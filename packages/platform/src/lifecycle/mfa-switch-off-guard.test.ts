import { afterEach, describe, expect, it } from 'vitest';
import type { MfaDeactivationGuardPort } from '@endora-commerce/contracts';
import { registryCache } from '../kernel/lifecycle/registry-cache.js';
import { HttpError } from '../http/error-envelope.js';
import { assertMfaMayBeSwitchedOff } from './routes.admin.js';

/**
 * Issue #349 — the switch-off refusal names what keeps a second factor
 * required: the platform-wide setting, the roles that require one, or both.
 * `details.code` keys the sentence (`errors.MFA_DEACTIVATION_BLOCKED.<token>`)
 * and `details.roles` fills it; `details.roleCodes` is the list a client reads.
 */
function guardOf(setting: boolean, roleCodes: string[]): MfaDeactivationGuardPort {
  return {
    isAdminSecondFactorRequired: async () => setting || roleCodes.length > 0,
    requirement: async () => ({ setting, roleCodes }),
  };
}

async function refusalOf(guard: MfaDeactivationGuardPort): Promise<HttpError | null> {
  try {
    await assertMfaMayBeSwitchedOff('mfa', false, guard);
    return null;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
}

describe('assertMfaMayBeSwitchedOff — what keeps the second factor required', () => {
  afterEach(() => registryCache.__setEnabledForTesting([]));

  it('names the setting alone with no token, the sentence it always had', async () => {
    registryCache.__setEnabledForTesting(['mfa']);
    const refusal = await refusalOf(guardOf(true, []));
    expect(refusal?.code).toBe('MFA_DEACTIVATION_BLOCKED');
    expect(refusal?.details).toEqual({
      moduleId: 'mfa',
      setting: 'mfa.admin.totp_enforced',
      roleCodes: [],
    });
  });

  it('names the roles when only roles require it', async () => {
    registryCache.__setEnabledForTesting(['mfa']);
    const refusal = await refusalOf(guardOf(false, ['accounting', 'admins']));
    expect(refusal?.details).toEqual({
      moduleId: 'mfa',
      setting: 'mfa.admin.totp_enforced',
      roleCodes: ['accounting', 'admins'],
      roles: 'accounting, admins',
      code: 'role_requirement',
    });
    expect(refusal?.message).toContain('accounting, admins');
  });

  it('names both when both require it', async () => {
    registryCache.__setEnabledForTesting(['mfa']);
    const refusal = await refusalOf(guardOf(true, ['accounting']));
    expect(refusal?.details).toMatchObject({
      roleCodes: ['accounting'],
      roles: 'accounting',
      code: 'setting_and_role_requirement',
    });
    expect(refusal?.message).toContain('mfa.admin.totp_enforced');
    expect(refusal?.message).toContain('accounting');
  });

  it('lets the switch-off through when nothing requires a second factor', async () => {
    registryCache.__setEnabledForTesting(['mfa']);
    expect(await refusalOf(guardOf(false, []))).toBeNull();
  });

  it('falls back to the yes/no answer for a guard that cannot name its sources', async () => {
    registryCache.__setEnabledForTesting(['mfa']);
    const refusal = await refusalOf({ isAdminSecondFactorRequired: async () => true });
    expect(refusal?.details).toEqual({ moduleId: 'mfa', setting: 'mfa.admin.totp_enforced' });
  });
});
