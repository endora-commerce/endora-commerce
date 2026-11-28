import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `projects`' init migration, read back from the database it produced
 * (`specs/163-projects-and-tasks/data-model.md` §2).
 *
 * Asserted from the catalogue rather than through the entity classes, as CRM's
 * and `tasks`' migration tests are: the checks, the deferred constraints and
 * the indexes are properties no entity declaration carries. Indexes are found
 * by definition, not by name, so the assertion is about what an index covers.
 */

/**
 * The 25 tables of the data model: seven of configuration, seventeen of
 * Projects, and the list's saved views (issue #1734).
 */
const TABLES = [
  'project_attachments',
  'project_comments',
  'project_links',
  'project_list_saved_views',
  'project_loss_reasons',
  'project_member_roles',
  'project_members',
  'project_message_read_baselines',
  'project_message_reads',
  'project_organizations',
  'project_references',
  'project_roles',
  'project_stage_alert_deliveries',
  'project_stage_entries',
  'project_stage_moves',
  'project_stage_tasks',
  'project_stages',
  'project_template_roles',
  'project_template_stage_moves',
  'project_template_stage_tasks',
  'project_template_stages',
  'project_templates',
  'project_value_changes',
  'project_viewers',
  'projects',
].sort();

describe('projects init migration', () => {
  let h: BackendServerHandle;
  const created: string[] = [];
  /** Project Roles a case inserted — deleted after the Projects that hold them. */
  const createdRoles: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (created.length > 0) {
      await h.orm.em
        .getConnection()
        .execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    if (createdRoles.length > 0) {
      // Left behind, the "Installer" Role made a later file's own "Installer" a duplicate name (409).
      await h.orm.em
        .getConnection()
        .execute(`delete from "project_roles" where "id" = any(?::uuid[])`, [`{${createdRoles.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await h.orm.em.getConnection().execute(sql, params)) as T[];
  }

  async function indexDefinitions(table: string): Promise<string[]> {
    const found = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = current_schema() and tablename = ?`,
      [table],
    );
    return found.map((row) => row.indexdef.replace(/\s+/g, ' '));
  }

  function expectIndex(definitions: string[], pattern: RegExp): void {
    expect(definitions.some((d) => pattern.test(d)), `${pattern}\n${definitions.join('\n')}`).toBe(true);
  }

  /**
   * One open Project in its first Stage, written as the module writes it: the
   * Project, its Stage and the Project's current Stage in **one** transaction,
   * because an open Project without a current Stage is refused at commit.
   * `overrides` are SQL expressions keyed by `projects` column.
   */
  async function insertProject(overrides: Record<string, string> = {}): Promise<{ projectId: string; stageId: string }> {
    const projectId = randomUUID();
    const stageId = randomUUID();
    const values: Record<string, string> = {
      id: `'${projectId}'`,
      number: `'PRJ-M${Math.floor(Math.random() * 1e9)}'`,
      title: `'migration-test ${projectId}'`,
      created_by_admin_user_id: `'${TEST_ADMIN_ID}'`,
      ...overrides,
    };
    const columns = Object.keys(values);
    await h.orm.em.getConnection().transactional(async (trx) => {
      const run = (sql: string) => h.orm.em.getConnection().execute(sql, [], 'run', trx);
      await run(
        `insert into "projects" (${columns.map((c) => `"${c}"`).join(', ')})
         values (${columns.map((c) => values[c]).join(', ')})`,
      );
      await run(
        `insert into "project_stages" ("id", "project_id", "name", "color", "position")
         values ('${stageId}', '${projectId}', 'Design', '#3b82f6', 1)`,
      );
      await run(`update "projects" set "current_stage_id" = '${stageId}' where "id" = '${projectId}'`);
    });
    created.push(projectId);
    return { projectId, stageId };
  }

  it('creates the 25 tables of the data model and no twenty-sixth', async () => {
    const found = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = current_schema()
          and (table_name = 'projects' or table_name like 'project\\_%')
        order by table_name`,
    );
    expect(found.map((row) => row.table_name)).toEqual(TABLES);
    expect(TABLES).toHaveLength(25);
  });

  it('has the columns of `projects`, with their types, nullability and defaults', async () => {
    const found = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema() and table_name = 'projects'
        order by ordinal_position`,
    );
    expect(found).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
      { column_name: 'number', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'title', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'description', data_type: 'text', is_nullable: 'NO', column_default: "''::text" },
      { column_name: 'value_amount', data_type: 'numeric', is_nullable: 'YES', column_default: null },
      { column_name: 'value_currency', data_type: 'character', is_nullable: 'YES', column_default: null },
      { column_name: 'start_on', data_type: 'date', is_nullable: 'NO', column_default: 'CURRENT_DATE' },
      { column_name: 'state', data_type: 'text', is_nullable: 'NO', column_default: "'open'::text" },
      { column_name: 'current_stage_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'closed_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { column_name: 'lost_stage_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'loss_reason_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'loss_comment', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'visibility', data_type: 'text', is_nullable: 'NO', column_default: "'inherit'::text" },
      { column_name: 'template_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'custom_field_values', data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb" },
      { column_name: 'created_by_admin_user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'version', data_type: 'integer', is_nullable: 'NO', column_default: '1' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      // Issue #449 — the token of the Project's sets, added by a later migration.
      { column_name: 'configuration_version', data_type: 'integer', is_nullable: 'NO', column_default: '1' },
      // `specs/192-organization-merge/` US6 — the archived loser's pointer (`…_projects_merge_pointer`).
      { column_name: 'merged_into_project_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'merged_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { column_name: 'merge_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
    ]);
    const amount = await rows<{ numeric_precision: number; numeric_scale: number }>(
      `select numeric_precision, numeric_scale from information_schema.columns
        where table_schema = current_schema() and table_name = 'projects' and column_name = 'value_amount'`,
    );
    expect(amount).toEqual([{ numeric_precision: 18, numeric_scale: 2 }]);
  });

  it('keeps the custom-field value bag on `projects` and, since issue #2005, on a note alone', async () => {
    const elsewhere = await rows<{ table_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select table_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema() and table_name like 'project\\_%'
          and column_name = 'custom_field_values'`,
    );
    expect(elsewhere).toEqual([
      { table_name: 'project_comments', data_type: 'jsonb', is_nullable: 'NO', column_default: `'{}'::jsonb` },
    ]);
  });

  it('creates the number sequence', async () => {
    const found = await rows<{ sequence_name: string }>(
      `select sequence_name from information_schema.sequences
        where sequence_schema = current_schema() and sequence_name = 'projects_number_seq'`,
    );
    expect(found).toHaveLength(1);
  });

  it('has exactly one foreign key out of the module: an Organization, on delete restrict', async () => {
    const found = await rows<{ child: string; column_name: string; referenced: string; on_delete: string }>(
      `select c.conrelid::regclass::text as child, a.attname as column_name,
              c.confrelid::regclass::text as referenced, c.confdeltype as on_delete
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f'
          and (c.conrelid::regclass::text = 'projects' or c.conrelid::regclass::text like 'project\\_%')
          and not (c.confrelid::regclass::text = 'projects' or c.confrelid::regclass::text like 'project\\_%')`,
    );
    // `r` is RESTRICT in `pg_constraint.confdeltype`.
    expect(found).toEqual([
      { child: 'project_organizations', column_name: 'organization_id', referenced: 'organizations', on_delete: 'r' },
    ]);
  });

  it('cascades from a Project to every table it owns', async () => {
    const found = await rows<{ child: string; on_delete: string }>(
      `select c.conrelid::regclass::text as child, c.confdeltype as on_delete
         from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'projects'::regclass
        order by 1`,
    );
    expect(found).toEqual(
      [
        'project_attachments',
        'project_comments',
        'project_links',
        'project_members',
        'project_message_reads',
        'project_organizations',
        'project_references',
        'project_stage_entries',
        'project_stage_moves',
        'project_stages',
        'project_value_changes',
        'project_viewers',
        // `specs/192-organization-merge/` US6 — an archived duplicate goes with the Project it was merged into.
        'projects',
      ].map((child) => ({ child, on_delete: 'c' })),
    );
  });

  describe('projects — checks', () => {
    it('refuses an open Project without a current Stage at commit — a deferred constraint', async () => {
      const id = randomUUID();
      await expect(
        rows(
          `insert into "projects" ("id", "number", "title", "created_by_admin_user_id")
           values ('${id}', 'PRJ-NOSTAGE-${id.slice(0, 8)}', 'migration-test no stage', '${TEST_ADMIN_ID}')`,
        ),
      ).rejects.toThrow(/projects_open_has_current_stage/);
      expect(await rows(`select 1 from "projects" where "id" = ?`, [id])).toEqual([]);
      // Inside one transaction the Stage may come after the Project.
      await expect(insertProject()).resolves.toBeDefined();
    });

    it('holds the state, the visibility and the outcome columns together', async () => {
      await expect(insertProject({ state: `'archived'` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ visibility: `'nobody'` })).rejects.toThrow(/check constraint/i);
      for (const visibility of ['inherit', 'everyone', 'members_and_listed']) {
        await expect(insertProject({ visibility: `'${visibility}'` }), visibility).resolves.toBeDefined();
      }
      // Closed iff not open.
      await expect(insertProject({ closed_at: 'now()' })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ state: `'completed'` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ state: `'completed'`, closed_at: 'now()' })).resolves.toBeDefined();
      // Lost iff a loss reason (and the Stage it was lost in).
      const reason = (await rows<{ id: string }>(`select "id" from "project_loss_reasons" where "code" = 'price'`))[0]!.id;
      await expect(insertProject({ state: `'lost'`, closed_at: 'now()' })).rejects.toThrow(/check constraint/i);
      await expect(
        insertProject({ state: `'completed'`, closed_at: 'now()', loss_reason_id: `'${reason}'` }),
      ).rejects.toThrow(/check constraint/i);
    });

    it('takes a value as an amount and its currency, or neither; never negative', async () => {
      await expect(insertProject({ value_amount: '100.50' })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ value_currency: `'PLN'` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ value_amount: '-1', value_currency: `'PLN'` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ value_amount: '100.50', value_currency: `'PLN'` })).resolves.toBeDefined();
    });

    it('holds the title to 1–200 characters, the description to 20 000 and the loss comment to 2 000', async () => {
      await expect(insertProject({ title: `''` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ title: `repeat('t', 201)` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ title: `repeat('t', 200)` })).resolves.toBeDefined();
      await expect(insertProject({ description: `repeat('d', 20001)` })).rejects.toThrow(/check constraint/i);
      await expect(insertProject({ loss_comment: `repeat('c', 2001)` })).rejects.toThrow(/check constraint/i);
    });

    it('keeps the number unique', async () => {
      const number = `'PRJ-UNIQ-${randomUUID()}'`;
      await expect(insertProject({ number })).resolves.toBeDefined();
      await expect(insertProject({ number })).rejects.toThrow(/unique|duplicate/i);
    });
  });

  describe('Stages', () => {
    it('keeps a Stage’s position unique in its Project, checked at commit — a deferrable constraint', async () => {
      const definitions = await indexDefinitions('project_stages');
      expectIndex(definitions, /CREATE UNIQUE INDEX .*\(project_id, "?position"?\)$/);
      const deferrable = await rows<{ condeferrable: boolean; condeferred: boolean }>(
        `select condeferrable, condeferred from pg_constraint
          where conrelid = 'project_stages'::regclass and contype = 'u'`,
      );
      expect(deferrable).toEqual([{ condeferrable: true, condeferred: true }]);
    });

    it('holds a Stage’s name, colour, duration and alert offsets to the data model', async () => {
      const { projectId } = await insertProject();
      const insertStage = (overrides: Record<string, string>, position: number) =>
        rows(
          `insert into "project_stages" ("project_id", "name", "color", "position", "planned_duration_days", "alert_offsets_days")
           values ('${projectId}', ${overrides['name'] ?? `'Stage'`}, ${overrides['color'] ?? `'#000000'`}, ${position},
                   ${overrides['planned_duration_days'] ?? '0'}, ${overrides['alert_offsets_days'] ?? `'{}'`})`,
        );
      await expect(insertStage({ name: `''` }, 10)).rejects.toThrow(/check constraint/i);
      await expect(insertStage({ name: `repeat('n', 81)` }, 11)).rejects.toThrow(/check constraint/i);
      await expect(insertStage({ color: `'blue'` }, 12)).rejects.toThrow(/check constraint/i);
      await expect(insertStage({ planned_duration_days: '-1' }, 13)).rejects.toThrow(/check constraint/i);
      await expect(insertStage({ planned_duration_days: '3651' }, 14)).rejects.toThrow(/check constraint/i);
      await expect(insertStage({ alert_offsets_days: `'{0}'` }, 15)).rejects.toThrow(/check constraint/i);
      await expect(insertStage({ alert_offsets_days: `'{366}'` }, 16)).rejects.toThrow(/check constraint/i);
      await expect(
        insertStage({ name: `'Delivery'`, planned_duration_days: '3650', alert_offsets_days: `'{1,7,365}'` }, 17),
      ).resolves.toBeDefined();
    });

    it('has the Stage columns of the data model', async () => {
      const found = await rows<{ column_name: string; data_type: string; udt_name: string; is_nullable: string }>(
        `select column_name, data_type, udt_name, is_nullable from information_schema.columns
          where table_schema = current_schema() and table_name = 'project_stages'
          order by ordinal_position`,
      );
      expect(found.map((c) => [c.column_name, c.udt_name, c.is_nullable])).toEqual([
        ['id', 'uuid', 'NO'],
        ['project_id', 'uuid', 'NO'],
        ['name', 'text', 'NO'],
        ['color', 'text', 'NO'],
        ['position', 'int4', 'NO'],
        ['planned_duration_days', 'int4', 'NO'],
        ['responsible_role_ids', '_uuid', 'NO'],
        ['alert_offsets_days', '_int4', 'NO'],
        ['completion_gate', 'bool', 'NO'],
        ['completion_permitted', 'bool', 'NO'],
        ['started_on', 'date', 'YES'],
        ['deadline_on', 'date', 'YES'],
        ['deadline_manual', 'bool', 'NO'],
        ['tasks_materialized_at', 'timestamptz', 'YES'],
        ['tasks_skipped_at', 'timestamptz', 'YES'],
        ['created_at', 'timestamptz', 'NO'],
        ['updated_at', 'timestamptz', 'NO'],
        // Issue #449 — the token of the Stage's own edits, added by a later migration.
        ['version', 'int4', 'NO'],
      ]);
    });

    it('refuses a move from a Stage to itself, and keys moves by their two Stages', async () => {
      const { projectId, stageId } = await insertProject();
      await expect(
        rows(
          `insert into "project_stage_moves" ("project_id", "from_stage_id", "to_stage_id")
           values ('${projectId}', '${stageId}', '${stageId}')`,
        ),
      ).rejects.toThrow(/check constraint/i);
      expectIndex(await indexDefinitions('project_stage_moves'), /CREATE UNIQUE INDEX .*\(from_stage_id, to_stage_id\)$/);
      expectIndex(
        await indexDefinitions('project_template_stage_moves'),
        /CREATE UNIQUE INDEX .*\(from_stage_id, to_stage_id\)$/,
      );
    });

    it('records Stage history with its kinds, notes and the index analytics read', async () => {
      const { projectId } = await insertProject();
      await expect(
        rows(
          `insert into "project_stage_entries" ("project_id", "kind", "to_stage_name") values ('${projectId}', 'teleport', 'X')`,
        ),
      ).rejects.toThrow(/check constraint/i);
      for (const kind of ['enter', 'close_completed', 'close_lost', 'reopen']) {
        await expect(
          rows(`insert into "project_stage_entries" ("project_id", "kind") values ('${projectId}', '${kind}')`),
          kind,
        ).resolves.toBeDefined();
      }
      const notes = await rows<{ notes: string[] }>(
        `select "notes" from "project_stage_entries" where "project_id" = ? limit 1`,
        [projectId],
      );
      expect(notes[0]?.notes).toEqual([]);
      expectIndex(await indexDefinitions('project_stage_entries'), /CREATE INDEX .*\(project_id, "?at"?\)$/);
    });
  });

  describe('links, collaboration and alerts', () => {
    it('links a record to at most one Project — unique (record_kind, record_id)', async () => {
      expectIndex(await indexDefinitions('project_links'), /CREATE UNIQUE INDEX .*\(record_kind, record_id\)$/);
      const { projectId } = await insertProject();
      await rows(`insert into "project_organizations" ("project_id", "organization_id") values (?, ?)`, [
        projectId,
        TEST_ORGANIZATION_ID,
      ]);
      await expect(
        rows(
          `insert into "project_links" ("project_id", "record_kind", "record_id", "organization_id")
           values ('${projectId}', 'invoice', gen_random_uuid(), '${TEST_ORGANIZATION_ID}')`,
        ),
      ).rejects.toThrow(/check constraint/i);
    });

    it('keeps a link’s Organization one of its Project’s, and holds that Organization on the Project while linked (T092)', async () => {
      const { projectId } = await insertProject();
      const link = (organizationId: string) =>
        rows(
          `insert into "project_links" ("project_id", "record_kind", "record_id", "organization_id")
           values (?, 'order', gen_random_uuid(), ?)`,
          [projectId, organizationId],
        );
      // The Project does not have the Organization yet.
      await expect(link(TEST_ORGANIZATION_ID)).rejects.toThrow(/foreign key/i);
      await rows(`insert into "project_organizations" ("project_id", "organization_id") values (?, ?)`, [
        projectId,
        TEST_ORGANIZATION_ID,
      ]);
      await link(TEST_ORGANIZATION_ID);
      await expect(
        rows(`delete from "project_organizations" where "project_id" = ? and "organization_id" = ?`, [
          projectId,
          TEST_ORGANIZATION_ID,
        ]),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        rows(`insert into "project_links" ("project_id", "record_kind", "record_id") values (?, 'order', gen_random_uuid())`, [
          projectId,
        ]),
      ).rejects.toThrow(/not-null|null value/i);
      // Deleting the Project takes both rows in one statement.
      await rows(`delete from "projects" where "id" = ?`, [projectId]);
      expect(await rows(`select 1 from "project_links" where "project_id" = ?`, [projectId])).toEqual([]);
    });

    it('settles an alert once per (Stage, offset, deadline) — unique', async () => {
      expectIndex(
        await indexDefinitions('project_stage_alert_deliveries'),
        /CREATE UNIQUE INDEX .*\(stage_id, offset_days, deadline_on\)$/,
      );
      const { stageId } = await insertProject();
      const deliver = () =>
        rows(
          `insert into "project_stage_alert_deliveries" ("stage_id", "offset_days", "deadline_on") values ('${stageId}', 7, '2026-12-01')`,
        );
      await expect(deliver()).resolves.toBeDefined();
      await expect(deliver()).rejects.toThrow(/unique|duplicate/i);
      await expect(
        rows(
          `insert into "project_stage_alert_deliveries" ("stage_id", "offset_days", "deadline_on", "outcome")
           values ('${stageId}', 3, '2026-12-01', 'pigeon')`,
        ),
      ).rejects.toThrow(/check constraint/i);
      // A claim its pass never settled (issue #462), and the index the sweep finds it by.
      await expect(
        rows(
          `insert into "project_stage_alert_deliveries" ("stage_id", "offset_days", "deadline_on", "outcome")
           values ('${stageId}', 1, '2026-12-01', 'interrupted')`,
        ),
      ).resolves.toBeDefined();
      expectIndex(
        await indexDefinitions('project_stage_alert_deliveries'),
        /CREATE INDEX .*\(claimed_at\) WHERE \(outcome IS NULL\)$/,
      );
    });

    it('holds comment kinds and reference targets to their sets, and indexes references by target', async () => {
      const { projectId } = await insertProject();
      await expect(
        rows(
          `insert into "project_comments" ("project_id", "kind", "body", "author_admin_user_id")
           values ('${projectId}', 'memo', 'x', '${TEST_ADMIN_ID}')`,
        ),
      ).rejects.toThrow(/check constraint/i);
      for (const target of ['admin_user', 'order', 'product', 'quote_request', 'task']) {
        await expect(
          rows(
            `insert into "project_references" ("project_id", "source_kind", "target_type", "target_id")
             values ('${projectId}', 'description', '${target}', gen_random_uuid())`,
          ),
          target,
        ).resolves.toBeDefined();
      }
      await expect(
        rows(
          `insert into "project_references" ("project_id", "source_kind", "target_type", "target_id")
           values ('${projectId}', 'description', 'invoice', gen_random_uuid())`,
        ),
      ).rejects.toThrow(/check constraint/i);
      expectIndex(await indexDefinitions('project_references'), /CREATE INDEX .*\(target_type, target_id\)$/);
    });

    it('attaches an asset to a Project once', async () => {
      expectIndex(await indexDefinitions('project_attachments'), /CREATE UNIQUE INDEX .*\(project_id, asset_id\)$/);
    });

    it('records when unread messages started being counted — one row, written by the migration, and no second', async () => {
      const found = await rows<{ id: number; in_the_past: boolean }>(
        `select "id", "unread_since" <= now() as in_the_past from "project_message_read_baselines"`,
      );
      expect(found).toEqual([{ id: 1, in_the_past: true }]);
      await expect(
        rows(`insert into "project_message_read_baselines" ("id", "unread_since") values (2, now())`),
      ).rejects.toThrow(/check constraint/i);
    });
  });

  describe('Members', () => {
    it('makes a person a Member of a Project once, and refuses deleting a Role a Member holds', async () => {
      const { projectId } = await insertProject();
      const memberId = randomUUID();
      await rows(`insert into "project_members" ("id", "project_id", "admin_user_id") values (?, ?, ?)`, [
        memberId,
        projectId,
        TEST_ADMIN_ID,
      ]);
      await expect(
        rows(`insert into "project_members" ("project_id", "admin_user_id") values (?, ?)`, [projectId, TEST_ADMIN_ID]),
      ).rejects.toThrow(/unique|duplicate/i);
      const roleId = randomUUID();
      await rows(
        `insert into "project_roles" ("id", "code", "name", "default_name", "position")
         values (?, ?, '{"en": "Installer"}', 'Installer', 99)`,
        [roleId, `installer_${roleId.slice(0, 8)}`],
      );
      createdRoles.push(roleId);
      await rows(`insert into "project_member_roles" ("member_id", "role_id") values (?, ?)`, [memberId, roleId]);
      await expect(rows(`delete from "project_roles" where "id" = ?`, [roleId])).rejects.toThrow(/foreign key/i);
    });
  });

  describe('seeds', () => {
    it('seeds the two system Roles with English and Polish names', async () => {
      const found = await rows<{ code: string; name: Record<string, string>; default_name: string; is_system: boolean; archived_at: Date | null }>(
        `select "code", "name", "default_name", "is_system", "archived_at" from "project_roles"
          where "is_system" order by "position"`,
      );
      expect(found).toEqual([
        { code: 'sales_rep', name: { en: 'Sales Rep', pl: 'Handlowiec' }, default_name: 'Sales Rep', is_system: true, archived_at: null },
        {
          code: 'project_manager',
          name: { en: 'Project Manager', pl: 'Kierownik Projektu' },
          default_name: 'Project Manager',
          is_system: true,
          archived_at: null,
        },
      ]);
    });

    it('seeds the five system loss reasons, each named in English and Polish', async () => {
      const found = await rows<{ code: string; name: Record<string, string>; is_system: boolean }>(
        `select "code", "name", "is_system" from "project_loss_reasons" where "is_system" order by "position"`,
      );
      expect(found.map((row) => row.code)).toEqual(['price', 'competitor', 'cancelled_by_client', 'no_decision', 'other']);
      for (const row of found) {
        expect(Object.keys(row.name).sort(), row.code).toEqual(['en', 'pl']);
        expect(row.is_system).toBe(true);
      }
    });

    it('seeds no Template', async () => {
      expect(await rows(`select 1 from "project_templates"`)).toEqual([]);
    });
  });

  it('every entity class reads its own table — no column the migration did not create', async () => {
    // A `select` of every mapped column, per class of the module. An entity
    // property with no column behind it loads fine and fails on the first
    // query; this is where it fails instead. `filters: false`: the subject is
    // the mapping, not the tenant scope.
    const metadata = [...new Set(h.orm.getMetadata().getAll().values())].filter(
      (meta) => meta.tableName === 'projects' || meta.tableName?.startsWith('project_'),
    );
    expect(metadata.map((meta) => meta.tableName).sort()).toEqual(TABLES);
    const em = h.em();
    for (const meta of metadata) {
      await expect(
        em.find(meta.class, {}, { limit: 1, filters: false }),
        meta.className,
      ).resolves.toBeDefined();
    }
  });
});
