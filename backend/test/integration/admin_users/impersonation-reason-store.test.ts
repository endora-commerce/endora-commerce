import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, type CustomerAccountAnonymizedEventV1 } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #470 (D-288, `specs/conventions/audit-state.md` §2, §3) — the reason
 * an administrator gives for impersonating a customer account is free text
 * about a tenant's account, so it lives in `admin_impersonation_reasons`, not
 * in the platform audit log. The `impersonation.start` entry records its shape
 * and the store row's id, and the two are written in one transaction: a start
 * that fails at either write leaves neither row and mints no session. An
 * anonymised account's reasons are erased with it.
 *
 * Every row read or deleted here is this file's own: found by its reason text,
 * its user agent or its random customer id.
 */
describe('impersonation reasons are kept beside the audit log, not in it (#470)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const ownReasonIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (h && ownReasonIds.length > 0) {
      await withSystemScope('#470 test: clean up its reason rows', () =>
        h.em().getConnection().execute(`delete from "admin_impersonation_reasons" where "id" = any(?::uuid[])`, [
          `{${ownReasonIds.join(',')}}`,
        ]),
      );
    }
    await teardownBackendServer(h);
  });

  const impersonate = (payload: Record<string, unknown>, userAgent: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      payload: { customerAccountId: TEST_CUSTOMER_ID, ...payload },
      headers: { 'user-agent': userAgent },
      cookies: { b2b_session: 'stub-admin-session' },
    });

  const reasonRows = (where: string, params: unknown[]) =>
    withSystemScope('#470 test: read its reason rows', () =>
      h
        .em()
        .getConnection()
        .execute<Array<Record<string, unknown>>>(
          `select "id", "customer_account_id", "organization_id", "actor_admin_user_id", "reason" from "admin_impersonation_reasons" where ${where}`,
          params,
        ),
    );

  const startEntries = (userAgentPrefix: string) =>
    h
      .em()
      .fork()
      .find(AuditLogEntry, { action: 'impersonation.start', userAgent: { $like: `${userAgentPrefix}%` } });

  it('records the reason\'s shape and the store row\'s id; the row holds the reason', async () => {
    const reason = `S470-DESC s470@example.test ${RUN}`;
    const agent = `s470-agent-${RUN}-ok`;
    const res = await impersonate({ reason }, agent);
    expect(res.statusCode, res.body).toBe(200);

    const rows = await reasonRows(`"reason" = ?`, [reason]);
    expect(rows).toHaveLength(1);
    ownReasonIds.push(String(rows[0]!['id']));
    expect(rows[0]).toMatchObject({
      customer_account_id: TEST_CUSTOMER_ID,
      organization_id: TEST_ORGANIZATION_ID,
      actor_admin_user_id: TEST_ADMIN_ID,
      reason,
    });

    const entries = await startEntries(agent);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.stateAfter).toEqual({
      hasReason: true,
      reasonLength: reason.length,
      organizationScoped: true,
      valueChangeId: rows[0]!['id'],
    });
    const recorded = JSON.stringify([entries[0]!.stateBefore, entries[0]!.stateAfter]).toLowerCase();
    for (const sentinel of ['s470-desc', 's470@example.test', TEST_ORGANIZATION_ID]) expect(recorded).not.toContain(sentinel);
  });

  it('a start whose reason row cannot be written leaves no audit entry and no session', async () => {
    const agent = `s470-agent-${RUN}-store-fails`;
    // Postgres refuses a NUL byte in `text`, so the reason row's insert fails.
    const res = await impersonate({ reason: `S470-DESC ${RUN} \u0000` }, agent);
    expect(res.statusCode).toBe(500);
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain('admin_shadow_session=');
    expect(await startEntries(agent)).toEqual([]);
    expect(await reasonRows(`"reason" like ?`, [`S470-DESC ${RUN} %`])).toEqual([]);
  });

  it('a start whose audit entry cannot be written leaves no reason row and no session', async () => {
    const reason = `S470-DESC ${RUN} audit-fails`;
    // `audit_log_entries.user_agent` is `varchar(255)`, so the entry's insert fails.
    const res = await impersonate({ reason }, `s470-agent-${RUN}-`.padEnd(300, 'x'));
    expect(res.statusCode).toBe(500);
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain('admin_shadow_session=');
    expect(await reasonRows(`"reason" = ?`, [reason])).toEqual([]);
  });

  it('erases an account\'s reasons when the account is anonymised', async () => {
    const customerAccountId = randomUUID();
    const organizationId = randomUUID();
    const kept = randomUUID();
    await withSystemScope('#470 test: seed reason rows', () =>
      h
        .em()
        .getConnection()
        .execute(
          `insert into "admin_impersonation_reasons" ("id", "customer_account_id", "organization_id", "actor_admin_user_id", "reason")
           values (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
          [
            randomUUID(), customerAccountId, organizationId, TEST_ADMIN_ID, `S470-DESC ${RUN} 1`,
            randomUUID(), customerAccountId, organizationId, TEST_ADMIN_ID, `S470-DESC ${RUN} 2`,
            kept, randomUUID(), organizationId, TEST_ADMIN_ID, `S470-DESC ${RUN} other`,
          ],
        ),
    );
    ownReasonIds.push(kept);

    await h.eventBus.run(async () => {
      const payload: CustomerAccountAnonymizedEventV1 = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        customerAccountId,
        organizationId,
      };
      h.eventBus.emit(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT as never, payload as never);
    });

    expect(await reasonRows(`"customer_account_id" = ?`, [customerAccountId])).toEqual([]);
    expect(await reasonRows(`"id" = ?`, [kept])).toHaveLength(1);
    const erased = await h
      .em()
      .fork()
      .find(AuditLogEntry, { action: 'impersonation.reasons_erase', objectId: customerAccountId });
    expect(erased.map((entry) => entry.stateAfter)).toEqual([{ deleted: 2 }]);
  });
});
