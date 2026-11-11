import { describe, expect, it, vi } from 'vitest';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { TaskHistoryService, withStoredValues } from './task-history-service.js';

/**
 * Issue #470 (D-288) — a Task's audit entry names what changed and points at
 * the Task's own value store; the history serves the values from there, read by
 * the Task's id, and an entry written before #470 as it is stored (O-4).
 */
const TASK = '00000000-0000-4000-8000-0000000004b1';
const OTHER_TASK = '00000000-0000-4000-8000-0000000004b2';
const V1 = '00000000-0000-4000-8000-0000000004f1';
const ADMIN = '00000000-0000-4000-8000-0000000004a1';

interface StoredRow {
  id: string;
  taskId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function build(
  entries: Array<{ before: unknown; after: unknown }>,
  stored: StoredRow[] = [],
  canSeeContext = true,
  mayReadCustomFields = true,
) {
  const execute = vi.fn(async (_sql: string, [taskId, ids]: [string, string]) =>
    stored.filter((row) => row.taskId === taskId && ids.includes(row.id)),
  );
  const service = new TaskHistoryService({
    emFactory: () => ({ execute }) as never,
    tasks: { findVisibleRow: async () => ({ id: TASK }) } as never,
    visibility: { canSeeContext: async () => canSeeContext },
    access: { visibleIds: async (ids: readonly string[]) => new Set(ids) },
    auditLog: {
      query: async () =>
        entries.map((entry, index) => ({
          id: `entry-${index}`,
          actedAt: new Date(Date.UTC(2026, 10, 10, 12) - index * 1000),
          action: 'tasks.task.update',
          actorAdminUserId: null,
          stateBefore: entry.before,
          stateAfter: entry.after,
        })) as never,
    },
    adminUsers: { findByIds: async () => [] } as never,
    mayReadCustomFields: async () => mayReadCustomFields,
  } as never);
  const list = () => withSystemScopeActingFor(ADMIN, 'test: task history', () => service.list(TASK, { limit: 50 }));
  return { list, execute };
}

describe('TaskHistoryService — values from the Task’s own store (#470)', () => {
  it('serves the stored values in place of the names', async () => {
    const { list, execute } = build(
      [{ before: { number: 'TASK-1' }, after: { number: 'TASK-1', changedFields: ['title'], valueChangeId: V1 } }],
      [{ id: V1, taskId: TASK, before: { title: 'Call back' }, after: { title: 'Call back today' } }],
    );
    const page = await list();
    expect(page.data[0]).toMatchObject({
      before: { number: 'TASK-1', title: 'Call back' },
      after: { number: 'TASK-1', title: 'Call back today' },
    });
    expect(page.data[0]?.after).not.toHaveProperty('valueChangeId');
    expect(execute.mock.calls[0]?.[1]).toEqual([TASK, `{${V1}}`]);
  });

  it('reads only this Task’s rows: a pointer to another Task’s row serves the names, never its values', async () => {
    const { list } = build(
      [{ before: null, after: { changedFields: ['title'], valueChangeId: V1 } }],
      [{ id: V1, taskId: OTHER_TASK, before: null, after: { title: 'Not yours' } }],
    );
    const page = await list();
    expect(page.data[0]?.after).toEqual({ changedFields: ['title'] });
  });

  it('blanks a stored context note when the reader may not see the context the entry names', async () => {
    const { list } = build(
      [{ before: null, after: { contextType: 'project', contextId: 'p-1', changedFields: ['contextNote'], valueChangeId: V1 } }],
      [{ id: V1, taskId: TASK, before: null, after: { contextNote: 'From PRJ-1' } }],
      false,
    );
    const page = await list();
    expect(page.data[0]?.after).toEqual({ contextType: null, contextId: null, contextNote: null });
  });

  it('serves an entry written before #470 as it is stored, and reads no store for it', async () => {
    const { list, execute } = build([{ before: { title: 'Old' }, after: { title: 'Older' } }]);
    const page = await list();
    expect(page.data[0]).toMatchObject({ before: { title: 'Old' }, after: { title: 'Older' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('withStoredValues keeps the names when no row is found, and drops only the pointer', () => {
    expect(withStoredValues({ before: null, after: { changedFields: ['title'], valueChangeId: V1 } }, null)).toEqual({
      before: null,
      after: { changedFields: ['title'] },
    });
  });
});

/**
 * Owner ruling (2026-11-10, #470; feature 162 P2 = a, as CRM and Projects): a
 * Task's custom-field values — and the names of the changed ones — are served
 * in its history only to a reader holding `custom_fields:read`.
 */
describe('TaskHistoryService — custom fields need custom_fields:read', () => {
  const entries = [
    { before: null, after: { number: 'TASK-1', changedCustomFields: ['risk'], valueChangeId: V1 } },
    // Written before #470: the values are in the audit row itself (O-4).
    { before: { customFieldValues: { risk: 'low' } }, after: { customFieldValues: { risk: 'high' } } },
  ];
  const stored = [{ id: V1, taskId: TASK, before: null, after: { customFieldValues: { risk: 'S470-CF' } } }];

  it('serves them to a reader who may read custom fields', async () => {
    const page = await build(entries, stored, true, true).list();
    expect(page.data[0]?.after).toEqual({ number: 'TASK-1', customFieldValues: { risk: 'S470-CF' } });
    expect(page.data[1]).toMatchObject({ before: { customFieldValues: { risk: 'low' } } });
  });

  it('serves neither the values nor the names to one who may not — new entries and old alike', async () => {
    const page = await build(entries, stored, true, false).list();
    expect(JSON.stringify(page.data)).not.toContain('risk');
    expect(page.data[0]?.after).toEqual({ number: 'TASK-1' });
    expect(page.data[1]).toMatchObject({ before: {}, after: {} });
  });

  it('still hides the names when no row is found', async () => {
    const page = await build([{ before: null, after: { changedCustomFields: ['risk'] } }], [], true, false).list();
    expect(page.data[0]?.after).toEqual({});
  });
});
