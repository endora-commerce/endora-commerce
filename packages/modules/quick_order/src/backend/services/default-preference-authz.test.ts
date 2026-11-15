import { describe, expect, it } from 'vitest';
import { canManagePreference, canReadPreference, type PreferenceActor } from './default-preference-authz.js';

describe('canManagePreference', () => {
  it('platform admin can manage any scope', async () => {
    const actor: PreferenceActor = { kind: 'platform_admin' };
    expect(await canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(true);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-9')).toBe(true);
  });

  it('customer manages only their own customer scope', async () => {
    const actor: PreferenceActor = { kind: 'customer', customerAccountId: 'cust-1' };
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-1')).toBe(true);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-1')).toBe(false);
    expect(await canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(false);
  });

  it('an Organization administrator manages own org and customers within it (FR-012)', async () => {
    const actor: PreferenceActor = { kind: 'administrator', organizationId: 'org-1' };
    expect(await canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(true);
    expect(await canManagePreference(actor, { scope: 'organization', scopeId: 'org-2' }, null)).toBe(false);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-1')).toBe(true);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-2')).toBe(false);
  });

  // Issue #305 — the actor carries the reach question; `org-2` stands for an
  // organisation governed by another representative.
  it('salesperson manages the orgs in their reach and their customers only', async () => {
    const actor: PreferenceActor = {
      kind: 'salesperson',
      reaches: async (organizationId) => organizationId !== 'org-2',
    };
    expect(await canManagePreference(actor, { scope: 'organization', scopeId: 'org-1' }, null)).toBe(true);
    expect(await canManagePreference(actor, { scope: 'organization', scopeId: 'org-2' }, null)).toBe(false);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-3')).toBe(true);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-2')).toBe(false);
    expect(await canManagePreference(actor, { scope: 'customer', scopeId: 'cust-3' }, null)).toBe(false);
  });
});

// Issue #359 — a member reads the organization defaults they inherit, so the
// preferences page can say what "use the organization default" stands for.
// Reading is wider than managing by exactly that one row.
describe('canReadPreference', () => {
  it('a customer reads their own scope and their own organization scope, nothing else', async () => {
    const actor: PreferenceActor = { kind: 'customer', customerAccountId: 'cust-1' };
    expect(await canReadPreference(actor, { scope: 'customer', scopeId: 'cust-1' }, 'org-1', 'org-1')).toBe(true);
    expect(await canReadPreference(actor, { scope: 'organization', scopeId: 'org-1' }, null, 'org-1')).toBe(true);
    expect(await canReadPreference(actor, { scope: 'organization', scopeId: 'org-2' }, null, 'org-1')).toBe(false);
    expect(await canReadPreference(actor, { scope: 'customer', scopeId: 'cust-2' }, 'org-1', 'org-1')).toBe(false);
  });

  it('a customer with no organization reads no organization scope', async () => {
    const actor: PreferenceActor = { kind: 'customer', customerAccountId: 'cust-1' };
    expect(await canReadPreference(actor, { scope: 'organization', scopeId: '' }, null, null)).toBe(false);
  });

  it('reads whatever the actor may manage', async () => {
    const actor: PreferenceActor = { kind: 'administrator', organizationId: 'org-1' };
    expect(await canReadPreference(actor, { scope: 'customer', scopeId: 'cust-3' }, 'org-1', 'org-1')).toBe(true);
    expect(await canReadPreference(actor, { scope: 'organization', scopeId: 'org-2' }, null, 'org-1')).toBe(false);
  });
});
