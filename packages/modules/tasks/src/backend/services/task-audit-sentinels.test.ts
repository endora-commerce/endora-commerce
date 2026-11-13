/**
 * The audit-state rule for Tasks (`specs/conventions/audit-state.md`, D-288,
 * issue #470; owner ruling O-1 2026-11-10: a title is a value): the platform
 * audit log carries **names and structure** of a Task, never its values. The
 * values the Task's history shows live in `task_value_changes`, written in the
 * same Command.
 *
 * One sentinel test per Command that writes a Task's values, each run through
 * the **real** `CommandBus` with a recording audit port and an in-memory
 * EntityManager: what is under test is what the Command hands the bus.
 */
import { AssertionError } from 'node:assert';
import { describe, expect, it, vi } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { Task } from '../entities/task.entity.js';
import { TaskAttachmentService } from './attachment-service.js';
import {
  changeTaskCustomFieldsCommand,
  createTaskCommand,
  deleteTaskCommand,
  updateTaskCommand,
} from './task-commands.js';

// ---------------------------------------------------------------------------
// A local copy of `expectNoAuditValues` from `@endora-commerce/test-kit/audit`
// (#1004): this branch is not stacked on it. Replace with the import once
// #1004 has merged.
// ---------------------------------------------------------------------------
type Sentinel = string | number;

