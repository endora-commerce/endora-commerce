import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import { PROJECTS_WRITE_PERMISSION, type ProjectAccess } from './project-access.js';
import { createProjectTaskContext } from './task-context-descriptor.js';

/**
 * The `project` Task context's `search` (issue #504): the Project/Stage
 * picker's page is one bounded search through `ProjectAccess` and one read of
 * that page's Stages — never `allVisibleIds`, `visibleIds` or a read per
 * Project — and a caller who may not change a Project's Tasks gets nothing
 * without a Project being read at all. The SQL itself is measured against a
 * database by `backend/test/integration/tasks/context-lookup-bounded.test.ts`.
 */

const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';

function fixture(heldCodes: string[]) {
  const access = {
    callerHolds: vi.fn(async (code: string) => heldCodes.includes(code)),
    searchVisibleByLabel: vi.fn(async () => [
      { id: P1, number: 'PRJ-1', title: 'Alpha' },
      { id: P2, number: 'PRJ-2', title: 'Beta' },
    ]),
    allVisibleIds: vi.fn(async () => []),
    visibleIds: vi.fn(async () => new Set<string>()),
  };
  const execute = vi.fn(async (sql: string, _params?: unknown[]) => {
    expect(sql).toContain('"project_stages"');
    return [
      { id: 's2', project_id: P1, name: 'Second' },
      { id: 's1', project_id: P2, name: 'Only' },
    ];
  });
  const context = createProjectTaskContext({
    access: access as unknown as ProjectAccess,
    emFactory: () => ({ execute }) as unknown as EntityManager,
    translate: async (key) => key,
  });
  return { access, execute, context };
}

describe('the project Task context — search (issue #504)', () => {
  it('is one bounded search and one read of the page’s Stages', async () => {
    const { access, execute, context } = fixture([PROJECTS_WRITE_PERMISSION]);
    const hits = await context.search!({ q: 'zolw', limit: 20, changeableOnly: true });

    expect(access.searchVisibleByLabel).toHaveBeenCalledTimes(1);
    expect(access.searchVisibleByLabel).toHaveBeenCalledWith('zolw', 20);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![1]).toEqual([`{${P1},${P2}}`]);
    expect(access.allVisibleIds).not.toHaveBeenCalled();
    expect(access.visibleIds).not.toHaveBeenCalled();
    expect(hits).toEqual([
      { id: P1, description: { label: 'PRJ-1 Alpha', href: `/projects/${P1}`, groups: new Map([['s2', 'Second']]) } },
      { id: P2, description: { label: 'PRJ-2 Beta', href: `/projects/${P2}`, groups: new Map([['s1', 'Only']]) } },
    ]);
  });

  it('reads nothing for a caller without projects:write when only changeable Projects are asked for', async () => {
    const { access, execute, context } = fixture(['projects:read']);
    expect(await context.search!({ q: '', limit: 20, changeableOnly: true })).toEqual([]);
    expect(access.searchVisibleByLabel).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('searches what the caller sees when changeability is not asked', async () => {
    const { access, context } = fixture(['projects:read']);
    expect(await context.search!({ q: '', limit: 5, changeableOnly: false })).toHaveLength(2);
    expect(access.searchVisibleByLabel).toHaveBeenCalledWith('', 5);
  });
});
