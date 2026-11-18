import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrations } from '@endora-commerce/mod-returns/migrations';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/181-guest-complaints/` T007 (data-model §1 – §4, §7): the migration
 * *returns: guest complaints* — the nullable account and the guest columns with
 * their checks and indexes on `return_cases`, `author_guest` on comments, guest
 * ownership on attachments, and `return_guest_verifications`. `down` refuses
 * while a guest case exists.
 *
 * The class is found by its name's tail, so the test does not spell the
 * scaffolded timestamp.
 */
type MigrationClass = (typeof migrations)[number];
const GuestMigration = migrations.find((m) => m.name.endsWith('ReturnsGuestComplaints')) as MigrationClass | undefined;

describe('returns — migration: guest complaints', () => {
  let h: BackendServerHandle;
  let channelId: string;

  async function run(direction: 'up' | 'down'): Promise<void> {
    if (!GuestMigration) throw new Error('the returns_guest_complaints migration is not registered');
    const em = h.em();
    const migration = new GuestMigration(em.getDriver(), em.config);
    await migration[direction]();
    // One transaction: a refused step leaves the schema as it was for the next file.
    await em.getKnex().transaction(async (trx) => {
      for (const query of migration.getQueries()) await trx.raw(query as string);
    });
    em.clear();
  }

  const exec = (sql: string, params: unknown[] = []) => h.em().execute(sql, params);
  const knex = () => h.em().getKnex();

  async function insertCase(over: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await knex()('return_cases').insert({
      id,
      kind: 'complaint',
      order_id: randomUUID(),
      sales_channel_id: channelId,
      customer_account_id: TEST_CUSTOMER_ID,
      organization_id: TEST_ORGANIZATION_ID,
      status_code: 'new',
      currency: 'PLN',
      submitted_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
      ...over,
    });
    return id;
  }

  /** A well-formed guest case: no account, no organization, no order, a session and a version. */
  const guest = (over: Record<string, unknown> = {}) => ({
    customer_account_id: null,
    organization_id: null,
    order_id: null,
    purchase_date: '2026-10-01',
    guest_session_id: randomUUID(),
    tracking_version: 1,
    ...over,
  });

  async function insertVerification(over: Record<string, unknown> = {}): Promise<string> {
    const id = randomUUID();
    await knex()('return_guest_verifications').insert({
      id,
      sales_channel_id: channelId,
      email: 'ewa@example.test',
      email_hash: createHash('sha256').update('ewa@example.test').digest('hex'),
      language: 'pl',
      link_expires_at: new Date(Date.now() + 3_600_000),
      ...over,
    });
    return id;
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const rows = await exec('select count(*)::text as n from information_schema.columns where table_name = ? and column_name = ?', [
      table,
      column,
    ]);
    return (rows as Array<{ n: string }>)[0]?.n === '1';
  }

  async function constraintExists(name: string): Promise<boolean> {
    const rows = await exec('select count(*)::text as n from pg_constraint where conname = ?', [name]);
    return (rows as Array<{ n: string }>)[0]?.n === '1';
  }

  async function indexExists(name: string): Promise<boolean> {
    const rows = await exec('select to_regclass(?)::text as t', [name]);
    return (rows as Array<{ t: string | null }>)[0]?.t !== null;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is registered in the module’s migrations', () => {
    expect(GuestMigration).toBeDefined();
  });

  it('adds the guest columns, checks and indexes', async () => {
    for (const column of ['guest_session_id', 'contact_verified_at', 'tracking_version']) {
      expect(await columnExists('return_cases', column), column).toBe(true);
    }
    expect(await columnExists('return_case_comments', 'author_guest')).toBe(true);
    for (const column of ['guest_session_id', 'uploaded_by_guest']) {
      expect(await columnExists('return_case_attachments', column), column).toBe(true);
    }
    for (const name of [
      'return_cases_guest_no_org_check',
      'return_cases_guest_shape_check',
      'return_cases_customer_shape_check',
      'return_case_comments_guest_author_check',
      'return_case_attachments_owner_check',
    ]) {
      expect(await constraintExists(name), name).toBe(true);
    }
    for (const name of [
      'return_cases_guest_submission_key_unique',
      'return_cases_guest_retention_idx',
      'return_cases_contact_email_idx',
    ]) {
      expect(await indexExists(name), name).toBe(true);
    }
  });

  it('accepts a well-formed guest case', async () => {
    await expect(insertCase(guest())).resolves.toBeTruthy();
  });

  it('refuses a guest case carrying an organization (return_cases_guest_no_org_check)', async () => {
    await expect(insertCase(guest({ organization_id: TEST_ORGANIZATION_ID }))).rejects.toThrow(/return_cases_guest_no_org_check/);
  });

  it.each([
    ['without a session', { guest_session_id: null }],
    ['without a tracking version', { tracking_version: null }],
    ['against an order', { order_id: randomUUID() }],
  ])('refuses a guest case %s', async (_name, over) => {
    await expect(insertCase(guest(over))).rejects.toThrow(/return_cases_guest_shape_check/);
  });

  it('refuses a guest return', async () => {
    // 180's check refuses a return without an order first; either way it never lands.
    await expect(insertCase(guest({ kind: 'return' }))).rejects.toThrow(/check/);
  });

  it('refuses a customer case carrying a guest session or a tracking version', async () => {
    await expect(insertCase({ guest_session_id: randomUUID() })).rejects.toThrow(/return_cases_customer_shape_check/);
    await expect(insertCase({ tracking_version: 1 })).rejects.toThrow(/return_cases_customer_shape_check/);
  });

  it('holds one submission key per guest session, and lets another session reuse it', async () => {
    const session = randomUUID();
    const key = randomUUID();
    await insertCase(guest({ guest_session_id: session, submission_key: key }));
    await expect(insertCase(guest({ guest_session_id: session, submission_key: key }))).rejects.toThrow(
      /return_cases_guest_submission_key_unique/,
    );
    await expect(insertCase(guest({ submission_key: key }))).resolves.toBeTruthy();
  });

  it('lets a guest comment stand only as a customer-visible comment with no author id', async () => {
    const caseId = await insertCase(guest());
    const comment = (over: Record<string, unknown>) =>
      knex()('return_case_comments').insert({ id: randomUUID(), return_case_id: caseId, body: 'Hello', created_at: new Date(), ...over });
    await expect(comment({ author_guest: true })).resolves.toBeDefined();
    await expect(comment({ author_guest: true, is_customer_visible: false })).rejects.toThrow(/return_case_comments_guest_author_check/);
    await expect(comment({ author_guest: true, author_admin_user_id: randomUUID() })).rejects.toThrow(
      /return_case_comments_guest_author_check/,
    );
    await expect(comment({ author_guest: true, author_customer_account_id: TEST_CUSTOMER_ID })).rejects.toThrow(
      /return_case_comments_guest_author_check/,
    );
    const rows = await exec('select "author_guest" from "return_case_comments" where "return_case_id" = ? and "author_guest" = false', [caseId]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a pending attachment with no owner, and accepts one a guest session owns', async () => {
    const pending = (over: Record<string, unknown>) =>
      knex()('return_case_attachments').insert({
        id: randomUUID(),
        storage_locator: `returns/guest/${randomUUID()}`,
        expires_at: new Date(Date.now() + 86_400_000),
        created_at: new Date(),
        ...over,
      });
    await expect(pending({})).rejects.toThrow(/return_case_attachments_owner_check/);
    await expect(pending({ guest_session_id: randomUUID(), uploaded_by_guest: true })).resolves.toBeDefined();
    await expect(pending({ customer_account_id: TEST_CUSTOMER_ID, organization_id: TEST_ORGANIZATION_ID })).resolves.toBeDefined();
  });

  it('holds the verification table’s session pairing and one session per token hash', async () => {
    const hash = createHash('sha256').update(randomUUID()).digest('hex');
    await expect(insertVerification()).resolves.toBeTruthy();
    await expect(insertVerification({ redeemed_at: new Date() })).rejects.toThrow(/check/);
    await expect(insertVerification({ session_token_hash: hash })).rejects.toThrow(/check/);
    await expect(
      insertVerification({ redeemed_at: new Date(), session_token_hash: hash, session_expires_at: new Date(Date.now() + 86_400_000) }),
    ).resolves.toBeTruthy();
    await expect(insertVerification({ redeemed_at: new Date(), session_token_hash: hash })).rejects.toThrow(/unique|duplicate/);
  });

  it('down reverses on a database without guest cases; existing rows survive it and the way back up', async () => {
    await exec('delete from "return_cases" where "customer_account_id" is null');
    await exec('delete from "return_case_comments" where "author_guest" = true');
    await exec('delete from "return_case_attachments" where "guest_session_id" is not null');
    const survivor = await insertCase({ order_id: null, purchase_date: '2026-10-01', submission_key: randomUUID() });

    await run('down');
    expect(await columnExists('return_cases', 'guest_session_id')).toBe(false);
    expect(await columnExists('return_case_comments', 'author_guest')).toBe(false);
    expect(await columnExists('return_case_attachments', 'uploaded_by_guest')).toBe(false);
    expect(await indexExists('return_guest_verifications')).toBe(false);
    await expect(insertCase({ customer_account_id: null, organization_id: null })).rejects.toThrow();

    const legacy = await insertCase();
    await run('up');
    const rows = await exec('select "id", "customer_account_id" from "return_cases" where "id" in (?, ?) order by "id"', [survivor, legacy]);
    expect(rows).toHaveLength(2);
    for (const row of rows as Array<{ customer_account_id: string }>) expect(row.customer_account_id).toBe(TEST_CUSTOMER_ID);
  });

  it('down refuses while a guest case exists', async () => {
    await insertCase(guest());
    await expect(run('down')).rejects.toThrow(/guest/);
    expect(await columnExists('return_cases', 'guest_session_id')).toBe(true);
  });
});
