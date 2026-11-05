import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registryLookupResponseSchema } from '@endora-commerce/contracts';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { fakeNip } from '../../helpers/fake-registry-clients.js';
import {
  GUS_TEST_KEY,
  REGISTRY_LOOKUP_SETTINGS,
  clearGusCredential,
  configureGusCredential,
  enableRegistryLookup,
  exhaustRegistryBudget,
  flushRegistryLookupRedis,
  lookup,
  registryFakes,
  resetRegistryLookup,
  setRegistrySetting,
} from '../../helpers/registry-lookup.js';

/**
 * Feature 173 (T028, T040; FR-001 – FR-011, FR-015, SC-003) —
 * `POST /api/v1/organizations/registry-lookup` (`contracts/public-api.md` §2)
 * over the harness's counting registry fakes.
 */

type LookupBody = ReturnType<typeof registryLookupResponseSchema.parse>;

describe('registry lookup (feature 173)', () => {
  let h: BackendServerHandle;
  let seed = 10_000_000;
  /** A fresh checksum-valid NIP with the fakes' marker digit. */
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
    await flushRegistryLookupRedis(h);
    registryFakes(h).reset();
    await enableRegistryLookup(h, 'gus_mf');
    await configureGusCredential(h);
  });

  async function found(taxId: string, country = 'PL'): Promise<LookupBody['data']> {
    const res = await lookup(h, taxId, country);
    expect(res.statusCode, res.body).toBe(200);
    return registryLookupResponseSchema.parse(res.json()).data;
  }

  describe('US1 — the form is filled from the registry', () => {
    it('gus_mf: name and structured address from GUS, VAT status from the White List, source gus', async () => {
      const taxId = nip();
      const res = await lookup(h, `PL ${taxId.slice(0, 3)}-${taxId.slice(3)}`, 'PL');
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = res.json() as LookupBody;
      expect(Object.keys(body)).toEqual(['data']);
      expect(Object.keys(body.data).sort()).toEqual(
        ['company', 'country', 'fetchedAt', 'lookupId', 'normalizedTaxId', 'source', 'status'].sort(),
      );
      const data = registryLookupResponseSchema.parse(body).data;
      expect(data).toMatchObject({
        status: 'found',
        normalizedTaxId: taxId,
        country: 'PL',
        source: 'gus',
        company: {
          registeredAddress: { street: 'ul. Rejestrowa 12/3', postalCode: '00-950', city: 'Warszawa', country: 'PL' },
          regon: '123456785',
          vatStatus: 'active',
          activityStatus: 'active',
        },
      });
      expect(Object.keys(data.company!).sort()).toEqual(
        ['activityStatus', 'legalName', 'regon', 'registeredAddress', 'vatStatus'].sort(),
      );
      const fakes = registryFakes(h);
      expect(fakes.gusPl.calls).toEqual([{ taxId, country: 'PL', gusEnvironment: 'test' }]);
      expect(fakes.mfPl.calls).toHaveLength(1);
      expect(fakes.vies.calls).toHaveLength(0);
    });

    it('gus_mf without a GUS credential: White List data, source mf', async () => {
      await clearGusCredential(h);
      const data = await found(nip());
      expect(data).toMatchObject({ status: 'found', source: 'mf', company: { vatStatus: 'active' } });
      expect(data.company?.registeredAddress).toEqual({
        street: 'UL. BIAŁA 5',
        postalCode: '00-001',
        city: 'WARSZAWA',
        country: 'PL',
      });
      expect(registryFakes(h).gusPl.calls).toHaveLength(0);
    });

    it('gus_mf with GUS failing: the White List answers', async () => {
      registryFakes(h).gusPl.force('unavailable');
      expect(await found(nip())).toMatchObject({ status: 'found', source: 'mf' });
    });

    it('gus: GUS only, VAT status unknown, the White List never called', async () => {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus');
      const data = await found(nip());
      expect(data).toMatchObject({ status: 'found', source: 'gus', company: { vatStatus: 'unknown' } });
      expect(registryFakes(h).mfPl.calls).toHaveLength(0);
    });

    it('mf with a GUS credential configured: White List data and VAT status, GUS never called', async () => {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'mf');
      const data = await found(nip());
      expect(data).toMatchObject({ status: 'found', source: 'mf', company: { vatStatus: 'active' } });
      expect(registryFakes(h).gusPl.calls).toHaveLength(0);
    });

    it.each(['gus_mf', 'gus', 'mf'] as const)('%s: an EU number goes to VIES', async (mode) => {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, mode);
      const data = await found('DE123456719', 'PL');
      expect(data).toMatchObject({ status: 'found', source: 'vies', country: 'DE', normalizedTaxId: '123456719' });
      const fakes = registryFakes(h);
      expect([fakes.gusPl.calls.length, fakes.mfPl.calls.length, fakes.vies.calls.length]).toEqual([0, 0, 1]);
    });

    it('a repeated lookup is answered from cache: one call per registry', async () => {
      const taxId = nip();
      const first = await found(taxId);
      const second = await found(taxId);
      expect(second.lookupId).not.toBe(first.lookupId);
      const fakes = registryFakes(h);
      expect([fakes.gusPl.calls.length, fakes.mfPl.calls.length]).toEqual([1, 1]);
    });

    it('switching gus_mf → mf fetches again from the White List (FR-026b)', async () => {
      const taxId = nip();
      expect((await found(taxId)).source).toBe('gus');
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'mf');
      expect((await found(taxId)).source).toBe('mf');
      expect(registryFakes(h).mfPl.calls).toHaveLength(2);
    });

    it('answers the same shape for a tax ID an Organization already holds as for an unknown one', async () => {
      const taken = nip();
      const em = h.em();
      em.create(Organization, {
        name: 'Already Here',
        taxId: taken,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Jest 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
      });
      await em.flush();
      const strip = (d: LookupBody['data']) => ({
        ...d,
        lookupId: 'x',
        normalizedTaxId: 'x',
        fetchedAt: 'x',
        company: d.company ? { ...d.company, legalName: 'x' } : null,
      });
      expect(strip(await found(taken))).toEqual(strip(await found(nip())));
    });

    it('never carries the GUS key', async () => {
      const res = await lookup(h, nip(), 'PL');
      expect(res.body).not.toContain(GUS_TEST_KEY);
    });
  });

  describe('US2 — every negative outcome answers, none blocks', () => {
    it.each([
      ['PL1234567890', 'PL', 'invalid_tax_id'],
      ['123456789', 'US', 'unsupported_country'],
    ] as const)('%s / %s ⇒ %s, no lookup id, zero calls', async (taxId, country, status) => {
      const data = await found(taxId, country);
      expect(data).toMatchObject({ status, lookupId: null, normalizedTaxId: null, company: null, source: null });
      expect(registryFakes(h).totalCalls()).toBe(0);
    });

    it('a malformed body ⇒ 400 VALIDATION_FAILED (the platform\'s validation code)', async () => {
      const res = await h.app.inject({ method: 'POST', url: '/api/v1/organizations/registry-lookup', payload: { taxId: '' } });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });

    it('not found ⇒ not_found with a lookup id', async () => {
      const data = await found(nip('9'));
      expect(data).toMatchObject({ status: 'not_found', company: null });
      expect(data.lookupId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it.each([
      ['7', 'exempt'],
      ['6', 'not_registered'],
    ] as const)('White List marker %s ⇒ found with VAT status %s', async (marker, vatStatus) => {
      expect(await found(nip(marker))).toMatchObject({ status: 'found', company: { vatStatus } });
    });

    it('a GUS unit with an end date ⇒ activity ceased', async () => {
      expect(await found(nip('7'))).toMatchObject({ status: 'found', company: { activityStatus: 'ceased' } });
    });

    it('every leg delayed forever ⇒ unavailable within 8 s', async () => {
      const fakes = registryFakes(h);
      fakes.gusPl.force('hang');
      fakes.mfPl.force('hang');
      const started = Date.now();
      const data = await found(nip());
      expect(data.status).toBe('unavailable');
      expect(Date.now() - started).toBeLessThan(8000);
    }, 15_000);

    it('a spent budget ⇒ unavailable, zero calls', async () => {
      await exhaustRegistryBudget(h, 'gus_pl');
      await exhaustRegistryBudget(h, 'mf_pl');
      expect((await found(nip())).status).toBe('unavailable');
      expect(registryFakes(h).totalCalls()).toBe(0);
    });

    describe('gus mode (US2 scenario 4a): GUS not answering never falls back to the White List', () => {
      beforeEach(async () => {
        await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'gus');
      });

      it('GUS failing ⇒ unavailable', async () => {
        registryFakes(h).gusPl.force('unavailable');
        expect((await found(nip())).status).toBe('unavailable');
        expect(registryFakes(h).mfPl.calls).toHaveLength(0);
      });

      it('GUS delayed forever ⇒ unavailable', async () => {
        registryFakes(h).gusPl.force('hang');
        expect((await found(nip())).status).toBe('unavailable');
        expect(registryFakes(h).mfPl.calls).toHaveLength(0);
      }, 15_000);

      it('GUS over budget ⇒ unavailable', async () => {
        await exhaustRegistryBudget(h, 'gus_pl');
        expect((await found(nip())).status).toBe('unavailable');
        expect(registryFakes(h).totalCalls()).toBe(0);
      });

      it('no GUS credential ⇒ unavailable, zero calls', async () => {
        await clearGusCredential(h);
        expect((await found(nip())).status).toBe('unavailable');
        expect(registryFakes(h).totalCalls()).toBe(0);
      });
    });

    it('Redis failing ⇒ unavailable with no lookup id, zero calls (fail closed)', async () => {
      // Only this module's keys fail: the settings cache shares the client, and
      // the switch must still read as on for the lookup to run at all.
      const redis = h.redis as unknown as { get: (key: string) => Promise<unknown> };
      const original = redis.get;
      redis.get = async (key: string) => {
        if (key.startsWith('b2b:org-registry-lookup:')) throw new Error('ECONNREFUSED');
        return original.call(h.redis, key);
      };
      try {
        expect(await found(nip())).toMatchObject({ status: 'unavailable', lookupId: null });
      } finally {
        redis.get = original;
      }
      expect(registryFakes(h).totalCalls()).toBe(0);
    });

    it('mf mode: White List failing ⇒ unavailable, GUS never called', async () => {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, 'mf');
      registryFakes(h).mfPl.force('unavailable');
      expect((await found(nip())).status).toBe('unavailable');
      expect(registryFakes(h).gusPl.calls).toHaveLength(0);
    });
  });
});
