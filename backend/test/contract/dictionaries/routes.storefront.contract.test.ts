import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  dictionaryByCodeResponseSchema,
  dictionaryRegistryResponseSchema,
} from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary storefront routes (feature 017 / US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the active registry using the documented Zod envelope', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary?locale=en-US',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=60');
    const body = dictionaryRegistryResponseSchema.parse(res.json());
    expect(body.data.countries.some((c) => c.code === 'PL')).toBe(true);
    expect(body.data.countries.some((c) => c.code === 'RU')).toBe(false);
    expect(body.data.currencies.length).toBeGreaterThan(0);
    expect(body.data.languages.length).toBeGreaterThan(0);
    expect(body.data.defaults.country).toBe('PL');
    expect(body.data.defaults.currency).toBeTruthy();
    expect(body.data.defaults.language).toBeTruthy();
  });

  it('resolves inactive entries by code and returns 404 for unknown codes', async () => {
    const inactive = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/by-code?type=country&code=RU&locale=en-US',
    });
    expect(inactive.statusCode).toBe(200);
    const body = dictionaryByCodeResponseSchema.parse(inactive.json());
    expect(body.data.entryType).toBe('country');
    if (body.data.entryType === 'country') {
      expect(body.data.entry.code).toBe('RU');
      expect(body.data.entry.isActive).toBe(false);
    }

    const missing = await h.app.inject({
      method: 'GET',
      url: '/api/v1/dictionary/by-code?type=country&code=ZZ&locale=en-US',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('DICTIONARY_ENTRY_NOT_FOUND');
  });
});

