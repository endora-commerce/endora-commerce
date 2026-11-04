import { describe, expect, it } from 'vitest';
import { actorFromContext, resolveCommandActor } from './actor.js';
import { withSystemScope, withSystemScopeActingFor } from '../tenancy/escape-hatch.js';
import { getTenantContext } from '../tenancy/tenant-context.js';
import {
  MissingTenantContextError,
  runWithTenantContext,
  runWithoutTenantContext,
  type TenantContext,
} from '../tenancy/tenant-context.js';

describe('command actor mapping (feature 054, FR-001 / Principle XI)', () => {
  it('maps a plain admin actor to its admin id, no impersonation', () => {
    const ctx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
    expect(actorFromContext(ctx)).toEqual({
      actorAdminUserId: 'admin-1',
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: null,
      kind: 'admin',
    });
  });

  it('maps an impersonation session to real admin + impersonated customer (US1 scenario 4)', () => {
    const ctx: TenantContext = {
      mode: 'single-org',
      organizationId: 'org-1',
      customerAccountId: 'cust-1',
      actor: { kind: 'customer', id: 'cust-1' },
      impersonation: { realAdminUserId: 'admin-9', impersonatedCustomerAccountId: 'cust-1' },
    };
    expect(actorFromContext(ctx)).toEqual({
      actorAdminUserId: 'admin-9',
      impersonatedCustomerAccountId: 'cust-1',
      // The impersonated customer did not act; the administrator did (R-21, SC-006).
      actorCustomerAccountId: null,
      kind: 'customer',
    });
  });

  it('maps a customer acting for themselves onto actorCustomerAccountId (feature 170, R-21)', () => {
    const ctx: TenantContext = {
      mode: 'single-org',
      organizationId: 'org-1',
      customerAccountId: 'cust-3',
      actor: { kind: 'customer', id: 'cust-3' },
    };
    expect(actorFromContext(ctx)).toEqual({
      actorAdminUserId: null,
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: 'cust-3',
      kind: 'customer',
    });
  });

  it('maps a system actor to a null admin id', () => {
    const ctx: TenantContext = { mode: 'system', actor: { kind: 'system' }, reason: 'worker' };
    expect(actorFromContext(ctx)).toEqual({
      actorAdminUserId: null,
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: null,
      kind: 'system',
    });
  });

  it('resolveCommandActor reads the ambient context', async () => {
    const ctx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-2' } };
    await runWithTenantContext(ctx, async () => {
      expect(resolveCommandActor().actorAdminUserId).toBe('admin-2');
    });
  });

  it('fails closed: resolveCommandActor throws with no ambient context', () => {
    runWithoutTenantContext(() => {
      expect(() => resolveCommandActor()).toThrow(MissingTenantContextError);
    });
  });

  it('a worker acting for the admin who queued the work records that admin (spec 163, S-W2)', async () => {
    const actor = await withSystemScope('worker', () =>
      withSystemScopeActingFor('admin-7', 'bulk operation op-1 for its requester', async () => {
        expect(getTenantContext()?.mode).toBe('system');
        return resolveCommandActor();
      }),
    );
    expect(actor).toEqual({
      actorAdminUserId: 'admin-7',
      impersonatedCustomerAccountId: null,
      actorCustomerAccountId: null,
      kind: 'admin',
    });
  });

  it('refuses to act for nobody', async () => {
    await expect(withSystemScopeActingFor('', 'reason', async () => 1)).rejects.toThrow();
    await expect(withSystemScopeActingFor('admin-7', ' ', async () => 1)).rejects.toThrow();
  });
});
