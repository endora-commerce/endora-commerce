import { describe, expect, it } from 'vitest';
import { actorFromContext, resolveCommandActor } from '@endora-commerce/platform/commands';
import {
  MissingTenantContextError,
  runWithTenantContext,
  runWithoutTenantContext,
  type TenantContext,
} from '../../../src/tenancy/tenant-context.js';

describe('command actor mapping (feature 054, FR-001 / Principle XI)', () => {
  it('maps a plain admin actor to its admin id, no impersonation', () => {
    const ctx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };
    expect(actorFromContext(ctx)).toEqual({
      actorAdminUserId: 'admin-1',
      impersonatedCustomerAccountId: null,
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
      kind: 'customer',
    });
  });

  it('maps a system actor to a null admin id', () => {
    const ctx: TenantContext = { mode: 'system', actor: { kind: 'system' }, reason: 'worker' };
    expect(actorFromContext(ctx)).toEqual({
      actorAdminUserId: null,
      impersonatedCustomerAccountId: null,
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
});
