import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registryLookupResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { fakeNip } from '../../helpers/fake-registry-clients.js';
import {
  GUS_TEST_KEY,
  LOOKUP_URL,
  OPTIONS_URL,
  REGISTER_URL,
  REGISTRY_LOOKUP_SETTINGS,
  clearGusCredential,
  configureGusCredential,
  enableRegistryLookup,
  flushRegistryLookupRedis,
  lookup,
  registrationBody,
  registryFakes,
  resetRegistryLookup,
  setRegistrySetting,
} from '../../helpers/registry-lookup.js';

/**
 * Feature 173 (T045; FR-009, FR-025, FR-026, FR-026a, FR-026b; US3) — the
 * operator's controls: the switch (off behaves as absent, restoration works),
 * the GUS credential and `credentials`' operator axis, and the Polish sources,
 * each taking effect on the next request without a restart.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

describe('registry lookup — the operator controls it (feature 173, US3)', () => {
  let h: BackendServerHandle;
  let seed = 70_000_000;
  const nip = (marker = '1'): string => fakeNip((seed += 7), marker);

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await resetRegistryLookup(h);
    await flushRegistryLookupRedis(h);
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    registryFakes(h).reset();
    await enableRegistryLookup(h, 'gus_mf');
    await configureGusCredential(h);
  });

  /**
   * A mode outside the three, as only storage can hold it (a value written by
   * an older version, or by hand): the settings API refuses it on write.
   */
  async function storePlSourcesRaw(value: string): Promise<void> {
    await h.em().execute(`update "settings" set "global_value" = ?::jsonb where "code" = ?`, [
      JSON.stringify(value),
      REGISTRY_LOOKUP_SETTINGS.plSources,
    ]);
    await h.settings.cache.invalidate(REGISTRY_LOOKUP_SETTINGS.plSources);
  }

  async function data(taxId: string, country = 'PL') {
    const res = await lookup(h, taxId, country);
    expect(res.statusCode, res.body).toBe(200);
    return registryLookupResponseSchema.parse(res.json()).data;
  }

  describe('the switch (US3 scenarios 1, 2, 5)', () => {
    it('off: the lookup answers exactly as an unknown route; options say off; a ticket is ignored; on again restores both', async () => {
      const taxId = nip();
      const ticket = (await data(taxId)).lookupId!;
      registryFakes(h).reset();

      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, false);
      const off = await h.app.inject({ method: 'POST', url: LOOKUP_URL, payload: { taxId, country: 'PL' } });
      const unknown = await h.app.inject({
        method: 'POST',
        url: '/api/v1/organizations/no-such-route',
        payload: { taxId, country: 'PL' },
      });
      expect(off.statusCode).toBe(404);
      expect(off.statusCode).toBe(unknown.statusCode);
      expect(off.headers['content-type']).toBe(unknown.headers['content-type']);
      expect(off.headers['cache-control']).toBe(unknown.headers['cache-control']);
      const normalise = (body: string, path: string) =>
        body.replace(path, '<path>').replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
      expect(normalise(off.body, '/api/v1/organizations/registry-lookup')).toBe(
        normalise(unknown.body, '/api/v1/organizations/no-such-route'),
      );
      // Even a malformed body is the unknown route's answer, not a 400.
      expect((await h.app.inject({ method: 'POST', url: LOOKUP_URL, payload: { nope: 1 } })).statusCode).toBe(404);
      expect(registryFakes(h).totalCalls()).toBe(0);

      const options = await h.app.inject({ method: 'GET', url: OPTIONS_URL });
      expect(options.json()).toEqual({ data: { registryLookup: { enabled: false, countries: [] } } });

      const ignored = await h.app.inject({
        method: 'POST',
        url: REGISTER_URL,
        payload: registrationBody(taxId, { registryLookupId: ticket }),
      });
      expect(ignored.statusCode, ignored.body).toBe(201);
      const ignoredId = (ignored.json() as { data: { organization: { id: string } } }).data.organization.id;
      const rows = await h.em().execute(
        `select count(*)::int as n from "organization_tax_id_validations" where "organization_id" = ?`,
        [ignoredId],
      );
      expect((rows as Array<{ n: number }>)[0]!.n).toBe(0);

      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, true);
      const again = nip();
      const restored = await data(again);
      expect(restored.status).toBe('found');
      const registered = await h.app.inject({
        method: 'POST',
        url: REGISTER_URL,
        payload: registrationBody(again, { registryLookupId: restored.lookupId! }),
      });
      expect(registered.statusCode, registered.body).toBe(201);
      const restoredId = (registered.json() as { data: { organization: { id: string } } }).data.organization.id;
      const restoredRows = await h.em().execute(
        `select count(*)::int as n from "organization_tax_id_validations" where "organization_id" = ? and "origin" = 'registration'`,
        [restoredId],
      );
      expect((restoredRows as Array<{ n: number }>)[0]!.n).toBe(1);
    });
  });

  describe('the GUS credential and `credentials` (US3 scenarios 3, 4, 4a)', () => {
    it('credentials deactivated: GUS not called; the White List answers under gus_mf, nothing under gus; restored, GUS answers', async () => {
      await withModuleOff('credentials', 'deactivated', async () => {
        expect(await data(nip())).toMatchObject({ status: 'found', source: 'mf' });
        expect(registryFakes(h).gusPl.calls).toHaveLength(0);

        await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus');
        registryFakes(h).reset();
        expect((await data(nip())).status).toBe('unavailable');
        expect(registryFakes(h).totalCalls()).toBe(0);
        await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus_mf');
      });
      registryFakes(h).reset();
      expect(await data(nip())).toMatchObject({ status: 'found', source: 'gus' });
      expect(registryFakes(h).gusPl.calls).toHaveLength(1);
    });

    it('no GUS credential selected: the White List alone under gus_mf, unavailable under gus', async () => {
      await clearGusCredential(h);
      expect(await data(nip())).toMatchObject({ status: 'found', source: 'mf' });
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus');
      registryFakes(h).reset();
      expect((await data(nip())).status).toBe('unavailable');
      expect(registryFakes(h).totalCalls()).toBe(0);
    });

    it('the credential type: apiKey secret, environment an endpoint field; a stored key is masked', async () => {
      const types = await h.app.inject({ method: 'GET', url: '/api/v1/admin/credentials/types', cookies: ADMIN });
      expect(types.statusCode, types.body).toBe(200);
      const type = (types.json() as { types: Array<{ code: string; ownerModule: string; providers: Array<{ code: string; fields: Array<Record<string, unknown>> }> }> }).types.find(
        (candidate) => candidate.code === 'organizations_gus_bir',
      );
      expect(type).toMatchObject({ ownerModule: 'organizations' });
      const fields = type!.providers[0]!.fields;
      expect(fields.find((f) => f['key'] === 'apiKey')).toMatchObject({ secret: true, required: true });
      expect(fields.find((f) => f['key'] === 'environment')).toMatchObject({ secret: false, endpoint: true, kind: 'select' });

      const code = await configureGusCredential(h, 'test');
      const stored = await h.app.inject({ method: 'GET', url: `/api/v1/admin/credentials/${code}`, cookies: ADMIN });
      expect(stored.statusCode, stored.body).toBe(200);
      expect(stored.body).not.toContain(GUS_TEST_KEY);
    });
  });

  describe('the Polish sources (US3 scenarios 4a, 6)', () => {
    it('a change applies to the next lookup with no restart', async () => {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'mf');
      expect((await data(nip())).source).toBe('mf');
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus');
      expect((await data(nip())).source).toBe('gus');
      expect(registryFakes(h).mfPl.calls).toHaveLength(1);
    });

    it('a stored value outside the three is treated as gus_mf', async () => {
      await storePlSourcesRaw('everything');
      expect((await data(nip())).source).toBe('gus');
      const fakes = registryFakes(h);
      expect([fakes.gusPl.calls.length, fakes.mfPl.calls.length]).toEqual([1, 1]);
    });

    it.each(['gus_mf', 'gus', 'mf', 'everything'])('non-Polish lookups are unchanged under %s', async (mode) => {
      if (mode === 'everything') await storePlSourcesRaw(mode);
      else await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, mode);
      expect(await data('DE123456719')).toMatchObject({ status: 'found', source: 'vies' });
      const fakes = registryFakes(h);
      expect([fakes.gusPl.calls.length, fakes.mfPl.calls.length]).toEqual([0, 0]);
    });
  });
});
