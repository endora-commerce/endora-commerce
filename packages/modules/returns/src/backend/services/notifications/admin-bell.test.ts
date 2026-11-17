import { describe, expect, it, vi } from 'vitest';
import type { AdminUserRecord, RecordAdminNotificationInput } from '@endora-commerce/contracts';
import { createAdminBell, type BellCase } from './admin-bell.js';

/**
 * `specs/180-off-platform-complaints/` T015 (FR-A03, FR-A04, research R-3): one bell
 * entry per active administrator holding `returns:read` — the wildcard role
 * included — naming neither the customer nor the organization.
 */
const admin = (id: string, over: Partial<AdminUserRecord> = {}): AdminUserRecord => ({
  id,
  email: `${id}@admin.example`,
  firstName: id,
  lastName: 'Admin',
  adminRoleId: 'role',
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
  preferredLanguage: null,
  avatarAssetId: null,
  bio: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...over,
});

const PERMISSIONS: Record<string, string[]> = {
  reader: ['returns:read'],
  owner: ['*'],
  writer: ['returns:read', 'returns:write'],
  other: ['orders:read'],
  inactive: ['returns:read'],
};

const CASE: BellCase = {
  id: '3f9a21c0-7b1e-4d2a-9c3b-0123456789ab',
  kind: 'complaint',
  reference: '#3F9A21C0',
  submittedAt: new Date('2026-11-13T09:30:00Z'),
};

function harness(present = true) {
  const recorded: RecordAdminNotificationInput[] = [];
  const deps = {
    isPresent: vi.fn(() => present),
    adminUsers: {
      listAll: vi.fn(async () => [
        admin('reader'),
        admin('owner'),
        admin('writer'),
        admin('other'),
        admin('inactive', { status: 'inactive' }),
      ]),
    },
    permissions: { listPermissions: vi.fn(async (id: string) => PERMISSIONS[id] ?? []) },
    notifications: {
      record: vi.fn(async (input: RecordAdminNotificationInput) => {
        recorded.push(input);
        return { id: `n-${recorded.length}` } as never;
      }),
    },
  };
  return { deps, recorded, bell: createAdminBell(deps) };
}

describe('the admin bell for a new case', () => {
  it('tells every active administrator holding returns:read, the wildcard included, and nobody else', async () => {
    const { bell, recorded } = harness();
    const outcome = await bell.announceNewCase(CASE, { done: new Set() });
    expect(outcome).toEqual({ status: 'recorded', adminUserIds: ['reader', 'owner', 'writer'] });
    expect(recorded.map((r) => r.targetAdminUserId)).toEqual(['reader', 'owner', 'writer']);
    for (const entry of recorded) {
      expect(entry.audience).toBe('admin_user');
      expect(entry.linkPath).toBe(`/returns/${CASE.id}`);
      expect(entry.subjectType).toBe('return_case');
      expect(entry.subjectId).toBe(CASE.id);
    }
  });

  it('carries translatable title and body in the returns scope, naming the reference and no customer', async () => {
    const { bell, recorded } = harness();
    await bell.announceNewCase(CASE, { done: new Set() });
    const entry = recorded[0]!;
    expect(entry.titleMessage).toEqual({ scope: 'returns', key: 'notifications.newCase.title.complaint', params: { reference: '#3F9A21C0' } });
    expect(entry.bodyMessage?.scope).toBe('returns');
    expect(entry.bodyMessage?.key).toBe('notifications.newCase.body');
    expect(entry.title).toContain('#3F9A21C0');
    expect(entry.title.toLowerCase()).toContain('complaint');
    expect(entry.body).toContain('2026-11-13');
    // The bell must not disclose what an organization-scoped reader cannot open (R-3).
    expect(JSON.stringify(entry)).not.toMatch(/organization|customer/i);
  });

  it('skips the administrators a recorded attempt already told', async () => {
    const { bell, recorded } = harness();
    const outcome = await bell.announceNewCase(CASE, { done: new Set(['bell:reader', 'bell:owner']) });
    expect(recorded.map((r) => r.targetAdminUserId)).toEqual(['writer']);
    expect(outcome).toEqual({ status: 'recorded', adminUserIds: ['writer'] });
  });

  it('with admin_notifications absent, asks nothing and answers not_present', async () => {
    const { bell, deps } = harness(false);
    expect(await bell.announceNewCase(CASE, { done: new Set() })).toEqual({ status: 'not_present' });
    expect(deps.notifications.record).not.toHaveBeenCalled();
    expect(deps.adminUsers.listAll).not.toHaveBeenCalled();
  });
});

/**
 * `specs/181-guest-complaints/` T027, T033 (FR-051, research R-10): a guest's case has
 * no organization, so only an administrator who reaches every organization can open it.
 * Its bell entry goes to those alone; any other answer — a narrower reach, an
 * unresolved one, a failing port, no port at all — leaves the administrator out.
 */
describe('the admin bell for a guest’s case', () => {
  const GUEST_CASE: BellCase = { ...CASE, guest: true };

  function scoped(answers: Record<string, unknown>) {
    const h = harness();
    const tenantScope = {
      resolveForAdmin: vi.fn(async (id: string) => {
        const answer = answers[id];
        if (answer instanceof Error) throw answer;
        return answer as never;
      }),
    };
    return { ...h, tenantScope, bell: createAdminBell({ ...h.deps, tenantScope }) };
  }

  it('tells only the readers whose reach is every organization', async () => {
    const { bell, recorded } = scoped({
      reader: { allowAll: true },
      owner: { allowAll: false, reach: 'excluding', loadReach: async () => ({ excludedOrganizationIds: [], assignedOrganizationIds: [] }) },
      writer: { allowAll: false, allowedOrganizationIds: ['org-1'] },
    });
    const outcome = await bell.announceNewCase(GUEST_CASE, { done: new Set() });
    expect(recorded.map((r) => r.targetAdminUserId)).toEqual(['reader']);
    expect(outcome).toEqual({ status: 'recorded', adminUserIds: ['reader'] });
  });

  it('fails closed on a throwing or unresolved reach', async () => {
    const { bell, recorded } = scoped({
      reader: new Error('organizations is off'),
      owner: { allowAll: false, allowedOrganizationIds: [], unresolved: new Error('no role') },
      writer: { allowAll: true },
    });
    await bell.announceNewCase(GUEST_CASE, { done: new Set() });
    expect(recorded.map((r) => r.targetAdminUserId)).toEqual(['writer']);
  });

  it('tells nobody when no reach can be asked', async () => {
    const { bell, recorded } = harness();
    expect(await bell.announceNewCase(GUEST_CASE, { done: new Set() })).toEqual({ status: 'recorded', adminUserIds: [] });
    expect(recorded).toEqual([]);
  });

  it('asks no reach for a customer’s case', async () => {
    const { bell, recorded, tenantScope } = scoped({});
    await bell.announceNewCase(CASE, { done: new Set() });
    expect(recorded.map((r) => r.targetAdminUserId)).toEqual(['reader', 'owner', 'writer']);
    expect(tenantScope.resolveForAdmin).not.toHaveBeenCalled();
  });
});
