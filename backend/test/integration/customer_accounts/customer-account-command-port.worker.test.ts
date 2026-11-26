import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type AuthSessionPort, type CustomerAccountCommandPort } from '@endora-commerce/contracts';
import { AuditLogEntry, hashPassword } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAccount } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * `specs/186-aggregate-ports/` T049 (issue #1822) — an ERP-style worker runs
 * the CustomerAccount lifecycle through `customerAccountCommandPort` with no
 * administrator anywhere: every call runs under `withSystemScope`, so each
 * entry records the `system` actor (no administrator id) and the worker names
 * itself through `source` (D-293.6).
 *
 * The worker blocks an account on a credit hold — which ends the buyer's
 * sessions, as an operator's block does — unblocks it, updates its profile and
 * soft-deletes it, which ends its sessions again; it moves another account to
 * its Organization's *Administrator* role. Then the refusals that must write nothing: the last
 * administrator of a company Organization, a malformed `source`, an extension
 * key no hook module claims.
 */

const SOURCE = 'erp.customer-master';

describe('customerAccountCommandPort from a worker (186 T049)', () => {
  let h: BackendServerHandle;
  let port: CustomerAccountCommandPort;
  let sessions: AuthSessionPort;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: ERP customer-master sync', fn);

  async function member(kind: 'member' | 'administrator' = 'member'): Promise<CustomerAccount> {
    const em = h.em().fork();
    const org = await seedAdHocOrganization(em, `Worker accounts ${stamp} ${seq++}`);
    const account = em.create(CustomerAccount, {
      organizationId: org.id,
      organizationRoleId: await predefinedRoleIdOf(em, org.id, kind),
      email: `worker-account-${stamp}-${seq++}@example.test`,
      passwordHash: await hashPassword('a-very-strong-password-1822'),
      firstName: 'Ada',
      lastName: 'Worker',
    });
    await em.persist(account).flush();
    return account;
  }

  const entries = (objectType: string, objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType, objectId }, { orderBy: { actedAt: 'asc' } });
  const reread = (id: string) => h.em().fork().findOneOrFail(CustomerAccount, { id });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<CustomerAccountCommandPort>('customerAccountCommandPort');
    sessions = h.container.resolve<AuthSessionPort>('authSessionPort');
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('blocks with no administrator: the sessions end, the entry has the system actor and the source', async () => {
    const account = await member();
    const first = await sessions.createSession({ kind: 'customer', customerAccountId: account.id });
    expect(await sessions.loadSession(first.cookieValue)).not.toBeNull();

    const blocked = await asWorker(() => port.block(account.id, { reason: 'Credit hold in the ERP' }, { source: SOURCE }));

    expect(blocked.blockedAt).toBeInstanceOf(Date);
    expect(await sessions.loadSession(first.cookieValue)).toBeNull();
    const row = await reread(account.id);
    expect(row).toMatchObject({ blockSource: 'staff', blockReason: 'Credit hold in the ERP' });
    expect(row.blockedByAdminUserId ?? null).toBeNull();

    await asWorker(() => port.unblock(account.id, { source: SOURCE }));
    await asWorker(() => port.updateProfile(account.id, { lastName: 'Synced' }, { source: SOURCE }));
    const second = await sessions.createSession({ kind: 'customer', customerAccountId: account.id });
    await asWorker(() => port.softDelete(account.id, { source: SOURCE }));
    expect(await sessions.loadSession(second.cookieValue)).toBeNull();
    expect((await reread(account.id)).deletionRequestedByAdminUserId ?? null).toBeNull();

    const written = await entries('customer_account', account.id);
    expect(written.map((e) => e.action)).toEqual([
      'customer_account.blocked',
      'customer_account.unblocked',
      'customer_account.update_profile',
      'customer_account.deleted',
    ]);
    for (const entry of written) {
      expect(entry.actorAdminUserId ?? null, entry.action).toBeNull();
      expect(entry.stateAfter, entry.action).toMatchObject({ source: SOURCE });
    }
  });

  it('changes a member’s role, recorded against the Organization with the system actor', async () => {
    const account = await member();
    const administrator = await predefinedRoleIdOf(h.em().fork(), account.organizationId, 'administrator');

    await asWorker(() => port.changeRole(account.id, { organizationRoleId: administrator }, { source: SOURCE }));

    expect((await reread(account.id)).organizationRoleId).toBe(administrator);
    const [entry] = await entries('organization', account.organizationId);
    expect(entry).toMatchObject({ action: 'customer_account.change_role', stateAfter: { source: SOURCE } });
    expect(entry!.actorAdminUserId ?? null).toBeNull();
  });

  it('refuses the last company administrator, a malformed source and an unclaimed extension, writing nothing', async () => {
    const admin = await member('administrator');
    const live = await sessions.createSession({ kind: 'customer', customerAccountId: admin.id });

    expect(await refusal(asWorker(() => port.block(admin.id, {}, { source: SOURCE })))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.ORG_OWNER_DEPLETION,
    });
    expect(await refusal(asWorker(() => port.block(admin.id, {}, { source: 'ERP Sync!' })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await refusal(asWorker(() => port.softDelete(admin.id, { extensions: { nobody_claims_this: {} } })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
    });

    const row = await reread(admin.id);
    expect(row.blockedAt ?? null).toBeNull();
    expect(row.deletedAt ?? null).toBeNull();
    expect(await sessions.loadSession(live.cookieValue)).not.toBeNull();
    expect(await entries('customer_account', admin.id)).toEqual([]);
  });
});
