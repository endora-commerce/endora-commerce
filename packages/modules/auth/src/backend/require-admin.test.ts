/**
 * The admin guard refuses a session whose account may no longer act.
 *
 * A session row can outlive the account it was minted for — deactivated,
 * deleted, or removed by a write that did not revoke. The guard is the one
 * place every admin route passes through, so it is where that is caught: such
 * a request is **not signed in** (401), on a route with a permission code and
 * on a route without one, and an active account missing a code is still 403.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AdminPermissionChecker } from '@endora-commerce/platform/kernel';
import { createRequireAdmin, createRequireAdminAny } from './require-admin.js';

interface Calls {
  hasPermission: number;
  isActiveAdministrator: number;
}

function checker(state: { active: boolean; permitted: readonly string[] }): {
  permissionService: AdminPermissionChecker;
  calls: Calls;
} {
  const calls: Calls = { hasPermission: 0, isActiveAdministrator: 0 };
  return {
    calls,
    permissionService: {
      // As `admin_roles` answers: an inactive account holds nothing.
      hasPermission: async (_id, code) => {
        calls.hasPermission += 1;
        return state.active && state.permitted.includes(code);
      },
      isActiveAdministrator: async () => {
        calls.isActiveAdministrator += 1;
        return state.active;
      },
    },
  };
}

/** A request the plugin resolved to an admin; no `scopeRequestToActor` state is needed. */
function adminRequest(): FastifyRequest {
  return { actor: { kind: 'admin', adminUserId: 'a1' }, adminActor: null } as unknown as FastifyRequest;
}

const reply = {} as FastifyReply;

describe('createRequireAdmin — the account behind the session', () => {
  it('refuses a session of an account that is not active with 401, on a route with no code', async () => {
    const { permissionService } = checker({ active: false, permitted: [] });
    await expect(
      createRequireAdmin({ permissionService })()(adminRequest(), reply),
    ).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('refuses it with 401, not 403, on a route with a code', async () => {
    const { permissionService } = checker({ active: false, permitted: ['orders:read'] });
    await expect(
      createRequireAdmin({ permissionService })('orders:read')(adminRequest(), reply),
    ).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('accepts an active account on a route with no code', async () => {
    const { permissionService } = checker({ active: true, permitted: [] });
    await expect(
      createRequireAdmin({ permissionService })()(adminRequest(), reply),
    ).resolves.toBeUndefined();
  });

  it('answers 403 to an active account missing the code', async () => {
    const { permissionService } = checker({ active: true, permitted: [] });
    await expect(
      createRequireAdmin({ permissionService })('orders:read')(adminRequest(), reply),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('does not read the account a second time when the permission is granted', async () => {
    const { permissionService, calls } = checker({ active: true, permitted: ['orders:read'] });
    await createRequireAdmin({ permissionService })('orders:read')(adminRequest(), reply);
    expect(calls).toEqual({ hasPermission: 1, isActiveAdministrator: 0 });
  });

  it('still refuses a request with no admin session at all', async () => {
    const { permissionService, calls } = checker({ active: true, permitted: [] });
    const anonymous = { actor: { kind: 'anonymous' }, adminActor: null } as unknown as FastifyRequest;
    await expect(
      createRequireAdmin({ permissionService })()(anonymous, reply),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(calls.isActiveAdministrator).toBe(0);
  });
});

describe('createRequireAdminAny — the account behind the session', () => {
  it('refuses a session of an account that is not active with 401', async () => {
    const { permissionService } = checker({ active: false, permitted: ['a:read'] });
    await expect(
      createRequireAdminAny({ permissionService })(['a:read', 'b:read'])(adminRequest(), reply),
    ).rejects.toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('answers 403 to an active account holding none of the codes', async () => {
    const { permissionService } = checker({ active: true, permitted: [] });
    await expect(
      createRequireAdminAny({ permissionService })(['a:read', 'b:read'])(adminRequest(), reply),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('accepts an active account holding one of them', async () => {
    const { permissionService } = checker({ active: true, permitted: ['b:read'] });
    await expect(
      createRequireAdminAny({ permissionService })(['a:read', 'b:read'])(adminRequest(), reply),
    ).resolves.toBeUndefined();
  });
});
