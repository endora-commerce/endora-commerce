import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US2 (T044; `contracts/scoped-values-api.md` §5, R8) — `GET|PUT
 * …/products/:id/editor-preference` (`catalog:read`): the editor's last scope per (admin,
 * product). `null` channel = Global, a channel = Channel, both = Channel × language (the language
 * stored in the channel's spelling). A language without a channel is `422 VALIDATION_FAILED`; a
 * non-member channel or an unoffered language `422 SCOPE_INVALID`. UI state: no audit entry.
 */
describe('172 US2 — the editor preference (T044)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let outsider: string;
  let product: string;

  const url = () => `/api/v1/admin/catalog/products/${product}/editor-preference`;
  const put = (payload: object) => h.app.inject({ method: 'PUT', url: url(), ...ADMIN, payload });
  const get = () => h.app.inject({ method: 'GET', url: url(), ...ADMIN });

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    outsider = await fx.channel(['pl-PL']);
    product = await fx.product({ channels: [channel] });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('answers null before the first visit, then each level as saved', async () => {
    expect((await get()).json()).toEqual({ data: null });
    for (const [body, expected] of [
      [{ lastChannelId: null, lastLanguageCode: null }, { lastChannelId: null, lastLanguageCode: null }],
      [{ lastChannelId: channel, lastLanguageCode: null }, { lastChannelId: channel, lastLanguageCode: null }],
      [{ lastChannelId: channel, lastLanguageCode: 'EN-us' }, { lastChannelId: channel, lastLanguageCode: 'en-US' }],
    ] as const) {
      const res = await put(body);
      expect(res.statusCode, res.body).toBe(200);
      expect((await get()).json()).toMatchObject({ data: { productId: product, ...expected } });
    }
  });

  it('refuses a language without a channel, a non-member channel and an unoffered language', async () => {
    const noChannel = await put({ lastChannelId: null, lastLanguageCode: 'pl-PL' });
    expect(noChannel.statusCode).toBe(422);
    expect(noChannel.json()).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } });
    const notMember = await put({ lastChannelId: outsider, lastLanguageCode: null });
    expect(notMember.statusCode).toBe(422);
    expect(notMember.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INVALID } });
    const notOffered = await put({ lastChannelId: channel, lastLanguageCode: 'de-DE' });
    expect(notOffered.statusCode).toBe(422);
    expect(notOffered.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INVALID } });
  });

  it('is UI state: no audit entry', async () => {
    await put({ lastChannelId: channel, lastLanguageCode: 'pl-PL' });
    expect(await fx.sql(`select 1 from audit_log_entries where object_id = ? and action like 'product.editor%'`, [product])).toEqual([]);
  });

  it('404 for an unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products/00000000-0000-4000-8000-00000000dead/editor-preference',
      ...ADMIN,
    });
    expect(res.statusCode).toBe(404);
  });
});
