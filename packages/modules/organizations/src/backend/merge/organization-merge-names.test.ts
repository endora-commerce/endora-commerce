import { describe, expect, it, vi } from 'vitest';
import { organizationMergeViewSchema, type RecordMergeRecord } from '@endora-commerce/contracts';
import { adminDisplayNames, organizationMergeViews } from './organization-merge-names.js';

/**
 * `specs/192-organization-merge/` T076 — the merge as the admin routes answer
 * it: the record with both Organizations' names and the starting
 * administrator's beside their ids, read once for a whole list.
 */

const A = '00000000-0000-4000-8000-00000000c001';
const B = '00000000-0000-4000-8000-00000000c002';
const ADMIN = '00000000-0000-4000-8000-00000000c003';

function record(overrides: Partial<RecordMergeRecord> = {}): RecordMergeRecord {
  return {
    id: '00000000-0000-4000-8000-00000000c004',
    hostType: 'organization',
    survivorId: A,
    loserId: B,
    state: 'running',
    version: 1,
    source: null,
    actorKind: 'admin',
    actorAdminUserId: ADMIN,
    startedAt: '2026-11-25T10:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    needsAttentionAt: null,
    lastErrorCode: null,
    fieldChoices: {},
    customFieldChoices: {},
    steps: [],
    ...overrides,
  };
}

describe('organizationMergeViews', () => {
  it('adds the names beside the ids, in one read of each kind for the whole list', async () => {
    const organizationNames = vi.fn(async () => new Map([[A, 'Acme'], [B, 'Acme (dup)']]));
    const adminNames = vi.fn(async () => new Map([[ADMIN, 'Anna Nowak']]));
    const views = await organizationMergeViews([record(), record({ actorKind: 'system', actorAdminUserId: null })], {
      organizationNames,
      adminNames,
    });
    expect(organizationNames).toHaveBeenCalledTimes(1);
    expect(adminNames).toHaveBeenCalledWith([ADMIN]);
    expect(views[0]).toMatchObject({ survivorName: 'Acme', loserName: 'Acme (dup)', actorName: 'Anna Nowak' });
    expect(views[1]).toMatchObject({ actorName: null });
    for (const view of views) expect(organizationMergeViewSchema.parse(view)).toEqual(view);
  });

  it('answers null for a name it cannot read, so the screen shows the id', async () => {
    const [view] = await organizationMergeViews([record()], {
      organizationNames: async () => new Map(),
      adminNames: async () => new Map(),
    });
    expect(view).toMatchObject({ survivorName: null, loserName: null, actorName: null });
  });

  it('reads nothing for an empty list', async () => {
    const organizationNames = vi.fn();
    expect(await organizationMergeViews([], { organizationNames, adminNames: vi.fn() })).toEqual([]);
    expect(organizationNames).not.toHaveBeenCalled();
  });
});

describe('adminDisplayNames', () => {
  it('names an administrator by first and last name, else by e-mail', async () => {
    const names = await adminDisplayNames(
      {
        findByIds: async () =>
          [
            { id: 'x', firstName: 'Anna', lastName: 'Nowak', email: 'anna@example.com' },
            { id: 'y', firstName: '', lastName: '', email: 'ops@example.com' },
          ] as never,
      },
      ['x', 'y', 'x'],
    );
    expect(Object.fromEntries(names)).toEqual({ x: 'Anna Nowak', y: 'ops@example.com' });
  });
});
