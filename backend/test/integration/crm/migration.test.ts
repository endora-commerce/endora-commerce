import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CrmOpportunity,
  CrmOpportunityAttachment,
  CrmOpportunityComment,
  CrmOpportunityLink,
  CrmOpportunityReference,
  CrmOpportunityStatus,
  CrmOpportunityStatusHistory,
  CrmOpportunityStatusTransition,
  CrmOpportunityTag,
  CrmOrderStatusMapping,
  CrmStatusPropagation,
  CrmTag,
  CrmValueCountingStatus,
} from '../../helpers/package-entities.js';

/**
 * `crm`'s init migration, read back from the database it produced
 * (`specs/143-crm-sales-opportunities/data-model.md`).
 *
 * The schema is asserted from the catalogue rather than through the entity
 * classes, deliberately: an entity that disagrees with its table would still
 * load, and the constraints this file is about — the partial unique indexes,
 * the two `on delete restrict` foreign keys — are properties no entity
 * declaration carries. Indexes are found by definition, not by name, so the
 * assertion is about what the index enforces.
 */

const TABLES = [
  'crm_opportunities',
  'crm_opportunity_attachments',
  'crm_opportunity_comments',
  'crm_opportunity_links',
  'crm_opportunity_references',
  'crm_opportunity_status_history',
  'crm_opportunity_status_transitions',
  'crm_opportunity_statuses',
  'crm_opportunity_tags',
  'crm_order_status_mappings',
  'crm_status_propagations',
  'crm_tags',
  'crm_value_counting_statuses',
] as const;

