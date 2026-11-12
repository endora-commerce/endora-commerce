import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261112T124348CoreCommandOutbox } from '@endora-commerce/platform/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `command_outbox` — `specs/176-command-hooks-outbox/` T046 (FR-030,
 * `data-model.md` §1).
 *
 * The kernel-owned table the Command Bus writes one row into per present
 * `afterCommit` handler, inside the Command's own transaction. Asserted against
 * the migrated template every run starts from (`db:fresh`'s result), and the
 * migration's `down()`/`up()` pair inside a rolled-back transaction so the
 * shared database never sees the table missing.
 */
describe('command_outbox (176 T046)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  async function columns(em: EntityManager): Promise<Record<string, { type: string; nullable: string; default: string | null; identity: string }>> {
    const rows = await em.execute<
      Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null; is_identity: string; identity_generation: string | null }>
    >(
      `select column_name, data_type, is_nullable, column_default, is_identity, identity_generation
         from information_schema.columns where table_schema = current_schema() and table_name = 'command_outbox'`,
    );
    return Object.fromEntries(
      rows.map((row) => [
        row.column_name,
        {
          type: row.data_type,
          nullable: row.is_nullable,
          default: row.column_default,
          identity: row.is_identity === 'YES' ? (row.identity_generation ?? 'YES') : 'NO',
        },
      ]),
    );
  }

  async function indexes(em: EntityManager): Promise<Record<string, string>> {
    const rows = await em.execute<Array<{ indexname: string; indexdef: string }>>(
      `select indexname, indexdef from pg_indexes where schemaname = current_schema() and tablename = 'command_outbox'`,
    );
    return Object.fromEntries(rows.map((row) => [row.indexname, row.indexdef]));
  }

  it('has every column data-model §1 names, with its type, nullability and default', async () => {
    const cols = await columns(db.orm.em.fork());
    expect(Object.keys(cols).sort()).toEqual(
      [
        'id',
        'sequence',
        'action',
        'object_type',
        'object_id',
        'organization_id',
        'hook_module',
        'hook_id',
        'data',
        'actor_kind',
        'actor_admin_user_id',
        'impersonated_customer_account_id',
        'actor_customer_account_id',
        'request_id',
        'status',
        'attempts',
        'available_at',
        'locked_until',
        'last_error_code',
        'last_error_class',
        'created_at',
        'delivered_at',
        'dead_at',
      ].sort(),
    );
    expect(cols['id']).toMatchObject({ type: 'uuid', nullable: 'NO' });
    expect(cols['sequence']).toMatchObject({ type: 'bigint', nullable: 'NO', identity: 'ALWAYS' });
    expect(cols['organization_id']).toMatchObject({ type: 'uuid', nullable: 'YES' });
    expect(cols['data']).toMatchObject({ type: 'jsonb', nullable: 'NO' });
    expect(cols['data']!.default).toMatch(/'\{\}'::jsonb/);
    expect(cols['status']).toMatchObject({ type: 'text', nullable: 'NO' });
    expect(cols['status']!.default).toMatch(/'pending'/);
    expect(cols['attempts']).toMatchObject({ type: 'integer', nullable: 'NO', default: '0' });
    expect(cols['available_at']).toMatchObject({ type: 'timestamp with time zone', nullable: 'NO' });
    expect(cols['available_at']!.default).toMatch(/now\(\)/);
    expect(cols['locked_until']).toMatchObject({ type: 'timestamp with time zone', nullable: 'YES' });
    for (const name of ['actor_admin_user_id', 'impersonated_customer_account_id', 'actor_customer_account_id']) {
      expect(cols[name]).toMatchObject({ type: 'uuid', nullable: 'YES' });
    }
    for (const name of ['action', 'object_type', 'object_id', 'hook_module', 'hook_id', 'actor_kind']) {
      expect(cols[name]).toMatchObject({ type: 'text', nullable: 'NO' });
    }
  });

  it('refuses a status outside the four states, and has no foreign key (a kernel table names no module table)', async () => {
    const em = db.orm.em.fork();
    const constraints = await em.execute<Array<{ conname: string; contype: string; def: string }>>(
      `select conname, contype, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'command_outbox'::regclass`,
    );
    expect(constraints.filter((c) => c.contype === 'f')).toEqual([]);
    const statusCheck = constraints.find((c) => c.conname === 'command_outbox_status_check');
    expect(statusCheck?.def).toMatch(/pending/);
    expect(statusCheck?.def).toMatch(/in_flight/);
    expect(statusCheck?.def).toMatch(/delivered/);
    expect(statusCheck?.def).toMatch(/dead/);
    expect(constraints.find((c) => c.contype === 'p')?.def).toBe('PRIMARY KEY (id)');
  });

  it('has the five indexes, partial where data-model §1 says so', async () => {
    const idx = await indexes(db.orm.em.fork());
    expect(idx['command_outbox_due_idx']).toMatch(/\(available_at, sequence\) WHERE \(status = 'pending'::text\)/);
    expect(idx['command_outbox_lease_idx']).toMatch(/\(locked_until\) WHERE \(status = 'in_flight'::text\)/);
    expect(idx['command_outbox_status_seq_idx']).toMatch(/\(status, sequence DESC\)/);
    expect(idx['command_outbox_hook_module_idx']).toMatch(/\(hook_module\)/);
    expect(idx['command_outbox_delivered_purge_idx']).toMatch(/\(delivered_at\) WHERE \(status = 'delivered'::text\)/);
  });

  it('down() drops the table and up() is repeatable', async () => {
    const em = await db.beginTx();
    try {
      const run = async (direction: 'up' | 'down'): Promise<void> => {
        const migration = new Migration20261112T124348CoreCommandOutbox(em.getDriver(), em.config);
        await migration[direction]();
        for (const query of migration.getQueries()) await em.execute(query as string);
      };
      await run('down');
      expect(await columns(em)).toEqual({});
      await run('up');
      await run('up');
      expect(Object.keys(await columns(em))).toHaveLength(23);
    } finally {
      await db.rollbackTx();
    }
  });
});
