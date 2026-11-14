import { describe, expect, it, vi } from 'vitest';
import type { AdminUserReadPort, AdminUserRecord, PermissionReadPort } from '@endora-commerce/contracts';
import { MENTIONABLE_LIMIT, ProjectMentionService } from './mention-service.js';
import type { ProjectNotifier } from './project-notifier.js';
import type { VisibleProjectRow } from './project-access.js';

/**
 * Issue #461 — `GET /projects/lookups/mentionable` asks who may see the
 * Project once, for every candidate together (`ProjectAccess.canSeeAsMany`),
 * rather than `canSeeAs` per person; what it offers is unchanged: the people
 * who may see it, in name order, at most {@link MENTIONABLE_LIMIT}.
 */
const PROJECT_ID = '00000000-0000-4000-8000-0000000000a1';
const adminId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function person(n: number, overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id: adminId(n),
    email: `person-${String(n).padStart(2, '0')}@example.com`,
    firstName: 'Person',
    lastName: String(n).padStart(2, '0'),
    adminRoleId: null,
    status: 'active',
    deletedAt: null,
    ...overrides,
  } as AdminUserRecord;
}

function serviceOver(people: AdminUserRecord[], seeing: (id: string) => boolean) {
  const access = {
    loadVisible: vi.fn(async (id: string) => ({ id }) as VisibleProjectRow),
    canSeeAs: vi.fn(async () => {
      throw new Error('canSeeAs: the mentionable list asks for everybody at once (issue #461)');
    }),
    canSeeAsMany: vi.fn(async (ids: readonly string[], _projectId: string) => new Set(ids.filter(seeing))),
  };
  const service = new ProjectMentionService({
    access,
    adminUsers: { listAll: vi.fn(async () => people) } as unknown as AdminUserReadPort,
    permissions: {} as PermissionReadPort,
    notifier: {} as ProjectNotifier,
  });
  return { service, access };
}

describe('ProjectMentionService.mentionable — one visibility question (issue #461)', () => {
  it('asks canSeeAsMany once for every candidate and never canSeeAs', async () => {
    const people = Array.from({ length: 45 }, (_, index) => person(index + 1));
    const { service, access } = serviceOver(people, () => true);
    await service.mentionable({ projectId: PROJECT_ID });
    expect(access.canSeeAsMany).toHaveBeenCalledTimes(1);
    expect(access.canSeeAsMany.mock.calls[0]![1]).toBe(PROJECT_ID);
    expect([...access.canSeeAsMany.mock.calls[0]![0]].sort()).toEqual(people.map((p) => p.id).sort());
    expect(access.canSeeAs).not.toHaveBeenCalled();
  });

  it('offers the people who may see the Project, in name order, at most the limit', async () => {
    const people = Array.from({ length: 50 }, (_, index) => person(index + 1)).reverse();
    const { service } = serviceOver(people, (id) => Number(id.slice(-12)) % 2 === 0);
    const options = await service.mentionable({ projectId: PROJECT_ID });
    expect(options).toHaveLength(MENTIONABLE_LIMIT);
    expect(options.map((option) => option.id)).toEqual(
      Array.from({ length: MENTIONABLE_LIMIT }, (_, index) => adminId((index + 1) * 2)),
    );
    expect(options[0]).toEqual({ id: adminId(2), name: 'Person 02', email: 'person-02@example.com' });
  });

  it('never offers an inactive or deleted administrator, and narrows by what is typed before asking', async () => {
    const people = [
      person(1),
      person(2, { status: 'inactive' } as Partial<AdminUserRecord>),
      person(3, { deletedAt: new Date(0) } as Partial<AdminUserRecord>),
      person(4, { firstName: 'Zofia' }),
    ];
    const { service, access } = serviceOver(people, () => true);
    expect((await service.mentionable({ projectId: PROJECT_ID })).map((option) => option.id)).toEqual([
      adminId(1),
      adminId(4),
    ]);
    expect((await service.mentionable({ projectId: PROJECT_ID, q: 'zof' })).map((option) => option.id)).toEqual([
      adminId(4),
    ]);
    expect(access.canSeeAsMany.mock.calls[1]![0]).toEqual([adminId(4)]);
  });

  it('asks nothing of the visibility rule when nobody matches', async () => {
    const { service, access } = serviceOver([person(1)], () => true);
    expect(await service.mentionable({ projectId: PROJECT_ID, q: 'nobody-by-this-name' })).toEqual([]);
    expect(access.canSeeAsMany).not.toHaveBeenCalled();
  });
});