describe('crm init migration', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await h.orm.em.getConnection().execute(sql, params)) as T[];
  }

  /** Every index definition on `table`, as Postgres prints it. */
  async function indexDefinitions(table: string): Promise<string[]> {
    const found = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = current_schema() and tablename = ?`,
      [table],
    );
    return found.map((row) => row.indexdef.replace(/\s+/g, ' '));
  }

  it('creates the thirteen tables of the data model and no fourteenth', async () => {
    const found = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = current_schema() and table_name like 'crm\\_%' order by table_name`,
    );
    expect(found.map((row) => row.table_name)).toEqual([...TABLES]);
  });

  it('adds the custom-field value bag to the opportunity — jsonb, not null, empty by default', async () => {
    const found = await rows<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema() and table_name = 'crm_opportunities'
          and column_name = 'custom_field_values'`,
    );
    expect(found).toEqual([{ data_type: 'jsonb', is_nullable: 'NO', column_default: `'{}'::jsonb` }]);
    // The bag is the host row's own column: no other CRM table gained one.
    const elsewhere = await rows<{ table_name: string }>(
      `select table_name from information_schema.columns
        where table_schema = current_schema() and table_name like 'crm\\_%'
          and column_name = 'custom_field_values' and table_name <> 'crm_opportunities'`,
    );
    expect(elsewhere).toEqual([]);
  });

  it('creates the opportunity number sequence', async () => {
    const found = await rows<{ sequence_name: string }>(
      `select sequence_name from information_schema.sequences
        where sequence_schema = current_schema() and sequence_name = 'crm_opportunity_number_seq'`,
    );
    expect(found).toHaveLength(1);
  });

  it('allows at most one initial status — a partial unique index on is_initial', async () => {
    const definitions = await indexDefinitions('crm_opportunity_statuses');
    expect(
      definitions.some((d) => /CREATE UNIQUE INDEX .*\(is_initial\) WHERE \(?is_initial/.test(d)),
      definitions.join('\n'),
    ).toBe(true);

    // The constraint, exercised: a second initial status is refused.
    await expect(
      rows(
        `insert into "crm_opportunity_statuses"
           ("id", "code", "name", "default_name", "kind", "is_initial", "created_at", "updated_at")
         values (gen_random_uuid(), 'second_initial', '{}', 'Second', 'open', true, now(), now())`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it('allows one mapping per key in each direction — two partial unique indexes', async () => {
    const definitions = await indexDefinitions('crm_order_status_mappings');
    expect(
      definitions.some(
        (d) =>
          /CREATE UNIQUE INDEX .*\(opportunity_status_code\) WHERE/.test(d) &&
          d.includes("'opportunity_to_order'"),
      ),
      definitions.join('\n'),
    ).toBe(true);
    expect(
      definitions.some(
        (d) =>
          /CREATE UNIQUE INDEX .*\(order_status_code\) WHERE/.test(d) &&
          d.includes("'order_to_opportunity'"),
      ),
      definitions.join('\n'),
    ).toBe(true);
  });

  it('links a document to at most one opportunity — unique (document_kind, document_id)', async () => {
    const definitions = await indexDefinitions('crm_opportunity_links');
    expect(
      definitions.some((d) => /CREATE UNIQUE INDEX .*\(document_kind, document_id\)$/.test(d)),
      definitions.join('\n'),
    ).toBe(true);
  });

  it('restricts deleting an organization or a sales channel an opportunity names', async () => {
    const found = await rows<{ referenced: string; column_name: string; on_delete: string }>(
      `select confrelid::regclass::text as referenced,
              a.attname as column_name,
              c.confdeltype as on_delete
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f' and c.conrelid = 'crm_opportunities'::regclass
        order by a.attname`,
    );
    // `r` is RESTRICT in `pg_constraint.confdeltype`.
    expect(found).toEqual([
      { referenced: 'organizations', column_name: 'organization_id', on_delete: 'r' },
      { referenced: 'sales_channels', column_name: 'sales_channel_id', on_delete: 'r' },
    ]);
  });

  it('cascades from an opportunity to every child table', async () => {
    const found = await rows<{ child: string; on_delete: string }>(
      `select c.conrelid::regclass::text as child, c.confdeltype as on_delete
         from pg_constraint c
        where c.contype = 'f' and c.confrelid = 'crm_opportunities'::regclass
        order by 1`,
    );
    // `c` is CASCADE.
    expect(found).toEqual(
      [
        'crm_opportunity_attachments',
        'crm_opportunity_comments',
        'crm_opportunity_links',
        'crm_opportunity_references',
        'crm_opportunity_status_history',
        'crm_opportunity_tags',
        'crm_status_propagations',
      ].map((child) => ({ child, on_delete: 'c' })),
    );
  });

  it('every entity class reads its own table — no column the migration did not create', async () => {
    // A `select` of every mapped column, per class. An entity property with no
    // column behind it loads fine and fails on the first query, in whichever
    // story happens to run that query first; this is where it fails instead.
    // `filters: false`: the subject is the mapping, not the tenant scope.
    const classes = [
      CrmOpportunity,
      CrmOpportunityAttachment,
      CrmOpportunityComment,
      CrmOpportunityLink,
      CrmOpportunityReference,
      CrmOpportunityStatus,
      CrmOpportunityStatusHistory,
      CrmOpportunityStatusTransition,
      CrmOpportunityTag,
      CrmOrderStatusMapping,
      CrmStatusPropagation,
      CrmTag,
      CrmValueCountingStatus,
    ];
    expect(classes).toHaveLength(TABLES.length);
    const em = h.em();
    for (const entityClass of classes) {
      await expect(
        em.find(entityClass, {}, { limit: 1, filters: false }),
        entityClass.name,
      ).resolves.toBeDefined();
    }
    const statuses = await em.find(CrmOpportunityStatus, {}, { filters: false });
    expect(statuses.find((status) => status.code === 'new')).toMatchObject({
      kind: 'open',
      isInitial: true,
      name: { en: 'New', pl: 'Nowa' },
    });
  });

  it('seeds the six default statuses, exactly one of them initial and open', async () => {
    const found = await rows<{ code: string; kind: string; is_initial: boolean; weight: number }>(
      `select "code", "kind", "is_initial", "weight" from "crm_opportunity_statuses"
        where "code" in ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')
        order by "weight"`,
    );
    expect(found).toEqual([
      { code: 'new', kind: 'open', is_initial: true, weight: 10 },
      { code: 'qualified', kind: 'open', is_initial: false, weight: 20 },
      { code: 'proposal', kind: 'open', is_initial: false, weight: 30 },
      { code: 'negotiation', kind: 'open', is_initial: false, weight: 40 },
      { code: 'won', kind: 'won', is_initial: false, weight: 90 },
      { code: 'lost', kind: 'lost', is_initial: false, weight: 100 },
    ]);
    const initials = await rows<{ code: string }>(
      `select "code" from "crm_opportunity_statuses" where "is_initial"`,
    );
    expect(initials).toEqual([{ code: 'new' }]);
  });

  it('seeds the default transitions, reopening included', async () => {
    const found = await rows<{ edge: string }>(
      `select "from_status_code" || '>' || "to_status_code" as edge
         from "crm_opportunity_status_transitions"`,
    );
    const edges = new Set(found.map((row) => row.edge));
    for (const edge of [
      'new>qualified',
      'qualified>proposal',
      'proposal>negotiation',
      'negotiation>won',
      'proposal>won',
      'new>lost',
      'qualified>lost',
      'proposal>lost',
      'negotiation>lost',
      'lost>new',
    ]) {
      expect(edges.has(edge), `missing seeded transition ${edge}`).toBe(true);
    }
  });

  it('seeds no mapping and no counting status — those name the operator’s Order statuses', async () => {
    const [mappings] = await rows<{ count: string }>(
      `select count(*) as count from "crm_order_status_mappings"`,
    );
    const [counting] = await rows<{ count: string }>(
      `select count(*) as count from "crm_value_counting_statuses"`,
    );
    expect(Number(mappings?.count)).toBe(0);
    expect(Number(counting?.count)).toBe(0);
  });
});
