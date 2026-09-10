import { describe, expect, it } from 'vitest';
import type {
  AdminUserRecord,
  CustomerAccountRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  createAccountEmailResolver,
  createAccountPasswordVerifier,
  createOrganizationAdminResolver,
  createOrganizationCustomerIdsResolver,
} from './account-identity.js';

/**
 * `specs/110-instance-repository/` T118c — the four `MfaActorBridge` members
 * that were only ever port reads, proven over stubs with nothing composed.
 *
 * Deliberately not driven through a composed server: this file is a module
 * package's own, and reaching `@endora-commerce/platform/composition` from one
 * is a host-internal subpath `check:platform-surface` cannot refuse in a
 * `.test.ts` (`collectPlatformSurfaceSources` drops them). The half that needs
 * the wiring is `backend/test/integration/mfa/account-identity-wiring.test.ts`.
 */

class DisabledOwner extends Error {}

function customer(overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id: 'c-1',
    email: 'buyer@example.com',
    organizationId: 'org-1',
    role: 'organization_admin',
    ...overrides,
  } as CustomerAccountRecord;
}

describe('createOrganizationAdminResolver', () => {
  it('answers the caller organisation and the acting account id', async () => {
    const resolve = createOrganizationAdminResolver({
      findById: async () => customer(),
    });

    await expect(resolve('c-1')).resolves.toEqual({ organizationId: 'org-1', actor: 'c-1' });
  });

  it.each([
    ['no such account', null],
    ['a member who is not an organisation administrator', { ...customer(), role: 'buyer' }],
    // `CustomerAccountRecord.organizationId` is `string` since D-178, so this
    // case is the bridge's own guard preserved rather than a reachable state.
    ['an administrator with no organisation', { ...customer(), organizationId: null }],
  ])('refuses %s with 403', async (_label, record) => {
    const resolve = createOrganizationAdminResolver({
      findById: async () => record as CustomerAccountRecord | null,
    });

    await expect(resolve('c-1')).rejects.toMatchObject({
      statusCode: 403,
      message: 'Organization administrator role required.',
    });
  });

  it('lets a disabled owner through rather than reporting "not an administrator"', async () => {
    const resolve = createOrganizationAdminResolver({
      findById: async () => {
        throw new DisabledOwner('MODULE_DISABLED');
      },
    });

    // The failure mode a `catch` here would produce is a 403 — indistinguishable
    // from a real refusal, and on a policy write.
    await expect(resolve('c-1')).rejects.toBeInstanceOf(DisabledOwner);
  });
});

describe('createOrganizationCustomerIdsResolver', () => {
  it('maps the organisation members to their ids', async () => {
    const resolve = createOrganizationCustomerIdsResolver({
      listByOrganization: async (organizationId) => {
        expect(organizationId).toBe('org-1');
        return [customer({ id: 'c-1' }), { ...customer(), id: 'c-2' }] as CustomerAccountRecord[];
      },
    });

    await expect(resolve('org-1')).resolves.toEqual(['c-1', 'c-2']);
  });

  it('answers an empty list for an organisation with no members', async () => {
    const resolve = createOrganizationCustomerIdsResolver({ listByOrganization: async () => [] });

    await expect(resolve('org-1')).resolves.toEqual([]);
  });
});

describe('createAccountEmailResolver', () => {
  const admins = {
    findById: async (id: string) =>
      id === 'a-1' ? ({ id, email: 'admin@example.com' } as AdminUserRecord) : null,
  };
  const customers = {
    findById: async (id: string) =>
      id === 'c-1' ? customer({ id }) : null,
  };

  it('reads the admin surface from `admin_users`', async () => {
    const resolve = createAccountEmailResolver(customers, admins);
    await expect(resolve('admin', 'a-1')).resolves.toBe('admin@example.com');
  });

  it('reads the customer surface from `customer_accounts`', async () => {
    const resolve = createAccountEmailResolver(customers, admins);
    await expect(resolve('customer', 'c-1')).resolves.toBe('buyer@example.com');
  });

  it('answers null for a subject neither owner resolves', async () => {
    const resolve = createAccountEmailResolver(customers, admins);
    await expect(resolve('admin', 'nobody')).resolves.toBeNull();
    await expect(resolve('customer', 'nobody')).resolves.toBeNull();
  });

  it('does not cross the two surfaces', async () => {
    const resolve = createAccountEmailResolver(customers, admins);
    // An admin id must not resolve against the customer table, or an admin's
    // authenticator entry could be labelled with somebody else's address.
    await expect(resolve('customer', 'a-1')).resolves.toBeNull();
  });
});

describe('createAccountPasswordVerifier', () => {
  const customers = {
    verifyPassword: async (id: string, password: string) => id === 'c-1' && password === 'right',
  };
  const admins = {
    verifyPassword: async (id: string, password: string) => id === 'a-1' && password === 'right',
  };

  it('verifies an admin against `admin_users`', async () => {
    const verify = createAccountPasswordVerifier(customers, admins);
    await expect(verify('admin', 'a-1', 'right')).resolves.toBe(true);
    await expect(verify('admin', 'a-1', 'wrong')).resolves.toBe(false);
  });

  it('verifies a customer against `customer_accounts`', async () => {
    const verify = createAccountPasswordVerifier(customers, admins);
    await expect(verify('customer', 'c-1', 'right')).resolves.toBe(true);
    await expect(verify('customer', 'c-1', 'wrong')).resolves.toBe(false);
  });

  it('does not cross the two surfaces', async () => {
    const verify = createAccountPasswordVerifier(customers, admins);
    await expect(verify('customer', 'a-1', 'right')).resolves.toBe(false);
    await expect(verify('admin', 'c-1', 'right')).resolves.toBe(false);
  });

  it('lets a disabled owner through rather than answering "the password is wrong"', async () => {
    const verify = createAccountPasswordVerifier(
      {
        verifyPassword: async () => {
          throw new DisabledOwner('MODULE_DISABLED');
        },
      },
      admins,
    );

    // A `catch` here would answer 401 `INVALID_CREDENTIALS` for an absent owner
    // — a lie about the credential, and the shape that hides a broken seam.
    await expect(verify('customer', 'c-1', 'right')).rejects.toBeInstanceOf(DisabledOwner);
  });
});

describe('the refusals are HTTP errors the envelope can carry', () => {
  it('throws `HttpError`, not a bare Error', async () => {
    const resolve = createOrganizationAdminResolver({ findById: async () => null });
    await expect(resolve('c-1')).rejects.toBeInstanceOf(HttpError);
  });
});