function expectNoAuditValues(entries: readonly RecordAuditInput[], sentinels: readonly Sentinel[]): void {
  if (entries.length === 0) throw new AssertionError({ message: 'no audit entry to inspect' });
  const leaks: string[] = [];
  const hit = (text: string, sentinel: Sentinel) =>
    typeof sentinel === 'number' ? text.includes(String(sentinel)) : text.toLowerCase().includes(sentinel.toLowerCase());
  const walk = (value: unknown, path: string): void => {
    if (value === null || value === undefined || value instanceof Date) return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        for (const sentinel of sentinels) if (typeof sentinel === 'string' && hit(key, sentinel)) leaks.push(`${path}{${key}}`);
        walk(child, `${path}.${key}`);
      }
      return;
    }
    for (const sentinel of sentinels) {
      if (typeof value === 'number' ? value === sentinel : hit(String(value), sentinel)) leaks.push(`${path} = ${JSON.stringify(value)}`);
    }
  };
  entries.forEach((entry, index) => {
    walk(entry.stateBefore, `[${index}] ${entry.action} stateBefore`);
    walk(entry.stateAfter, `[${index}] ${entry.action} stateAfter`);
  });
  if (leaks.length > 0) throw new AssertionError({ message: `the audit log carries tenant-scoped values:\n  ${leaks.join('\n  ')}` });
}
// ---------------------------------------------------------------------------

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ASSET = '00000000-0000-4000-8000-0000000004e1';
const S = {
  title: 'S470-TITLE',
  titleNew: 'S470-TITLE-NEW',
  note: 'S470-NOTE',
  customField: 'S470-CF',
  customFieldNew: 'S470-CF-NEW',
  file: 'S470-FILE.pdf',
} as const;
const SENTINELS: readonly Sentinel[] = Object.values(S);

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Enough of MikroORM's EntityManager for the Commands under test, keyed by class name. */
class FakeEm {
  readonly tables = new Map<string, Row[]>();
  #sequence = 0;
  table(name: string): Row[] {
    let rows = this.tables.get(name);
    if (!rows) this.tables.set(name, (rows = []));
    return rows;
  }
  #matches(row: Row, where: Where = {}): boolean {
    return Object.entries(where).every(([key, wanted]) =>
      wanted !== null && typeof wanted === 'object' && !Array.isArray(wanted) ? true : row[key] === wanted,
    );
  }
  create<T extends object>(entity: new () => T, data: Partial<T>): T {
    const row = Object.assign(new entity(), data);
    this.table(entity.name).push(row as Row);
    return row;
  }
  async findOne(entity: { name: string }, where: Where): Promise<Row | null> {
    return this.table(entity.name).find((row) => this.#matches(row, where)) ?? null;
  }
  async find(entity: { name: string }, where: Where = {}): Promise<Row[]> {
    return this.table(entity.name).filter((row) => this.#matches(row, where));
  }
  remove(row: object): this {
    const rows = this.table(row.constructor.name);
    rows.splice(rows.indexOf(row as Row), 1);
    return this;
  }
  async nativeDelete(entity: { name: string }, where: Where): Promise<number> {
    const rows = this.table(entity.name);
    const doomed = rows.filter((row) => this.#matches(row, where));
    for (const row of doomed) rows.splice(rows.indexOf(row), 1);
    return doomed.length;
  }
  async execute(sql: string): Promise<Array<{ value: number }>> {
    return sql.includes('nextval') ? [{ value: (this.#sequence += 1) }] : [];
  }
  async flush(): Promise<void> {}
  async transactional<T>(fn: (em: FakeEm) => Promise<T>): Promise<T> {
    return fn(this);
  }
  fork(): this {
    return this;
  }
  valueChanges(): Row[] {
    return this.table('TaskValueChange');
  }
}

function harness() {
  const em = new FakeEm();
  const entries: RecordAuditInput[] = [];
  const auditLog = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
    record: async () => {
      throw new Error('a Command records through recordWithin');
    },
    query: async () => [],
    findByObjectIds: async () => [],
  };
  const events = { run: async <T>(fn: () => Promise<T>) => fn(), emit: vi.fn() };
  const commandBus = new CommandBus({ em } as never, auditLog as never, events as never);
  return { em, entries, commandBus, auditLog };
}

function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  return withSystemScopeActingFor(ADMIN, 'tasks audit-state sentinel test', fn);
}

function seedTask(em: FakeEm): Task {
  return em.create(Task, {
    id: '00000000-0000-4000-8000-0000000004b1',
    number: 'TASK-000470',
    title: S.title,
    description: 'plain',
    status: 'open',
    contextNote: S.note,
    customFieldValues: { risk: S.customField },
  } as never);
}

function storedFor(h: ReturnType<typeof harness>, entry: RecordAuditInput): Row {
  const pointer = (entry.stateAfter?.valueChangeId ?? entry.stateBefore?.valueChangeId) as string | undefined;
  expect(pointer, `${entry.action} carries a valueChangeId`).toEqual(expect.any(String));
  const row = h.em.valueChanges().find((change) => change.id === pointer);
  expect(row?.taskId, `${entry.action}'s value-store row`).toBe(entry.objectId);
  return row as Row;
}

describe('tasks audit state carries names, never values (#470)', () => {
  it('tasks.task.create — title, context note and custom-field values go to the store', async () => {
    const h = harness();
    await asAdmin(() =>
      h.commandBus.run(
        createTaskCommand(null, {
          title: S.title,
          description: 'plain',
          assigneeIds: [],
          dueOn: null,
          contextNote: S.note,
          status: 'open',
          customFieldValues: { risk: S.customField },
        }),
      ),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toMatchObject({ changedFields: ['contextNote', 'title'], changedCustomFields: ['risk'] });
    expect(storedFor(h, h.entries[0]!)).toMatchObject({
      before: null,
      after: { title: S.title, contextNote: S.note, customFieldValues: { risk: S.customField } },
    });
  });

  it('tasks.task.update — a new title goes to the store, the entry names it', async () => {
    const h = harness();
    seedTask(h.em);
    await asAdmin(() =>
      h.commandBus.run(updateTaskCommand('00000000-0000-4000-8000-0000000004b1', { title: S.titleNew }, {
        timeZone: 'Europe/Warsaw',
        auditLog: h.auditLog as never,
      })),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toMatchObject({ changedFields: ['title'] });
    expect(storedFor(h, h.entries[0]!)).toMatchObject({ before: { title: S.title }, after: { title: S.titleNew } });
  });

  it('tasks.task.custom_fields_change — the values go to the store, the entry names the keys', async () => {
    const h = harness();
    seedTask(h.em);
    await asAdmin(() =>
      h.commandBus.run(changeTaskCustomFieldsCommand('00000000-0000-4000-8000-0000000004b1', { risk: S.customFieldNew })),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toMatchObject({ changedCustomFields: ['risk'] });
    expect(storedFor(h, h.entries[0]!)).toMatchObject({
      before: { customFieldValues: { risk: S.customField } },
      after: { customFieldValues: { risk: S.customFieldNew } },
    });
  });

  it('tasks.task.delete — the entry says which Task by its number', async () => {
    const h = harness();
    seedTask(h.em);
    await asAdmin(() => h.commandBus.run(deleteTaskCommand('00000000-0000-4000-8000-0000000004b1', h.auditLog as never)));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries.find((entry) => entry.action === 'tasks.task.delete')?.stateBefore).toMatchObject({
      number: 'TASK-000470',
    });
  });

  it('tasks.attachment.add — the file name goes to the store', async () => {
    const h = harness();
    const task = seedTask(h.em);
    const asset = { id: ASSET, filename: S.file, mimeType: 'application/pdf', visibility: 'private', sizeBytes: '10' };
    const service = new TaskAttachmentService({
      emFactory: () => h.em,
      commandBus: h.commandBus,
      access: {
        loadVisible: async () => ({ id: task.id }),
        assertMayChange: () => undefined,
        visibleIds: async (ids: readonly string[]) => new Set(ids),
      },
      assets: {
        findById: async () => asset,
        findByIds: async () => [asset],
        visibleToCaller: async (ids: readonly string[]) => new Set(ids),
        resolveUrls: async (ids: readonly string[]) => new Map(ids.map((id) => [id, '/files/x'])),
      },
      assetsLibrary: {},
      adminUsers: { findByIds: async () => [] },
    } as never);
    await asAdmin(() => service.add(task.id, ASSET));
    expectNoAuditValues(h.entries, SENTINELS);
    expect(h.entries[0]?.stateAfter).toMatchObject({ attachmentId: expect.any(String), changedFields: ['fileName'] });
    expect(storedFor(h, h.entries[0]!)).toMatchObject({ before: null, after: { fileName: S.file } });
  });

  it('holds the snapshot to TASKS_AUDIT_KEYS', async () => {
    const { TASKS_AUDIT_KEYS, auditSnapshot } = await import('./task-commands.js').then(async (commands) => ({
      ...(await import('./task-audit-state.js')),
      auditSnapshot: commands.auditSnapshot,
    }));
    const h = harness();
    const keys = Object.keys(auditSnapshot(seedTask(h.em)));
    expect(keys.filter((key) => !TASKS_AUDIT_KEYS.has(key))).toEqual([]);
  });
});

