import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { i18nConfigResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary legacy i18n config compatibility', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('keeps GET /api/v1/i18n/config compatible with the existing contract', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/i18n/config' });
    expect(res.statusCode).toBe(200);
    const body = i18nConfigResponseSchema.parse(res.json().data);
    expect(body.defaultLanguageCode).toBe('en-US');
    expect(body.defaultCurrencyCode).toBe('PLN');
    expect(body.languages.some((row) => row.code === 'en-US')).toBe(true);
    expect(body.currencies.some((row) => row.code === 'PLN')).toBe(true);
  });
});
