import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../helpers/package-entities.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * `specs/176-command-hooks-outbox/` T029 (FR-015, FR-016, FR-017, SC-002,
 * SC-005) — a module that is not `organizations` takes part in an Organization
 * write through the hookable actions `organizations` declares, over HTTP, on
 * the composed platform.
 *
 * The hook module is the `example` deployment's `command_hook_fixture`: on an
 * Organization whose name starts with its marker it runs a Command of its own
 * (`command_hook_fixture.observe`) inside the write, notes a field in the core
 * entry, and refuses with its own translated code when the name also carries
 * `VETO`. Three properties, each asserted on what the database holds:
 *
 *  1. its write commits with the core row, in one transaction;
 *  2. its veto reaches the caller as its own code and language, and nothing is
 *     written — no Organization, no entry of either module;
 *  3. switched off, the platform behaves as if it were not installed (XVII).
 */

const FIXTURE = 'command_hook_fixture';
const REFUSED = 'COMMAND_HOOK_FIXTURE_REFUSED';

describe('command hooks on organizations’ hookable actions (176 T029)', () => {
  let h: BackendServerHandle;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL176H${stamp}${(seq++).toString().padStart(2, '0')}`;

  function createBody(name: string): Record<string, unknown> {
    return {
      name,
      taxId: taxId(),
      registeredAddress: { street: 'ul. Hakowa 1', city: 'Kraków', postalCode: '30-001', country: 'PL' },
      salesChannelIds: [channel],
    };
  }

  function registerBody(name: string): Record<string, unknown> {
    seq += 1;
    return {
      organization: {
        name,
        taxId: taxId(),
        registeredAddress: { street: 'ul. Hakowa 2', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
      },
      firstUser: {
        email: `hooks-${stamp}-${seq}@example.test`,
        password: 'a-very-strong-password-123!',
        firstName: 'Ada',
        lastName: 'Hook',
      },
      acceptedTermsVersion: '1.0.0',
    };
  }

  const create = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/organizations',
      cookies: { b2b_session: 'stub-admin-session' },
      headers,
      payload,
    });

  const register = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h.app.inject({ method: 'POST', url: '/api/v1/organizations/register', headers, payload });

  const organizationWithTaxId = (value: string) => h.em().fork().findOne(Organization, { taxId: value });
  const entriesFor = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectId }, { orderBy: { actedAt: 'asc' } });

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
      code: `hooks-${stamp}`,
      name: { en: 'hooks' },
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

  describe('organization.create', () => {
    it("commits the hook's own entry with the Organization, and names its write in the core entry", async () => {
      const payload = createBody(`CMDHOOK Kept ${stamp}`);
      const res = await withFixture(true, () => create(payload));
      expect(res.statusCode).toBe(201);
      const org = await organizationWithTaxId(payload['taxId'] as string);
      expect(org).not.toBeNull();

      const entries = await entriesFor(org!.id);
      const core = entries.find((entry) => entry.action === 'organization.create');
      const own = entries.find((entry) => entry.action === 'command_hook_fixture.observe');
      expect(own).toMatchObject({ objectType: 'organization', stateAfter: { hookId: 'observe-create' } });
      expect(core?.stateAfter).toMatchObject({
        extensions: { [FIXTURE]: { changedFields: ['x_command_hook_fixture_observed'] } },
      });
      // One transaction, one request: both entries carry the same request id.
      expect(own?.requestId).toBeTruthy();
      expect(own?.requestId).toBe(core?.requestId);
    });

    it("answers the hook's veto with its own translated code, and writes nothing", async () => {
      // An operator's language is the stored preference (D-132), English for the
      // stub administrator; the Polish sentence is asserted on the anonymous
      // registration below, whose language is the request's.
      const payload = createBody(`CMDHOOK VETO ${stamp}`);
      const res = await withFixture(true, () => create(payload));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: { code: REFUSED, message: 'The command hook fixture refused to create this organization.' },
      });
      expect(await organizationWithTaxId(payload['taxId'] as string)).toBeNull();
      const observed = (await h
        .em()
        .fork()
        .execute(
          `select count(*)::int as n from "audit_log_entries"
            where "action" = 'command_hook_fixture.observe' and "state_after"->>'hookId' = 'observe-create'`,
        )) as Array<{ n: number }>;
      // Only the entry of the kept Organization above, never one of a vetoed write.
      expect(observed[0]!.n).toBe(1);
    });

    it('switched off, behaves as if the hook module were not installed (XVII, SC-005)', async () => {
      const payload = createBody(`CMDHOOK VETO off ${stamp}`);
      const res = await withFixture(false, () => create(payload));
      expect(res.statusCode).toBe(201);
      const org = await organizationWithTaxId(payload['taxId'] as string);
      expect(org).not.toBeNull();
      const entries = await entriesFor(org!.id);
      expect(entries.map((entry) => entry.action)).not.toContain('command_hook_fixture.observe');
      const core = entries.find((entry) => entry.action === 'organization.create');
      expect(core?.stateAfter).not.toHaveProperty('extensions');
    });

    it('leaves an unmarked Organization untouched while switched on', async () => {
      const payload = createBody(`Plain ${stamp}`);
      const res = await withFixture(true, () => create(payload));
      expect(res.statusCode).toBe(201);
      const org = await organizationWithTaxId(payload['taxId'] as string);
      const entries = await entriesFor(org!.id);
      expect(entries.map((entry) => entry.action)).not.toContain('command_hook_fixture.observe');
      expect(entries.find((entry) => entry.action === 'organization.create')?.stateAfter).not.toHaveProperty(
        'extensions',
      );
    });
  });

  describe('organization.register', () => {
    it("commits the hook's entry with the registration", async () => {
      const payload = registerBody(`CMDHOOK Registered ${stamp}`);
      const res = await withFixture(true, () => register(payload));
      expect(res.statusCode).toBe(201);
      const org = await organizationWithTaxId((payload['organization'] as { taxId: string }).taxId);
      expect(org).not.toBeNull();
      const actions = (await entriesFor(org!.id)).map((entry) => entry.action);
      expect(actions).toEqual(expect.arrayContaining(['organization.register', 'command_hook_fixture.observe']));
    });

    it('rolls the whole registration back on a veto, answered in the request’s language: no Organization, no account', async () => {
      const payload = registerBody(`CMDHOOK VETO Registered ${stamp}`);
      const res = await withFixture(true, () => register(payload, { 'accept-language': 'pl' }));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: { code: REFUSED, message: 'Moduł testowy haków poleceń odmówił utworzenia tej organizacji.' },
      });
      expect(await organizationWithTaxId((payload['organization'] as { taxId: string }).taxId)).toBeNull();
      const email = (payload['firstUser'] as { email: string }).email;
      const accounts = (await h
        .em()
        .fork()
        .execute(`select count(*)::int as n from "customer_accounts" where "email" = ?`, [email])) as Array<{
        n: number;
      }>;
      expect(accounts[0]!.n).toBe(0);
    });

    it('switched off, registers as if the hook module were not installed', async () => {
      const payload = registerBody(`CMDHOOK VETO Registered off ${stamp}`);
      const res = await withFixture(false, () => register(payload));
      expect(res.statusCode).toBe(201);
      const org = await organizationWithTaxId((payload['organization'] as { taxId: string }).taxId);
      const actions = (await entriesFor(org!.id)).map((entry) => entry.action);
      expect(actions).toContain('organization.register');
      expect(actions).not.toContain('command_hook_fixture.observe');
    });
  });
});
