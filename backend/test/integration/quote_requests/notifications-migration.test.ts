import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261113T081826QuoteRequestsNotificationsRedesign } from '@endora-commerce/mod-quote-requests/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * `specs/179-rfq-and-customer-notifications/` T010 (FR-008, data-model §1,
 * research R-21) — the `quote_requests` migration that drops
 * `quote_request_notification_events` and creates `quote_request_notifications`.
 *
 * The test database is migrated, so it holds the upgraded schema; `down()` is
 * executed from the migration class itself, inside a transaction every case
 * rolls back, so the shared database never sees the old table again.
 */
describe('179 — quote_request_notifications replaces quote_request_notification_events [integration]', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261113T081826QuoteRequestsNotificationsRedesign(em.getDriver(), em.config);
    await migration[direction]();
    for (const query of migration.getQueries()) await em.execute(String(query));
  }

  const tableExists = async (table: string): Promise<boolean> =>
    ((await em.execute(`select to_regclass(?) as "t"`, [`public.${table}`])) as Array<{ t: string | null }>)[0]!.t !==
    null;

  async function insertQuote(): Promise<{ quoteRequestId: string; organizationId: string }> {
    const quoteRequestId = randomUUID();
    const organizationId = randomUUID();
    await em.execute(
      `insert into "quote_requests" ("id", "organization_id", "customer_account_id", "business_id", "status", "created_at", "updated_at")
       values (?, ?, ?, ?, 'Pending', now(), now())`,
      [quoteRequestId, organizationId, randomUUID(), `179-SCHEMA-${quoteRequestId}`],
    );
    return { quoteRequestId, organizationId };
  }

  async function insertEvent(quoteRequestId: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "quote_request_events" ("id", "quote_request_id", "event_type", "payload", "created_at")
       values (?, ?, 'submitted', '{"type":"submitted"}'::jsonb, now())`,
      [id, quoteRequestId],
    );
    return id;
  }

  interface Row {
    id?: string;
    organization_id: string;
    quote_request_id: string;
    source_event_id: string;
    change?: string;
    recipient_kind?: string;
    recipient_id?: string;
    channel?: string;
    status?: string;
    closed_at?: Date | null;
  }

  async function insertRecord(row: Row): Promise<string> {
    const values = {
      id: randomUUID(),
      change: 'submitted',
      recipient_kind: 'customer',
      recipient_id: randomUUID(),
      channel: 'customer_email',
      source_occurred_at: new Date(),
      ...row,
    };
    const names = Object.keys(values);
    await em.execute(
      `insert into "quote_request_notifications" (${names.map((n) => `"${n}"`).join(', ')})
       values (${names.map(() => '?').join(', ')})`,
      Object.values(values),
    );
    return values.id;
  }

  /** The SQLSTATE a statement fails with, inside a savepoint so the case's transaction survives it. */
  async function refusal(statement: () => Promise<unknown>): Promise<string | null> {
    await em.execute('savepoint "qrn_case"');
    try {
      await statement();
      await em.execute('release savepoint "qrn_case"');
      return null;
    } catch (error) {
      await em.execute('rollback to savepoint "qrn_case"');
      const code = (error as { code?: string }).code;
      return code ?? String(error);
    }
  }

  describe('up — the upgraded schema', () => {
    it('drops the old table and creates the new one with data-model §1’s columns', async () => {
      expect(await tableExists('quote_request_notification_events')).toBe(false);
      const columns = await em.execute(
        `select "column_name", "data_type", "is_nullable", "character_maximum_length", "column_default"
           from information_schema.columns
          where table_schema = current_schema() and table_name = 'quote_request_notifications'
          order by "column_name"`,
      );
      expect(columns).toEqual([
        { column_name: 'attempts', data_type: 'integer', is_nullable: 'NO', character_maximum_length: null, column_default: '0' },
        { column_name: 'change', data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 32, column_default: null },
        { column_name: 'channel', data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 24, column_default: null },
        { column_name: 'closed_at', data_type: 'timestamp with time zone', is_nullable: 'YES', character_maximum_length: null, column_default: null },
        { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', character_maximum_length: null, column_default: 'now()' },
        { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null, column_default: null },
        { column_name: 'last_error', data_type: 'text', is_nullable: 'YES', character_maximum_length: null, column_default: null },
        { column_name: 'next_attempt_at', data_type: 'timestamp with time zone', is_nullable: 'NO', character_maximum_length: null, column_default: 'now()' },
        { column_name: 'organization_id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null, column_default: null },
        { column_name: 'quote_request_id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null, column_default: null },
        { column_name: 'recipient_id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null, column_default: null },
        { column_name: 'recipient_kind', data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 16, column_default: null },
        { column_name: 'source_event_id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null, column_default: null },
        { column_name: 'source_occurred_at', data_type: 'timestamp with time zone', is_nullable: 'NO', character_maximum_length: null, column_default: null },
        { column_name: 'status', data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 32, column_default: "'pending'::character varying" },
      ]);
    });

    it('names every constraint and index of data-model §1', async () => {
      const constraints = (await em.execute(
        `select conname, contype from pg_constraint where conrelid = 'quote_request_notifications'::regclass order by conname`,
      )) as Array<{ conname: string; contype: string }>;
      expect(constraints).toEqual([
        { conname: 'quote_request_notifications_channel_chk', contype: 'c' },
        { conname: 'quote_request_notifications_channel_side_chk', contype: 'c' },
        { conname: 'quote_request_notifications_closed_chk', contype: 'c' },
        { conname: 'quote_request_notifications_event_fk', contype: 'f' },
        { conname: 'quote_request_notifications_pkey', contype: 'p' },
        { conname: 'quote_request_notifications_recipient_kind_chk', contype: 'c' },
        { conname: 'quote_request_notifications_rfq_fk', contype: 'f' },
        { conname: 'quote_request_notifications_status_chk', contype: 'c' },
        { conname: 'quote_request_notifications_unique', contype: 'u' },
      ]);
      const indexes = (await em.execute(
        `select indexname, indexdef from pg_indexes where tablename = 'quote_request_notifications' order by indexname`,
      )) as Array<{ indexname: string; indexdef: string }>;
      expect(indexes.map((i) => i.indexname)).toEqual([
        'quote_request_notifications_due_idx',
        'quote_request_notifications_pkey',
        'quote_request_notifications_request_idx',
        'quote_request_notifications_unique',
      ]);
      const def = (name: string) => indexes.find((i) => i.indexname === name)!.indexdef;
      expect(def('quote_request_notifications_due_idx')).toMatch(/\(next_attempt_at\) WHERE \(\(status\)::text = 'pending'::text\)/);
      expect(def('quote_request_notifications_request_idx')).toMatch(/\(quote_request_id, source_event_id\)/);
      expect(def('quote_request_notifications_unique')).toMatch(
        /UNIQUE INDEX .* \(source_event_id, recipient_kind, recipient_id, channel\)/,
      );
    });

    it('a record defaults to pending, no attempts, due now', async () => {
      const { quoteRequestId, organizationId } = await insertQuote();
      const id = await insertRecord({ organization_id: organizationId, quote_request_id: quoteRequestId, source_event_id: await insertEvent(quoteRequestId) });
      const [row] = (await em.execute(
        `select status, attempts, next_attempt_at <= now() as due, closed_at, last_error, created_at is not null as stamped
           from quote_request_notifications where id = ?`,
        [id],
      )) as Array<Record<string, unknown>>;
      expect(row).toEqual({ status: 'pending', attempts: 0, due: true, closed_at: null, last_error: null, stamped: true });
    });

    it('one record per (source entry, recipient, channel) — FR-002', async () => {
      const { quoteRequestId, organizationId } = await insertQuote();
      const sourceEventId = await insertEvent(quoteRequestId);
      const recipientId = randomUUID();
      const base = { organization_id: organizationId, quote_request_id: quoteRequestId, source_event_id: sourceEventId, recipient_id: recipientId };
      await insertRecord(base);
      expect(await refusal(() => insertRecord(base))).toBe('23505');
      // Another channel for the same person is another record.
      expect(await refusal(() => insertRecord({ ...base, channel: 'customer_in_app' }))).toBeNull();
    });

    it('keeps the vocabularies closed and each channel on its own side', async () => {
      const { quoteRequestId, organizationId } = await insertQuote();
      const base = { organization_id: organizationId, quote_request_id: quoteRequestId, source_event_id: await insertEvent(quoteRequestId) };
      expect(await refusal(() => insertRecord({ ...base, status: 'queued' }))).toBe('23514');
      expect(await refusal(() => insertRecord({ ...base, channel: 'email' }))).toBe('23514');
      expect(await refusal(() => insertRecord({ ...base, recipient_kind: 'guest' }))).toBe('23514');
      expect(await refusal(() => insertRecord({ ...base, recipient_kind: 'customer', channel: 'admin_email' }))).toBe('23514');
      expect(await refusal(() => insertRecord({ ...base, recipient_kind: 'admin', channel: 'customer_push' }))).toBe('23514');
      for (const channel of ['admin_in_app', 'admin_email']) {
        expect(await refusal(() => insertRecord({ ...base, recipient_kind: 'admin', channel }))).toBeNull();
      }
      for (const channel of ['customer_email', 'customer_in_app', 'customer_push']) {
        expect(await refusal(() => insertRecord({ ...base, recipient_kind: 'customer', channel }))).toBeNull();
      }
    });

    it('closed_at is set exactly when the record is no longer pending', async () => {
      const { quoteRequestId, organizationId } = await insertQuote();
      const base = { organization_id: organizationId, quote_request_id: quoteRequestId, source_event_id: await insertEvent(quoteRequestId) };
      expect(await refusal(() => insertRecord({ ...base, status: 'sent', closed_at: null }))).toBe('23514');
      expect(await refusal(() => insertRecord({ ...base, status: 'pending', closed_at: new Date() }))).toBe('23514');
      for (const status of [
        'sent', 'skipped_stale', 'skipped_module_off', 'skipped_deactivated', 'skipped_no_transport',
        'skipped_logged', 'skipped_no_recipient', 'skipped_preference', 'skipped_no_subscription', 'failed',
      ]) {
        expect(await refusal(() => insertRecord({ ...base, status, closed_at: new Date() })), status).toBeNull();
      }
    });

    it('goes with its history entry and with its request (on delete cascade)', async () => {
      const { quoteRequestId, organizationId } = await insertQuote();
      const first = await insertEvent(quoteRequestId);
      const second = await insertEvent(quoteRequestId);
      await insertRecord({ organization_id: organizationId, quote_request_id: quoteRequestId, source_event_id: first });
      await insertRecord({ organization_id: organizationId, quote_request_id: quoteRequestId, source_event_id: second });
      const count = async () =>
        Number(((await em.execute(`select count(*) as n from quote_request_notifications where quote_request_id = ?`, [quoteRequestId])) as Array<{ n: string }>)[0]!.n);
      await em.execute(`delete from quote_request_events where id = ?`, [first]);
      expect(await count()).toBe(1);
      await em.execute(`delete from quote_requests where id = ?`, [quoteRequestId]);
      expect(await count()).toBe(0);
      // And names an existing entry.
      expect(
        await refusal(() =>
          insertRecord({ organization_id: organizationId, quote_request_id: (quoteRequestId), source_event_id: randomUUID() }),
        ),
      ).toBe('23503');
    });

    it('the entity is organisation-scoped (Principle XI)', () => {
      const rows = tenantClassifications().filter((meta) => meta.className === 'QuoteRequestNotification');
      expect(rows).toEqual([expect.objectContaining({ scope: 'org' })]);
      expect(tenantClassifications().filter((meta) => meta.className === 'QuoteRequestNotificationEvent')).toEqual([]);
    });
  });

  describe('down — and up again', () => {
    it('down drops the new table and re-creates the old one, empty, with its dedupe index', async () => {
      await run('down');
      expect(await tableExists('quote_request_notifications')).toBe(false);
      expect(await tableExists('quote_request_notification_events')).toBe(true);
      const columns = (await em.execute(
        `select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = 'quote_request_notification_events' order by column_name`,
      )) as Array<{ column_name: string }>;
      expect(columns.map((c) => c.column_name)).toEqual([
        'channel', 'enqueued_at', 'error', 'id', 'quote_request_id', 'recipient_admin_user_id',
        'recipient_customer_account_id', 'sent_at', 'source_event_id', 'status',
      ]);
      const indexes = (await em.execute(
        `select indexname from pg_indexes where tablename = 'quote_request_notification_events' order by indexname`,
      )) as Array<{ indexname: string }>;
      expect(indexes.map((i) => i.indexname)).toEqual(['qrne_dedupe_idx', 'quote_request_notification_events_pkey']);
      expect(
        Number(((await em.execute(`select count(*) as n from quote_request_notification_events`)) as Array<{ n: string }>)[0]!.n),
      ).toBe(0);
    });

    it('up after down restores the upgraded schema', async () => {
      await run('down');
      await run('up');
      expect(await tableExists('quote_request_notification_events')).toBe(false);
      expect(await tableExists('quote_request_notifications')).toBe(true);
      const constraints = (await em.execute(
        `select count(*) as n from pg_constraint where conrelid = 'quote_request_notifications'::regclass`,
      )) as Array<{ n: string }>;
      expect(Number(constraints[0]!.n)).toBe(9);
    });
  });
});
