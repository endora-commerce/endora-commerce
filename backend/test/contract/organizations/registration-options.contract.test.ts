import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { REGISTRY_LOOKUP_COUNTRIES, registrationOptionsResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  OPTIONS_URL,
  REGISTRY_LOOKUP_SETTINGS,
  enableRegistryLookup,
  resetRegistryLookup,
  setRegistrySetting,
} from '../../helpers/registry-lookup.js';

/**
 * Feature 173 (T027; FR-018, FR-025) — `GET /api/v1/organizations/registration-options`
 * (`contracts/public-api.md` §1): public, channel-independent, always 200, and
 * blind to the Polish-sources mode.
 */

const CLOSED = 'ro-closed';
const PICKER_COUNTRIES = REGISTRY_LOOKUP_COUNTRIES.map((c) => (c === 'EL' ? 'GR' : c));

describe('registration options (feature 173)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    em.create(SalesChannel, {
      code: CLOSED,
      name: { 'en-US': CLOSED },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      anonymousAccess: false,
    });
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await resetRegistryLookup(h);
    await teardownBackendServer(h);
  });

  async function options(headers: Record<string, string> = {}) {
    const res = await h.app.inject({ method: 'GET', url: OPTIONS_URL, headers });
    expect(res.statusCode, res.body).toBe(200);
    return registrationOptionsResponseSchema.parse(res.json()).data.registryLookup;
  }

  it('is off by default (OD-6) and lists no country', async () => {
    await resetRegistryLookup(h);
    expect(await options()).toEqual({ enabled: false, countries: [] });
  });

  it('lists the supported countries in picker form when on', async () => {
    await enableRegistryLookup(h);
    const answer = await options();
    expect(answer.enabled).toBe(true);
    expect(answer.countries).toEqual(PICKER_COUNTRIES);
    expect(answer.countries).toContain('GR');
    expect(answer.countries).not.toContain('EL');
  });

  it('answers on a store closed to anonymous visitors', async () => {
    await enableRegistryLookup(h);
    expect((await options({ 'x-sales-channel': CLOSED })).enabled).toBe(true);
  });

  it('is identical under every Polish-sources mode — PL always listed, no mode field', async () => {
    await enableRegistryLookup(h);
    const answers = [];
    for (const mode of ['gus_mf', 'gus', 'mf'] as const) {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.plSources, mode);
      const res = await h.app.inject({ method: 'GET', url: OPTIONS_URL });
      answers.push(res.json());
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect((answers[0] as { data: { registryLookup: { countries: string[] } } }).data.registryLookup.countries).toContain(
      'PL',
    );
    expect(JSON.stringify(answers[0])).not.toMatch(/gus|plSources|sources/i);
  });

  it('follows the switch without a restart', async () => {
    await enableRegistryLookup(h);
    expect((await options()).enabled).toBe(true);
    await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, false);
    expect(await options()).toEqual({ enabled: false, countries: [] });
  });
});
