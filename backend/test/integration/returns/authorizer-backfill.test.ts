import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Migration20261113T145001ReturnsAuthorizerStatusNotifications } from '@endora-commerce/mod-returns/migrations';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReturnCase } from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/180-off-platform-complaints/` T007 (FR-A43, research R-8, data-model §1.3) —
 * migration A adds the authorizer column and the status flag, and back-fills the
 * authorizer of cases authorized before the release from the kernel's audit log.
 *
 * The statements come from the migration class, so a change to the backfill shows
 * up here. The test server has already migrated, so the columns exist; `up` is
 * idempotent (`if not exists`) and its backfill only fills nulls.
 */
describe('returns — migration A: the authorizer backfill', () => {
  let h: BackendServerHandle;
  let channelId: string;

  async function run(direction: 'up' | 'down'): Promise<void> {
    const em = h.em();
    const migration = new Migration20261113T145001ReturnsAuthorizerStatusNotifications(em.getDriver(), em.config);
    await migration[direction]();
    for (const query of migration.getQueries()) await em.execute(query as string);
    em.clear();
  }

  async function seedCase(opts: { authorizedAt: Date | null; authorizedBy?: string | null }): Promise<string> {
    const em = h.em().fork();
    const rc = em.create(ReturnCase, {
      kind: 'complaint',
      orderId: randomUUID(),
      salesChannelId: channelId,
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      statusCode: opts.authorizedAt ? 'authorized' : 'new',
      currency: 'PLN',
      submittedAt: new Date('2026-10-01T10:00:00Z'),
      authorizedAt: opts.authorizedAt,
    } as never);
    await em.persistAndFlush(rc);
    const id = (rc as unknown as { id: string }).id;
    await em.execute('update "return_cases" set "authorized_by_admin_user_id" = ? where "id" = ?', [
      opts.authorizedBy ?? null,
      id,
    ]);
    return id;
  }

  async function auditEntry(input: {
    caseId: string;
    actor: string | null;
    statusCode: string;
    actedAt: string;
    action?: string;
  }): Promise<void> {
    await h.em().execute(
      'insert into "audit_log_entries" ("id", "actor_admin_user_id", "acted_at", "action", "object_type", "object_id", "state_before", "state_after") ' +
        'values (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)',
      [
        randomUUID(),
        input.actor,
        input.actedAt,
        input.action ?? 'return.status_changed',
        'return_case',
        input.caseId,
        JSON.stringify({ statusCode: 'new' }),
        JSON.stringify({ statusCode: input.statusCode, hasReason: false }),
      ],
    );
  }

  async function authorizerOf(caseId: string): Promise<string | null> {
    const rows = await h
      .em()
      .execute<Array<{ authorized_by_admin_user_id: string | null }>>(
        'select "authorized_by_admin_user_id" from "return_cases" where "id" = ?',
        [caseId],
      );
    return rows[0]?.authorized_by_admin_user_id ?? null;
  }

  async function columnExists(table: string, column: string): Promise<boolean> {
    const rows = await h
      .em()
      .execute<Array<{ n: string }>>(
        'select count(*)::text as n from information_schema.columns where table_name = ? and column_name = ?',
        [table, column],
      );
    return rows[0]?.n === '1';
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('adds the authorizer column and the status flag, false by default', async () => {
    expect(await columnExists('return_cases', 'authorized_by_admin_user_id')).toBe(true);
    expect(await columnExists('return_statuses', 'notify_customer_on_entry')).toBe(true);
    const flags = await h
      .em()
      .execute<Array<{ notify_customer_on_entry: boolean }>>('select "notify_customer_on_entry" from "return_statuses"');
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.every((f) => f.notify_customer_on_entry === false)).toBe(true);
  });

  it('fills the authorizer from the newest authorizing audit entry with an actor', async () => {
    const older = randomUUID();
    const newer = randomUUID();
    const caseId = await seedCase({ authorizedAt: new Date('2026-10-02T10:00:00Z') });
    await auditEntry({ caseId, actor: older, statusCode: 'authorized', actedAt: '2026-10-02T10:00:00Z' });
    await auditEntry({ caseId, actor: newer, statusCode: 'authorized', actedAt: '2026-10-03T10:00:00Z' });
    // Not an authorization, and an authorization with no admin actor: neither counts.
    await auditEntry({ caseId, actor: randomUUID(), statusCode: 'received', actedAt: '2026-10-04T10:00:00Z' });
    await auditEntry({ caseId, actor: null, statusCode: 'authorized', actedAt: '2026-10-05T10:00:00Z' });

    await run('up');

    expect(await authorizerOf(caseId)).toBe(newer);
  });

  it('leaves a case with no authorizing entry null, and an unauthorized case untouched', async () => {
    const unknown = await seedCase({ authorizedAt: new Date('2026-10-02T10:00:00Z') });
    await auditEntry({ caseId: unknown, actor: null, statusCode: 'authorized', actedAt: '2026-10-02T10:00:00Z' });
    const notAuthorized = await seedCase({ authorizedAt: null });
    await auditEntry({ caseId: notAuthorized, actor: randomUUID(), statusCode: 'authorized', actedAt: '2026-10-02T10:00:00Z' });

    await run('up');

    expect(await authorizerOf(unknown)).toBeNull();
    expect(await authorizerOf(notAuthorized)).toBeNull();
  });

  it('leaves an already-filled value untouched, and a second run changes nothing', async () => {
    const recorded = randomUUID();
    const caseId = await seedCase({ authorizedAt: new Date('2026-10-02T10:00:00Z'), authorizedBy: recorded });
    await auditEntry({ caseId, actor: randomUUID(), statusCode: 'authorized', actedAt: '2026-10-03T10:00:00Z' });
    const filled = await seedCase({ authorizedAt: new Date('2026-10-02T10:00:00Z') });
    const actor = randomUUID();
    await auditEntry({ caseId: filled, actor, statusCode: 'authorized', actedAt: '2026-10-03T10:00:00Z' });

    await run('up');
    await run('up');

    expect(await authorizerOf(caseId)).toBe(recorded);
    expect(await authorizerOf(filled)).toBe(actor);
  });

  it('drops both columns on down, and up restores them', async () => {
    await run('down');
    expect(await columnExists('return_cases', 'authorized_by_admin_user_id')).toBe(false);
    expect(await columnExists('return_statuses', 'notify_customer_on_entry')).toBe(false);

    await run('up');
    expect(await columnExists('return_cases', 'authorized_by_admin_user_id')).toBe(true);
    expect(await columnExists('return_statuses', 'notify_customer_on_entry')).toBe(true);
  });
});
