import { describe, expect, it } from 'vitest';
import { canManagePreference, type PreferenceActor } from './default-preference-authz.js';

describe('canManagePreference', () => {
  it('platform admin can manage any scope', () => {
    const actor: PreferenceActor = { kind: 'platform_admin' };
    expect(canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(true);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-9')).toBe(true);
  });

  it('customer manages only their own customer scope', () => {
    const actor: PreferenceActor = { kind: 'customer', customerAccountId: 'cust-1' };
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-1')).toBe(true);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-1')).toBe(false);
    expect(canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(false);
  });

  it('org admin manages own org and customers within it', () => {
    const actor: PreferenceActor = { kind: 'org_admin', organizationId: 'org-1' };
    expect(canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(true);
    expect(canManagePreference(actor, { scope: 'organization', scopeId: 'org-2' }, null)).toBe(false);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-1')).toBe(true);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-2')).toBe(false);
  });

  it('salesperson manages assigned orgs and their customers only', () => {
    const actor: PreferenceActor = {
      kind: 'salesperson',
      assignedOrganizationIds: ['org-1', 'org-3'],
    };
    expect(canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(true);
    expect(canManagePreference(actor, { scope: 'organization', scopeId: 'org-2' }, null)).toBe(false);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-3')).toBe(true);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-2')).toBe(false);
    expect(canManagePreference(actor, { scope: 'customer', scopeId: 'cust-3' }, null)).toBe(false);
  });
});
