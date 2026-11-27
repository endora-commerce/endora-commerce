import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Organization } from '../../helpers/package-entities.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { commandMiddlewareFixtureObserved } from '../../../src/apps/example/modules/command_middleware_fixture/backend.js';

/**
 * `specs/189-command-middleware/` T030 (FR-012, FR-020, FR-033; spec US1, US3)
 * — the `example` deployment's `command_middleware_fixture`, over HTTP, on the
 * composed platform.
 *
 * Its `admit` refuses every `organization.` Command of a request whose
 * `x-request-id` carries the hold marker; its `observe` records the runs of a
 * marked request. Asserted on what the database holds and what the observer
 * recorded:
 *
 *  1. a refused write answers the fixture's own translated code, and writes
 *     nothing — no Organization, no audit entry;
 *  2. switched off through the effective state, both middlewares are skipped
 *     on the next request, and switched on they run again — no restart.
 */

const FIXTURE = 'command_middleware_fixture';
const REFUSED = 'COMMAND_MIDDLEWARE_FIXTURE_REFUSED';

describe('command middleware on the composed platform, on and off (189 T030)', () => {
  let h: BackendServerHandle;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL189M${stamp}${(seq++).toString().padStart(2, '0')}`;

  const createBody = (name: string): Record<string, unknown> => ({
    name,
    taxId: taxId(),
    registeredAddress: { street: 'ul. Bramkowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
    salesChannelIds: [channel],
  });

  const create = (payload: Record<string, unknown>, requestId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'x-request-id': requestId },
      payload,
    });

  const organizationWithTaxId = (value: string) => h.em().fork().findOne(Organization, { taxId: value });
  const entriesWithRequestId = (requestId: string) => h.em().fork().find(AuditLogEntry, { requestId });

  async function withFixture<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
    const before = registryCache.enabledIds();
    registryCache.__setEnabledForTesting(
      enabled ? [...new Set([...before, FIXTURE])] : before.filter((id) => id !== FIXTURE),
    );
    try {
      return await run();
    } finally {
      registryCache.__setEnabledForTesting([...before]);
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
    const em = h.em();
    const sales = em.create(SalesChannel, {
      code: `cmdmw-${stamp}`,
      name: { en: 'command middleware' },
      defaultLanguage: 'en',
      languages: ['en'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
    });
    await em.persist(sales).flush();
    channel = sales.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a held write with the fixture’s own code, and writes nothing', async () => {
    const payload = createBody(`Held ${stamp}`);
    const requestId = `cmdmw-hold-${stamp}-1`;
    const res = await withFixture(true, () => create(payload, requestId));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: REFUSED, message: 'The command middleware fixture refused this change to an organization.' },
    });
    expect(await organizationWithTaxId(payload['taxId'] as string)).toBeNull();
    expect(await entriesWithRequestId(requestId)).toEqual([]);
  });

  it('switched off, admits the same write; switched on again, refuses it — no restart', async () => {
    const off = createBody(`Held off ${stamp}`);
    const offRes = await withFixture(false, () => create(off, `cmdmw-hold-${stamp}-2`));
    expect(offRes.statusCode).toBe(201);
    expect(await organizationWithTaxId(off['taxId'] as string)).not.toBeNull();

    const on = createBody(`Held on ${stamp}`);
    const onRes = await withFixture(true, () => create(on, `cmdmw-hold-${stamp}-3`));
    expect(onRes.statusCode).toBe(403);
    expect(await organizationWithTaxId(on['taxId'] as string)).toBeNull();
  });

  it('observes a marked write after it committed, and skips it while switched off', async () => {
    const observedId = `cmdmw-obs-${stamp}-1`;
    const res = await withFixture(true, () => create(createBody(`Observed ${stamp}`), observedId));
    expect(res.statusCode).toBe(201);
    await vi.waitFor(
      () =>
        expect(commandMiddlewareFixtureObserved().map((record) => record.outcome.root.requestMeta.requestId)).toContain(
          observedId,
        ),
      { timeout: 5000 },
    );
    const record = commandMiddlewareFixtureObserved().find((entry) => entry.outcome.root.requestMeta.requestId === observedId)!;
    expect(record.outcome).toMatchObject({ committed: true, refusal: null, errorCode: null });
    expect(record.outcome.commands.map((entry) => entry.action)).toContain('organization.create');

    const skippedId = `cmdmw-obs-${stamp}-2`;
    const skipped = await withFixture(false, async () => {
      const response = await create(createBody(`Not observed ${stamp}`), skippedId);
      // The observer is detached: give it the macrotask it would have run on.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return response;
    });
    expect(skipped.statusCode).toBe(201);
    expect(commandMiddlewareFixtureObserved().map((entry) => entry.outcome.root.requestMeta.requestId)).not.toContain(
      skippedId,
    );
  });
});
