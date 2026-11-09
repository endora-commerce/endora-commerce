import { describe, expect, it } from 'vitest';
import { CUSTOMER_ENCRYPTION_KEY_MISSING, ENCRYPTION_KEY_MISSING } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { MfaOrgPolicyService } from './mfa-org-policy-service.js';

/**
 * Issue #947 — an organization's policy cannot be switched on where no second
 * factor can be enrolled, on the terms #930 set for `mfa.admin.totp_enforced`:
 * off → on is refused; on → off, and `true` over `true`, are not. One rule for
 * both writes that reach it — the storefront administrator's and the Admin
 * UI's.
 */
function fakeEm(existing: { enforceTotp: boolean } | null) {
  const flushed: unknown[] = [];
  const em = {
    async findOne() {
      return existing;
    },
    create(_entity: unknown, data: Record<string, unknown>) {
      return { ...data };
    },
    persist(row: unknown) {
      flushed.push(row);
    },
    async flush() {
      flushed.push('flush');
    },
  };
  return { emFactory: () => em as never, flushed };
}

async function refusalOf(promise: Promise<unknown>): Promise<HttpError | null> {
  return promise.then(
    () => null,
    (error: unknown) => error as HttpError,
  );
}

describe('MfaOrgPolicyService without an encryption key (issue #947)', () => {
  it('refuses requiring a second factor, and writes nothing', async () => {
    const { emFactory, flushed } = fakeEm(null);
    const service = new MfaOrgPolicyService(emFactory, undefined, false);
    const error = await refusalOf(service.setEnforcement('org1', true, 'actor'));
    expect(error).toBeInstanceOf(HttpError);
    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe('MFA_ENFORCEMENT_UNAVAILABLE');
    expect(error!.details).toEqual({
      code: CUSTOMER_ENCRYPTION_KEY_MISSING,
      reason: ENCRYPTION_KEY_MISSING,
    });
    expect(flushed).toEqual([]);
  });

  it('refuses it over a stored policy that is off', async () => {
    const { emFactory } = fakeEm({ enforceTotp: false });
    const service = new MfaOrgPolicyService(emFactory, undefined, false);
    expect((await refusalOf(service.setEnforcement('org1', true, 'actor')))?.code).toBe(
      'MFA_ENFORCEMENT_UNAVAILABLE',
    );
  });

  it('accepts re-saving a policy that is already on', async () => {
    const { emFactory } = fakeEm({ enforceTotp: true });
    const service = new MfaOrgPolicyService(emFactory, undefined, false);
    await expect(service.setEnforcement('org1', true, 'actor')).resolves.toEqual({ enforceTotp: true });
  });

  it('always lets the policy be lifted', async () => {
    const { emFactory } = fakeEm({ enforceTotp: true });
    const service = new MfaOrgPolicyService(emFactory, undefined, false);
    await expect(service.setEnforcement('org1', false, 'actor')).resolves.toEqual({ enforceTotp: false });
  });

  it('lets it be switched on where a factor can be enrolled, which is the default', async () => {
    const { emFactory } = fakeEm(null);
    await expect(new MfaOrgPolicyService(emFactory).setEnforcement('org1', true, 'actor')).resolves.toEqual({
      enforceTotp: true,
    });
  });
});
