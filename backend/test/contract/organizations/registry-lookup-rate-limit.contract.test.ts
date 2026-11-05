import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { fakeNip } from '../../helpers/fake-registry-clients.js';
import {
  LOOKUP_URL,
  clearGusCredential,
  enableRegistryLookup,
  flushRegistryLookupRedis,
  resetRegistryLookup,
  setRegistrySetting,
  REGISTRY_LOOKUP_SETTINGS,
} from '../../helpers/registry-lookup.js';

/**
 * Feature 173 (T041; FR-008) — the lookup's per-client ceiling, 10 lookups per
 * 10 minutes per address (research R-7 layer 2), on a harness with the
 * limiter on: the 11th is `429 RATE_LIMITED`, another address is unaffected,
 * and while the switch is off the limiter stands aside so the endpoint keeps
 * answering exactly as an absent one.
 */
describe('registry lookup — per-client rate limit (feature 173)', () => {
  let h: BackendServerHandle;
  let seed = 50_000_000;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ??= randomBytes(32).toString('base64');
    h = await setupBackendServer({ enableRateLimit: true });
    await flushRegistryLookupRedis(h);
    await enableRegistryLookup(h, 'mf');
    await clearGusCredential(h);
  }, 120_000);

  afterAll(async () => {
    await resetRegistryLookup(h);
    await flushRegistryLookupRedis(h);
    await teardownBackendServer(h);
  });

  function post(remoteAddress: string) {
    return h.app.inject({
      method: 'POST',
      url: LOOKUP_URL,
      remoteAddress,
      payload: { taxId: fakeNip((seed += 7), '1'), country: 'PL' },
    });
  }

  it('the 11th lookup from one address within the window is 429; another address is unaffected', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post('198.51.100.10')).statusCode);
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    const refused = await post('198.51.100.10');
    expect((refused.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    expect((await post('198.51.100.11')).statusCode).toBe(200);
  });

  it('while the switch is off the limiter does not count, so no 429 betrays the route', async () => {
    await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, false);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) statuses.push((await post('198.51.100.20')).statusCode);
      expect(new Set(statuses)).toEqual(new Set([404]));
    } finally {
      await setRegistrySetting(h, REGISTRY_LOOKUP_SETTINGS.enabled, true);
    }
  });
});
