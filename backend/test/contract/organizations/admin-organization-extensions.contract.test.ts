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
 * `specs/193-admin-form-extensions/` WP-E1, T043 (FR-013, SC-001; OD-178-6) —
 * the organizations admin create and update bodies carry `extensions`, and the
 * route hands it to the Command unchanged, so a hook module on the action
 * receives its own slice inside the one transaction, and a key no present hook
 * module claims is refused before anything is written.
 *
 * The hook module is the `example` deployment's `command_hook_fixture`, which
 * hooks `organization.create` (not `organization.admin_patch`) and acts on a
 * marked name. Its "row" is the audit entry of its own Command,
 * `command_hook_fixture.observe`, which commits with the Organization or not
 * at all; it notes a field, so the core entry names it under `extensions`.
 */

const FIXTURE = 'command_hook_fixture';
const SESSION = { b2b_session: 'stub-admin-session' };

describe('extensions on the organizations admin writes (193 T043)', () => {
  let h: BackendServerHandle;
  let channel: string;
  const stamp = Date.now().toString().slice(-8);
  let seq = 0;
  const taxId = (): string => `PL193E${stamp}${(seq++).toString().padStart(2, '0')}`;

  const createBody = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name,
    taxId: taxId(),
    registeredAddress: { street: 'ul. Formularzowa 1', city: 'Kraków', postalCode: '30-193', country: 'PL' },
    salesChannelIds: [channel],
    ...extra,
  });

  const create = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/admin/organizations', cookies: SESSION, payload });
  const patch = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/organizations/${id}`, cookies: SESSION, payload });

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
      code: `forms-${stamp}`,
      name: { en: 'forms' },
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

  describe('POST /api/v1/admin/organizations', () => {
    it('writes the Organization and the hook module’s row atomically, with one core entry naming the hook’s fields', async () => {
      const payload = createBody(`CMDHOOK Form ${stamp}`, { extensions: { [FIXTURE]: { note: 'kept' } } });
      const res = await withFixture(true, () => create(payload));
      expect(res.statusCode, res.body).toBe(201);
      const org = await organizationWithTaxId(payload['taxId'] as string);
      expect(org).not.toBeNull();

      const entries = await entriesFor(org!.id);
      const core = entries.filter((entry) => entry.action === 'organization.create');
      expect(core).toHaveLength(1);
      expect(core[0]!.stateAfter).toMatchObject({
        extensions: { [FIXTURE]: { changedFields: ['x_command_hook_fixture_observed'] } },
      });
      const own = entries.find((entry) => entry.action === 'command_hook_fixture.observe');
      expect(own?.requestId).toBeTruthy();
      expect(own?.requestId).toBe(core[0]!.requestId);
      // Names, never values: the slice's value is in no entry.
      expect(JSON.stringify(entries.map((entry) => entry.stateAfter))).not.toContain('kept');
    });

    it('refuses a key no present hook module claims with 422 COMMAND_EXTENSION_UNCLAIMED, writing nothing', async () => {
      const payload = createBody(`CMDHOOK Unclaimed ${stamp}`, { extensions: { nobody_here: { note: 'x' } } });
      const res = await withFixture(true, () => create(payload));
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'COMMAND_EXTENSION_UNCLAIMED' } });
      expect(await organizationWithTaxId(payload['taxId'] as string)).toBeNull();
    });

    it('refuses the hook module’s own key while it is switched off — it claims nothing then (XVII)', async () => {
      const payload = createBody(`CMDHOOK Off ${stamp}`, { extensions: { [FIXTURE]: { note: 'x' } } });
      const res = await withFixture(false, () => create(payload));
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'COMMAND_EXTENSION_UNCLAIMED' } });
      expect(await organizationWithTaxId(payload['taxId'] as string)).toBeNull();
    });

    it('answers an empty extensions object exactly as a body without it', async () => {
      const payload = createBody(`Plain ${stamp}`, { extensions: {} });
      const res = await withFixture(true, () => create(payload));
      expect(res.statusCode, res.body).toBe(201);
      const org = await organizationWithTaxId(payload['taxId'] as string);
      const core = (await entriesFor(org!.id)).find((entry) => entry.action === 'organization.create');
      expect(core?.stateAfter).not.toHaveProperty('extensions');
    });

    it('refuses a malformed extensions object at the boundary', async () => {
      const nine = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`acme_${index}`, {}]));
      for (const extensions of [nine, { 'Not-A-Module': {} }, ['acme_erp']]) {
        const payload = createBody(`Malformed ${stamp}`, { extensions });
        const res = await create(payload);
        expect(res.statusCode, JSON.stringify(extensions)).toBe(400);
        expect(await organizationWithTaxId(payload['taxId'] as string)).toBeNull();
      }
    });
  });

  describe('PATCH /api/v1/admin/organizations/:id', () => {
    let id: string;

    beforeAll(async () => {
      const payload = createBody(`Patched ${stamp}`);
      const res = await create(payload);
      expect(res.statusCode, res.body).toBe(201);
      id = (res.json() as { data: { id: string } }).data.id;
    });

    it('hands extensions to organization.admin_patch: a key nobody claims there is refused, and nothing changes', async () => {
      // `command_hook_fixture` hooks `organization.create` only, so even its own
      // key is unclaimed on the update.
      const res = await withFixture(true, () =>
        patch(id, { orderConfirmationEmails: ['ops@example.test'], extensions: { [FIXTURE]: { note: 'x' } } }),
      );
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: 'COMMAND_EXTENSION_UNCLAIMED' } });
      const org = await h.em().fork().findOne(Organization, { id });
      expect(org?.orderConfirmationEmails ?? []).toEqual([]);
      const patches = (await entriesFor(id)).filter((entry) => entry.action === 'organization.admin_patch');
      expect(patches).toHaveLength(0);
    });

    it('writes as before with an empty extensions object', async () => {
      const res = await patch(id, { orderConfirmationEmails: ['ops@example.test'], extensions: {} });
      expect(res.statusCode, res.body).toBe(200);
      const org = await h.em().fork().findOne(Organization, { id });
      expect(org?.orderConfirmationEmails).toEqual(['ops@example.test']);
      const patches = (await entriesFor(id)).filter((entry) => entry.action === 'organization.admin_patch');
      expect(patches).toHaveLength(1);
      expect(patches[0]!.stateAfter).toMatchObject({ changedFields: ['orderConfirmationEmails'] });
      expect(patches[0]!.stateAfter).not.toHaveProperty('extensions');
    });
  });
});
