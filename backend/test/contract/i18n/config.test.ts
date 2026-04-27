import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T238 — public /i18n/config returns the active languages + currencies + the
 * defaults the storefront should pick. The bootstrap migration installs
 * en-US (default) + pl-PL + PLN (default) + EUR.
 */

describe('GET /api/v1/i18n/config', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns active languages + currencies + defaults', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/i18n/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        languages: Array<{ code: string; isActive: boolean; isDefault: boolean }>;
        currencies: Array<{ code: string; isActive: boolean; isDefault: boolean; symbol: string }>;
        defaultLanguageCode: string | null;
        defaultCurrencyCode: string | null;
      };
    };
    expect(body.data.defaultLanguageCode).toBe('en-US');
    expect(body.data.defaultCurrencyCode).toBe('PLN');
    expect(body.data.languages.find((l) => l.code === 'en-US')?.isDefault).toBe(true);
    expect(body.data.languages.find((l) => l.code === 'pl-PL')?.isActive).toBe(true);
    const pln = body.data.currencies.find((c) => c.code === 'PLN');
    expect(pln?.isDefault).toBe(true);
    // Bootstrap migration uses Postgres Unicode literal so the symbol round-trips.
    expect(pln?.symbol.length).toBeGreaterThan(0);
  });
});
