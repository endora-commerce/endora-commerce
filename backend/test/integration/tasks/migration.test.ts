import { randomUUID } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { migrations } from '@endora-commerce/mod-tasks/migrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupMigratorTestDb, type TestDb } from '../../helpers/test-db.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * `tasks`' schema, read back from the database its migrations produced: the
 * 163 init (`specs/163-projects-and-tasks/data-model.md` §1) grown by the
 * Task management migration (`specs/165-task-management/data-model.md` §1–§3).
 *
 * Asserted from the catalogue rather than through the entity classes, as CRM's
 * migration test is: checks and indexes are properties no entity declaration
 * carries. Indexes are found by definition, not by name.
 *
 * The second half drives the Task management migration itself — `down` to the
 * 163 shape, 163-shaped rows, `up`, `down` again — so it takes a database of
 * its own (`setupMigratorTestDb`, `test/migrator-driving-tests.ts`). The
 * migrator is asked which migrations it executed (the registration is the
 * claim that the migration runs at all); the class itself is then run directly
 * rather than through `migrator.down()`: it is not the latest migration of the
 * set, and nothing references the `tasks` tables, so its `down` and `up` can be
 * replayed in place without reverting every module ordered after `tasks`.
 */

type MigrationClass = (typeof migrations)[number];

/** The Task management migration — the one whose class name ends with the slug. */
function taskManagementMigration(): MigrationClass {
  const found = migrations.find((migration) => /TasksTaskManagement$/.test(migration.name));
  if (!found) throw new Error('tasks: the task_management migration is not exported from ./migrations.');
  return found;
}

const SECOND_ADMIN = '00000000-0000-4000-8000-0000000165a2';
const THIRD_ADMIN = '00000000-0000-4000-8000-0000000165a3';

