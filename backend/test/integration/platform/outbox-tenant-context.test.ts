import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresOutboxStore, runCommandOutboxDrainTick } from '@endora-commerce/platform/composition';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Organization } from '../../helpers/package-entities.js';

/**
 * `specs/176-command-hooks-outbox/` T044 (FR-030, FR-034; spec US3 scenarios
 * 1 and 3) — an `afterCommit` handler on `organizations`' hookable actions, end
 * to end on the composed platform.
 *
 * The handler is the `example` deployment's `command_hook_fixture`
 * (`deliver-register`, `deliver-create`). A real registration over HTTP writes
 * its outbox row in the registration's own transaction; the drain then delivers
 * it, and the handler records what it saw by running a Command of its own,
 * `command_hook_fixture.deliver`, whose audit entry is what this file reads:
 *
 *  - it ran under a context pinned to the row's Organization (`single-org`,
 *    that Organization), never the wider context the write ran in;
 *  - its own Command's entry carries the **original** request id;
 *  - the causation it was handed is the actor recorded at commit — the system
 *    for an anonymous registration, the operator for an admin create.
 */

const FIXTURE = 'command_hook_fixture';
const log = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('afterCommit delivery restores the row’s tenant context (176 T044)', () => {
  let h: BackendServerHandle;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL176O${stamp}${(seq++).toString().padStart(2, '0')}`;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
    const em = h.em();
    const sales = em.create(SalesChannel, {
      code: `outbox-${stamp}`,
      name: { en: 'outbox' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persistAndFlush(sales);
    channel = sales.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const entriesFor = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectId }, { orderBy: { actedAt: 'asc' } });

  async function outboxRowsFor(organizationId: string): Promise<Array<Record<string, unknown>>> {
    return h.orm.em
      .fork()
      .execute(
        `select "action", "hook_module", "hook_id", "status", "attempts", "data", "request_id", "actor_kind", "actor_admin_user_id"
           from "command_outbox" where "organization_id" = ? order by "sequence"`,
        [organizationId],
      );
  }

  const drain = () =>
    runCommandOutboxDrainTick({
      store: new PostgresOutboxStore(() => h.orm.em.fork()),
      handlers: h.commandHookRegistry,
      log,
    });

  it('delivers a registration’s row pinned to the new Organization, with the original request id and the recorded actor', async () => {
    seq += 1;
    const payload = {
      organization: {
        name: `Outbox delivery ${stamp}`,
        taxId: taxId(),
        registeredAddress: { street: 'ul. Skrzynkowa 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
      },
      firstUser: {
        email: `outbox-${stamp}-${seq}@example.test`,
        password: 'a-very-strong-password-123!',
        firstName: 'Ola',
        lastName: 'Outbox',
      },
      acceptedTermsVersion: '1.0.0',
    };
    const requestId = `req-outbox-${stamp}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      headers: { 'x-request-id': requestId },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const org = await h.em().fork().findOneOrFail(Organization, { taxId: payload.organization.taxId });

    // Scenario 1: one row for the handler, written in the registration's
    // transaction, carrying ids and codes only.
    const rows = await outboxRowsFor(org.id);
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'organization.register',
        hook_module: FIXTURE,
        hook_id: 'deliver-register',
        status: 'pending',
        attempts: 0,
        request_id: requestId,
        actor_kind: 'system',
      }),
    ]);
    expect(rows[0]!['data']).toEqual({
      organizationId: org.id,
      customerAccountId: expect.any(String),
      status: org.status,
    });
    expect(JSON.stringify(rows[0])).not.toContain(payload.organization.name);
    expect(JSON.stringify(rows[0])).not.toContain(payload.firstUser.email);

    // Scenario 3: delivered under a context pinned to the row's Organization.
    await drain();
    expect((await outboxRowsFor(org.id))[0]).toMatchObject({ status: 'delivered', attempts: 1 });

    const entries = await entriesFor(org.id);
    const core = entries.find((entry) => entry.action === 'organization.register');
    const delivered = entries.find((entry) => entry.action === 'command_hook_fixture.deliver');
    expect(core?.requestId).toBe(requestId);
    expect(delivered).toBeDefined();
    expect(delivered!.stateAfter).toEqual({
      hookId: 'deliver-register',
      attempt: 1,
      tenantMode: 'single-org',
      pinnedToRowOrganization: true,
      causationActorKind: 'system',
      causationAdminUserId: null,
      causationHasRequestId: true,
    });
    // The handler's own Command records the request that caused it, not a new one.
    expect(delivered!.requestId).toBe(requestId);
    // …and is recorded as the system acting, not as whoever registered.
    expect(delivered!.actorAdminUserId ?? null).toBeNull();
    expect(delivered!.actorCustomerAccountId ?? null).toBeNull();
  }, 60_000);

  it('hands an admin create’s handler the operator as recorded causation, while it runs as the system', async () => {
    const payload = {
      name: `Outbox admin ${stamp}`,
      taxId: taxId(),
      registeredAddress: { street: 'ul. Skrzynkowa 2', city: 'Gdańsk', postalCode: '80-002', country: 'PL' },
      salesChannelIds: [channel],
    };
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: 'stub-admin-session' },
      payload,
    });
    expect(res.statusCode).toBe(201);
    const org = await h.em().fork().findOneOrFail(Organization, { taxId: payload.taxId });
    const [row] = await outboxRowsFor(org.id);
    expect(row).toMatchObject({ action: 'organization.create', hook_id: 'deliver-create', actor_kind: 'admin' });
    const adminId = row!['actor_admin_user_id'];
    expect(adminId).toEqual(expect.any(String));

    await drain();
    const delivered = (await entriesFor(org.id)).find((entry) => entry.action === 'command_hook_fixture.deliver');
    expect(delivered?.stateAfter).toMatchObject({
      hookId: 'deliver-create',
      tenantMode: 'single-org',
      pinnedToRowOrganization: true,
      causationActorKind: 'admin',
      causationAdminUserId: adminId,
    });
    expect(delivered!.actorAdminUserId ?? null).toBeNull();
  }, 60_000);
});