describe('tasks schema (163 init + 165 task management)', () => {
  let db: TestDb;
  let orm: MikroORM;

  beforeAll(async () => {
    db = await setupMigratorTestDb();
    orm = db.orm;
  });

  afterAll(async () => {
    await db.close();
  });

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await orm.em.getConnection().execute(sql, params)) as T[];
  }

  /**
   * Replay the Task management migration in place — and, around it, the
   * module's own migrations that came after it and build on its tables
   * (`task_value_changes`, issue #470): down from the newest, up from the
   * oldest, so the replay is the module's history and not half of it.
   */
  async function run(direction: 'up' | 'down'): Promise<void> {
    const target = taskManagementMigration();
    const later = migrations.slice(migrations.indexOf(target) + 1);
    const sequence = direction === 'down' ? [...later].reverse().concat(target) : [target, ...later];
    const connection = orm.em.getConnection();
    for (const Migration of sequence) {
      const migration = new Migration(orm.em.getDriver(), orm.config);
      await migration[direction]();
      for (const query of migration.getQueries()) await connection.execute(query as string);
      migration.reset();
    }
  }

  async function indexDefinitions(table: string): Promise<string[]> {
    const found = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = current_schema() and tablename = ?`,
      [table],
    );
    return found.map((row) => row.indexdef.replace(/\s+/g, ' '));
  }

  async function columnsOf(table: string): Promise<string[]> {
    return (
      await rows<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = ? order by ordinal_position`,
        [table],
      )
    ).map((row) => row.column_name);
  }

  /** Insert one Task by hand; `overrides` are SQL expressions keyed by column. */
  async function insertTask(overrides: Record<string, string> = {}): Promise<string> {
    const id = randomUUID();
    const values: Record<string, string> = {
      id: `'${id}'`,
      number: `'TSK-M${Math.floor(Math.random() * 1e9)}'`,
      title: `'migration-test ${randomUUID()}'`,
      created_by_admin_user_id: `'${TEST_ADMIN_ID}'`,
      created_at: 'now()',
      updated_at: 'now()',
      ...overrides,
    };
    const columns = Object.keys(values);
    await rows(
      `insert into "tasks" (${columns.map((c) => `"${c}"`).join(', ')})
       values (${columns.map((c) => values[c]).join(', ')})`,
    );
    return id;
  }

  describe('the schema after every migration', () => {
    it('creates the seventeen tables of the module', async () => {
      const found = await rows<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = current_schema() and (table_name = 'tasks' or table_name like 'task\\_%')
          order by table_name`,
      );
      expect(found.map((row) => row.table_name)).toEqual([
        'task_assignees',
        'task_attachments',
        'task_comments',
        'task_digest_subscriptions',
        'task_list_saved_views',
        'task_priorities',
        'task_record_links',
        'task_references',
        'task_relations',
        'task_reminder_deliveries',
        'task_reminders',
        'task_status_transitions',
        'task_statuses',
        'task_tag_assignments',
        'task_tags',
        // Issue #470 — the values the platform audit log no longer carries.
        'task_value_changes',
        'tasks',
      ]);
    });

    it('alters `tasks` per data-model §1: the assignee column gone, nine columns added', async () => {
      const found = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = current_schema() and table_name = 'tasks'
          order by ordinal_position`,
      );
      expect(found).toEqual([
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
        { column_name: 'number', data_type: 'text', is_nullable: 'NO', column_default: null },
        { column_name: 'title', data_type: 'text', is_nullable: 'NO', column_default: null },
        { column_name: 'description', data_type: 'text', is_nullable: 'NO', column_default: "''::text" },
        { column_name: 'status', data_type: 'text', is_nullable: 'NO', column_default: "'todo'::text" },
        { column_name: 'due_on', data_type: 'date', is_nullable: 'YES', column_default: null },
        { column_name: 'completed_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
        { column_name: 'created_by_admin_user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
        { column_name: 'context_type', data_type: 'text', is_nullable: 'YES', column_default: null },
        { column_name: 'context_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
        { column_name: 'context_group_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
        { column_name: 'context_note', data_type: 'text', is_nullable: 'YES', column_default: null },
        { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
        { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
        { column_name: 'due_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
        { column_name: 'start_on', data_type: 'date', is_nullable: 'YES', column_default: null },
        { column_name: 'priority_code', data_type: 'text', is_nullable: 'YES', column_default: null },
        { column_name: 'is_draft', data_type: 'boolean', is_nullable: 'NO', column_default: 'false' },
        { column_name: 'is_private', data_type: 'boolean', is_nullable: 'NO', column_default: 'false' },
        { column_name: 'parent_task_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
        { column_name: 'source_key', data_type: 'text', is_nullable: 'YES', column_default: null },
        { column_name: 'custom_field_values', data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb" },
        { column_name: 'published_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      ]);
    });

    it('creates the number sequence and keeps the number unique', async () => {
      const found = await rows<{ sequence_name: string }>(
        `select sequence_name from information_schema.sequences
          where sequence_schema = current_schema() and sequence_name = 'tasks_number_seq'`,
      );
      expect(found).toHaveLength(1);
      const number = `'TSK-UNIQ-${randomUUID()}'`;
      await expect(insertTask({ number })).resolves.toBeDefined();
      await expect(insertTask({ number })).rejects.toThrow(/unique|duplicate/i);
    });

    it('holds a status code by value: the four-literal check is gone (R-1)', async () => {
      await expect(insertTask({ status: `'in_review'` })).resolves.toBeDefined();
    });

    it('keeps 163’s length and context checks', async () => {
      await expect(insertTask({ title: `''` })).rejects.toThrow(/check constraint/i);
      await expect(insertTask({ description: `repeat('d', 20001)` })).rejects.toThrow(/check constraint/i);
      await expect(insertTask({ context_type: `'probe'` })).rejects.toThrow(/check constraint/i);
      await expect(insertTask({ context_group_id: `'${randomUUID()}'` })).rejects.toThrow(/check constraint/i);
    });

    it('refuses a private Task in a context, a draft with a source key, and a Task its own parent', async () => {
      const context = { context_type: `'probe'`, context_id: `'${randomUUID()}'` };
      await expect(insertTask({ ...context, is_private: 'true' })).rejects.toThrow(/tasks_private_context_check/);
      await expect(insertTask({ is_private: 'true' })).resolves.toBeDefined();
      await expect(insertTask({ ...context, is_draft: 'true', source_key: `'k'` })).rejects.toThrow(
        /tasks_draft_source_check/,
      );
      const self = randomUUID();
      await expect(insertTask({ id: `'${self}'`, parent_task_id: `'${self}'` })).rejects.toThrow(
        /tasks_parent_self_check/,
      );
      await expect(insertTask({ ...context, source_key: `repeat('k', 101)` })).rejects.toThrow(/check constraint/i);
    });

    it('detaches the children of a deleted parent (`on delete set null`, R-15)', async () => {
      const parent = await insertTask();
      const child = await insertTask({ parent_task_id: `'${parent}'` });
      await rows(`delete from "tasks" where "id" = ?`, [parent]);
      const [row] = await rows<{ parent_task_id: string | null }>(`select "parent_task_id" from "tasks" where "id" = ?`, [
        child,
      ]);
      expect(row?.parent_task_id).toBeNull();
    });

    it('keeps one source key per context (R-19)', async () => {
      const context = { context_type: `'probe'`, context_id: `'${randomUUID()}'` };
      await insertTask({ ...context, source_key: `'definition-1'` });
      await expect(insertTask({ ...context, source_key: `'definition-1'` })).rejects.toThrow(/unique|duplicate/i);
      await expect(insertTask({ ...context, source_key: `'definition-2'` })).resolves.toBeDefined();
    });

    it('carries the indexes of data-model §1, and no longer the assignee one', async () => {
      const definitions = await indexDefinitions('tasks');
      const has = (pattern: RegExp) =>
        expect(definitions.some((d) => pattern.test(d)), `${pattern}\n${definitions.join('\n')}`).toBe(true);
      has(/CREATE INDEX .*\(context_type, context_id, context_group_id, status\)$/);
      has(/CREATE INDEX .*\(status, due_on\)$/);
      has(/CREATE UNIQUE INDEX .*\(number\)$/);
      has(/CREATE INDEX .*\(parent_task_id\)$/);
      has(/CREATE INDEX .*\(priority_code\)$/);
      has(/CREATE UNIQUE INDEX .*\(context_type, context_id, source_key\) WHERE \(source_key IS NOT NULL\)$/);
      has(/CREATE INDEX .*\(created_by_admin_user_id\) WHERE \(is_draft OR is_private\)$/);
      has(/CREATE INDEX .*\(due_at\) WHERE \(due_at IS NOT NULL\)$/);
      expect(definitions.some((d) => d.includes('assigned_admin_user_id'))).toBe(false);
    });

    it('creates the child tables of data-model §2 with their keys and cascades', async () => {
      expect(await columnsOf('task_assignees')).toEqual([
        'task_id',
        'admin_user_id',
        'assigned_at',
        'assigned_by_admin_user_id',
      ]);
      expect(await columnsOf('task_tag_assignments')).toEqual(['task_id', 'tag_id']);
      expect(await columnsOf('task_comments')).toEqual([
        'id',
        'task_id',
        'body',
        'author_admin_user_id',
        'edited_at',
        'deleted_at',
        'created_at',
      ]);
      expect(await columnsOf('task_references')).toEqual([
        'id',
        'task_id',
        'source_kind',
        'source_id',
        'target_type',
        'target_id',
      ]);
      expect(await columnsOf('task_attachments')).toEqual([
        'id',
        'task_id',
        'asset_id',
        'added_by_admin_user_id',
        'created_at',
      ]);
      expect(await columnsOf('task_record_links')).toEqual([
        'id',
        'task_id',
        'record_kind',
        'record_id',
        'linked_by_admin_user_id',
        'created_at',
      ]);
      expect(await columnsOf('task_relations')).toEqual([
        'task_a_id',
        'task_b_id',
        'created_by_admin_user_id',
        'created_at',
      ]);
      expect(await columnsOf('task_reminders')).toEqual([
        'id',
        'task_id',
        'created_by_admin_user_id',
        'mode',
        'remind_at',
        'offset_minutes',
        'recipient_admin_user_ids',
        'created_at',
      ]);
      expect(await columnsOf('task_reminder_deliveries')).toEqual([
        'id',
        'reminder_id',
        'admin_user_id',
        'outcome',
        'recorded_at',
      ]);

      // Every child goes with its Task.
      const task = await insertTask();
      const other = await insertTask();
      const [low, high] = [task, other].sort();
      const [tag] = await rows<{ id: string }>(
        `insert into "task_tags" ("id", "name", "created_at", "updated_at") values (gen_random_uuid(), ?, now(), now()) returning "id"`,
        [`migration-test ${randomUUID()}`],
      );
      await rows(`insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at") values (?, ?, now())`, [
        task,
        TEST_ADMIN_ID,
      ]);
      await rows(`insert into "task_tag_assignments" ("task_id", "tag_id") values (?, ?)`, [task, tag!.id]);
      await rows(
        `insert into "task_comments" ("id", "task_id", "body", "author_admin_user_id", "created_at") values (gen_random_uuid(), ?, 'x', ?, now())`,
        [task, TEST_ADMIN_ID],
      );
      await rows(
        `insert into "task_references" ("id", "task_id", "source_kind", "target_type", "target_id") values (gen_random_uuid(), ?, 'description', 'project', ?)`,
        [task, randomUUID()],
      );
      await rows(
        `insert into "task_attachments" ("id", "task_id", "asset_id", "added_by_admin_user_id", "created_at") values (gen_random_uuid(), ?, ?, ?, now())`,
        [task, randomUUID(), TEST_ADMIN_ID],
      );
      await rows(
        `insert into "task_record_links" ("id", "task_id", "record_kind", "record_id", "linked_by_admin_user_id", "created_at") values (gen_random_uuid(), ?, 'order', ?, ?, now())`,
        [task, randomUUID(), TEST_ADMIN_ID],
      );
      await rows(
        `insert into "task_relations" ("task_a_id", "task_b_id", "created_by_admin_user_id", "created_at") values (?, ?, ?, now())`,
        [low, high, TEST_ADMIN_ID],
      );
      const [reminder] = await rows<{ id: string }>(
        `insert into "task_reminders" ("id", "task_id", "created_by_admin_user_id", "mode", "remind_at", "recipient_admin_user_ids", "created_at")
         values (gen_random_uuid(), ?, ?, 'absolute', now(), ?::uuid[], now()) returning "id"`,
        [task, TEST_ADMIN_ID, `{${TEST_ADMIN_ID}}`],
      );
      await rows(
        `insert into "task_reminder_deliveries" ("id", "reminder_id", "admin_user_id", "outcome", "recorded_at") values (gen_random_uuid(), ?, ?, 'delivered', now())`,
        [reminder!.id, TEST_ADMIN_ID],
      );

      await rows(`delete from "tasks" where "id" = ?`, [task]);
      for (const table of [
        'task_assignees',
        'task_tag_assignments',
        'task_comments',
        'task_references',
        'task_attachments',
        'task_record_links',
        'task_value_changes',
      ]) {
        const [count] = await rows<{ n: number }>(`select count(*)::int as "n" from "${table}" where "task_id" = ?`, [task]);
        expect(count?.n, table).toBe(0);
      }
      const [relations] = await rows<{ n: number }>(
        `select count(*)::int as "n" from "task_relations" where "task_a_id" = ? or "task_b_id" = ?`,
        [task, task],
      );
      expect(relations?.n).toBe(0);
      const [deliveries] = await rows<{ n: number }>(
        `select count(*)::int as "n" from "task_reminder_deliveries" where "reminder_id" = ?`,
        [reminder!.id],
      );
      expect(deliveries?.n).toBe(0);
      // Deleting a tag takes its assignments with it, never the Task.
      const third = await insertTask();
      await rows(`insert into "task_tag_assignments" ("task_id", "tag_id") values (?, ?)`, [third, tag!.id]);
      await rows(`delete from "task_tags" where "id" = ?`, [tag!.id]);
      expect(await rows(`select 1 from "task_tag_assignments" where "task_id" = ?`, [third])).toHaveLength(0);
      expect(await rows(`select 1 from "tasks" where "id" = ?`, [third])).toHaveLength(1);
    });

    it('holds the child tables to their checks and unique keys', async () => {
      const task = await insertTask();
      const other = await insertTask();
      const [low, high] = [task, other].sort();
      await rows(`insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at") values (?, ?, now())`, [
        task,
        TEST_ADMIN_ID,
      ]);
      await expect(
        rows(`insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at") values (?, ?, now())`, [
          task,
          TEST_ADMIN_ID,
        ]),
      ).rejects.toThrow(/duplicate|unique/i);
      // The reference target types are the platform-wide seven.
      for (const type of ['admin_user', 'order', 'product', 'quote_request', 'task', 'opportunity', 'project']) {
        await expect(
          rows(
            `insert into "task_references" ("id", "task_id", "source_kind", "target_type", "target_id") values (gen_random_uuid(), ?, 'description', ?, ?)`,
            [task, type, randomUUID()],
          ),
          type,
        ).resolves.toBeDefined();
      }
      await expect(
        rows(
          `insert into "task_references" ("id", "task_id", "source_kind", "target_type", "target_id") values (gen_random_uuid(), ?, 'description', 'campaign', ?)`,
          [task, randomUUID()],
        ),
      ).rejects.toThrow(/check constraint/i);
      // A comment reference names its comment; a description reference names none.
      await expect(
        rows(
          `insert into "task_references" ("id", "task_id", "source_kind", "target_type", "target_id") values (gen_random_uuid(), ?, 'comment', 'task', ?)`,
          [task, randomUUID()],
        ),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        rows(
          `insert into "task_record_links" ("id", "task_id", "record_kind", "record_id", "linked_by_admin_user_id", "created_at") values (gen_random_uuid(), ?, 'project', ?, ?, now())`,
          [task, randomUUID(), TEST_ADMIN_ID],
        ),
      ).rejects.toThrow(/check constraint/i);
      const record = randomUUID();
      await rows(
        `insert into "task_record_links" ("id", "task_id", "record_kind", "record_id", "linked_by_admin_user_id", "created_at") values (gen_random_uuid(), ?, 'order', ?, ?, now())`,
        [task, record, TEST_ADMIN_ID],
      );
      await expect(
        rows(
          `insert into "task_record_links" ("id", "task_id", "record_kind", "record_id", "linked_by_admin_user_id", "created_at") values (gen_random_uuid(), ?, 'order', ?, ?, now())`,
          [task, record, TEST_ADMIN_ID],
        ),
      ).rejects.toThrow(/duplicate|unique/i);
      // A relation is stored once, its smaller id first.
      await expect(
        rows(
          `insert into "task_relations" ("task_a_id", "task_b_id", "created_by_admin_user_id", "created_at") values (?, ?, ?, now())`,
          [high, low, TEST_ADMIN_ID],
        ),
      ).rejects.toThrow(/check constraint/i);
      // A relative reminder carries its offset, an absolute one does not; 1–21 recipients.
      const reminder = (mode: string, offset: string, recipients: string[]) =>
        rows(
          `insert into "task_reminders" ("id", "task_id", "created_by_admin_user_id", "mode", "remind_at", "offset_minutes", "recipient_admin_user_ids", "created_at")
           values (gen_random_uuid(), ?, ?, ?, now(), ${offset}, ?::uuid[], now())`,
          [task, TEST_ADMIN_ID, mode, `{${recipients.join(',')}}`],
        );
      await expect(reminder('relative', 'null', [TEST_ADMIN_ID])).rejects.toThrow(/check constraint/i);
      await expect(reminder('absolute', '60', [TEST_ADMIN_ID])).rejects.toThrow(/check constraint/i);
      await expect(reminder('absolute', 'null', [])).rejects.toThrow(/check constraint/i);
      await expect(
        reminder('absolute', 'null', Array.from({ length: 22 }, () => randomUUID())),
      ).rejects.toThrow(/check constraint/i);
      await expect(reminder('relative', '60', [TEST_ADMIN_ID])).resolves.toBeDefined();
      const [created] = await rows<{ id: string }>(
        `select "id" from "task_reminders" where "task_id" = ? limit 1`,
        [task],
      );
      const delivery = (outcome: string) =>
        rows(
          `insert into "task_reminder_deliveries" ("id", "reminder_id", "admin_user_id", "outcome", "recorded_at") values (gen_random_uuid(), ?, ?, ?, now())`,
          [created!.id, TEST_ADMIN_ID, outcome],
        );
      await expect(delivery('sent')).rejects.toThrow(/check constraint/i);
      await expect(delivery('expired')).resolves.toBeDefined();
      await expect(delivery('delivered')).rejects.toThrow(/duplicate|unique/i);
    });

    it('creates the configuration and per-admin tables of data-model §3', async () => {
      expect(await columnsOf('task_statuses')).toEqual([
        'id',
        'code',
        'name',
        'default_name',
        'category',
        'is_initial',
        'weight',
        'color',
        'created_at',
        'updated_at',
      ]);
      expect(await columnsOf('task_status_transitions')).toEqual(['id', 'from_code', 'to_code', 'created_at']);
      expect(await columnsOf('task_priorities')).toEqual([
        'id',
        'code',
        'name',
        'default_name',
        'color',
        'weight',
        'created_at',
        'updated_at',
      ]);
      expect(await columnsOf('task_tags')).toEqual(['id', 'name', 'color', 'created_at', 'updated_at']);
      expect(await columnsOf('task_list_saved_views')).toEqual([
        'id',
        'owner_admin_user_id',
        'name',
        'shared',
        'filters',
        'sort',
        'visible_columns',
        'created_at',
        'updated_at',
      ]);
      expect(await columnsOf('task_digest_subscriptions')).toEqual([
        'admin_user_id',
        'hour',
        'last_sent_on',
        'updated_at',
      ]);

      const status = (code: string, category: string, initial = false) =>
        rows(
          `insert into "task_statuses" ("id", "code", "name", "default_name", "category", "is_initial", "weight", "color", "created_at", "updated_at")
           values (gen_random_uuid(), ?, '{}', ?, ?, ?, 99, '#000000', now(), now())`,
          [code, code, category, initial],
        );
      await expect(status('todo', 'open')).rejects.toThrow(/duplicate|unique/i);
      await expect(status('migration_parked', 'parked')).rejects.toThrow(/check constraint/i);
      await expect(status('migration_second_initial', 'open', true)).rejects.toThrow(/duplicate|unique/i);
      await expect(
        rows(
          `insert into "task_status_transitions" ("id", "from_code", "to_code", "created_at") values (gen_random_uuid(), 'todo', 'todo', now())`,
        ),
      ).rejects.toThrow(/check constraint/i);
      await expect(
        rows(
          `insert into "task_status_transitions" ("id", "from_code", "to_code", "created_at") values (gen_random_uuid(), 'todo', 'done', now())`,
        ),
      ).rejects.toThrow(/duplicate|unique/i);
      const tag = (name: string) =>
        rows(`insert into "task_tags" ("id", "name", "created_at", "updated_at") values (gen_random_uuid(), ?, now(), now())`, [
          name,
        ]);
      const name = `Migration ${randomUUID()}`;
      await tag(name);
      await expect(tag(name.toUpperCase())).rejects.toThrow(/duplicate|unique/i);
      const [defaultColour] = await rows<{ color: string }>(`select "color" from "task_tags" where "name" = ?`, [name]);
      expect(defaultColour?.color).toBe('#64748b');
      const view = (owner: string, viewName: string) =>
        rows(
          `insert into "task_list_saved_views" ("id", "owner_admin_user_id", "name", "shared", "filters", "created_at", "updated_at")
           values (gen_random_uuid(), ?, ?, false, '{}', now(), now())`,
          [owner, viewName],
        );
      await view(TEST_ADMIN_ID, 'Mine');
      await expect(view(TEST_ADMIN_ID, 'MINE')).rejects.toThrow(/duplicate|unique/i);
      await expect(view(SECOND_ADMIN, 'Mine')).resolves.toBeDefined();
      await expect(
        rows(`insert into "task_digest_subscriptions" ("admin_user_id", "hour", "updated_at") values (?, 24, now())`, [
          THIRD_ADMIN,
        ]),
      ).rejects.toThrow(/check constraint/i);
    });

    it('seeds the four statuses with their categories, the twelve moves and the four priorities', async () => {
      const statuses = await rows<{
        code: string;
        name: Record<string, string>;
        default_name: string;
        category: string;
        is_initial: boolean;
        weight: number;
      }>(`select "code", "name", "default_name", "category", "is_initial", "weight" from "task_statuses" order by "weight"`);
      expect(statuses).toEqual([
        { code: 'todo', name: { en: 'To do', pl: 'Do zrobienia' }, default_name: 'To do', category: 'open', is_initial: true, weight: 10 },
        { code: 'in_progress', name: { en: 'In progress', pl: 'W toku' }, default_name: 'In progress', category: 'open', is_initial: false, weight: 20 },
        { code: 'done', name: { en: 'Done', pl: 'Zrobione' }, default_name: 'Done', category: 'done', is_initial: false, weight: 30 },
        { code: 'cancelled', name: { en: 'Cancelled', pl: 'Anulowane' }, default_name: 'Cancelled', category: 'cancelled', is_initial: false, weight: 40 },
      ]);
      const transitions = await rows<{ from_code: string; to_code: string }>(
        `select "from_code", "to_code" from "task_status_transitions" order by "from_code", "to_code"`,
      );
      const codes = ['todo', 'in_progress', 'done', 'cancelled'];
      const every = codes.flatMap((from) => codes.filter((to) => to !== from).map((to) => ({ from_code: from, to_code: to })));
      expect(transitions).toEqual(
        every.sort((a, b) => a.from_code.localeCompare(b.from_code) || a.to_code.localeCompare(b.to_code)),
      );
      const priorities = await rows<{ code: string; name: Record<string, string>; weight: number }>(
        `select "code", "name", "weight" from "task_priorities" order by "weight"`,
      );
      expect(priorities).toEqual([
        { code: 'urgent', name: { en: 'Urgent', pl: 'Pilny' }, weight: 10 },
        { code: 'high', name: { en: 'High', pl: 'Wysoki' }, weight: 20 },
        { code: 'normal', name: { en: 'Normal', pl: 'Normalny' }, weight: 30 },
        { code: 'low', name: { en: 'Low', pl: 'Niski' }, weight: 40 },
      ]);
    });
  });

  it('is registered and executed: the migrator records the task_management migration', async () => {
    const executed = await orm.getMigrator().getExecutedMigrations();
    expect(executed.map((migration) => migration.name)).toContain(taskManagementMigration().name);
  });

  describe('the upgrade from the 163 schema, and back', () => {
    const statuses = ['todo', 'in_progress', 'done', 'cancelled'] as const;
    const ids: Record<string, string> = {};

    it('down restores the 163 shape', async () => {
      await rows(`delete from "tasks"`);
      await run('down');
      const columns = await columnsOf('tasks');
      expect(columns).toContain('assigned_admin_user_id');
      for (const gone of ['due_at', 'is_draft', 'is_private', 'parent_task_id', 'published_at', 'custom_field_values']) {
        expect(columns, gone).not.toContain(gone);
      }
      const tables = await rows<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = current_schema() and table_name like 'task\\_%'`,
      );
      expect(tables).toEqual([]);
      await expect(insertTask({ status: `'in_review'` })).rejects.toThrow(/tasks_status_check/);
      expect((await indexDefinitions('tasks')).some((d) => /\(assigned_admin_user_id, status, due_on\)$/.test(d))).toBe(
        true,
      );
    });

    it('up keeps every 163 Task’s status and assignee, and publishes every existing Task', async () => {
      for (const status of statuses) {
        ids[`${status}-assigned`] = await insertTask({
          status: `'${status}'`,
          assigned_admin_user_id: `'${status === 'done' ? SECOND_ADMIN : TEST_ADMIN_ID}'`,
          created_at: `'2026-10-01T08:00:00Z'`,
        });
        ids[`${status}-unassigned`] = await insertTask({ status: `'${status}'`, created_at: `'2026-10-02T08:00:00Z'` });
      }
      await run('up');

      const tasks = await rows<{ id: string; status: string; published_at: Date | null; created_at: Date; is_draft: boolean; is_private: boolean }>(
        `select "id", "status", "published_at", "created_at", "is_draft", "is_private" from "tasks"`,
      );
      expect(tasks).toHaveLength(8);
      for (const status of statuses) {
        expect(tasks.find((task) => task.id === ids[`${status}-assigned`])?.status).toBe(status);
        expect(tasks.find((task) => task.id === ids[`${status}-unassigned`])?.status).toBe(status);
      }
      for (const task of tasks) {
        expect(task.published_at).not.toBeNull();
        expect(new Date(task.published_at!).toISOString()).toBe(new Date(task.created_at).toISOString());
        expect(task.is_draft).toBe(false);
        expect(task.is_private).toBe(false);
      }
      const assignees = await rows<{ task_id: string; admin_user_id: string; assigned_at: Date | null }>(
        `select "task_id", "admin_user_id", "assigned_at" from "task_assignees" order by "task_id"`,
      );
      expect(
        assignees
          .map((row) => ({ task_id: row.task_id, admin_user_id: row.admin_user_id }))
          .sort((a, b) => a.task_id.localeCompare(b.task_id)),
      ).toEqual(
        statuses
          .map((status) => ({
            task_id: ids[`${status}-assigned`]!,
            admin_user_id: status === 'done' ? SECOND_ADMIN : TEST_ADMIN_ID,
          }))
          .sort((a, b) => a.task_id.localeCompare(b.task_id)),
      );
      for (const assignee of assignees) expect(assignee.assigned_at).not.toBeNull();
      expect(await columnsOf('tasks')).not.toContain('assigned_admin_user_id');
    });

    it('down puts back a single assignee — the first by `assigned_at`', async () => {
      const task = ids['todo-assigned']!;
      await rows(
        `insert into "task_assignees" ("task_id", "admin_user_id", "assigned_at") values (?, ?, ?::timestamptz)`,
        [task, THIRD_ADMIN, '2020-01-01T00:00:00Z'],
      );
      await run('down');
      const restored = await rows<{ id: string; assigned_admin_user_id: string | null; status: string }>(
        `select "id", "assigned_admin_user_id", "status" from "tasks"`,
      );
      expect(restored).toHaveLength(8);
      expect(restored.find((row) => row.id === task)?.assigned_admin_user_id).toBe(THIRD_ADMIN);
      expect(restored.find((row) => row.id === ids['done-assigned'])?.assigned_admin_user_id).toBe(SECOND_ADMIN);
      expect(restored.find((row) => row.id === ids['todo-unassigned'])?.assigned_admin_user_id).toBeNull();
      // Up again leaves the database as every other file finds it.
      await run('up');
    });
  });
});
