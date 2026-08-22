import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — `PATCH /admin/catalog/products/:id/value-overrides`.
 *
 * Covers the happy-path bulk write + the six 422 validation codes from
 * data-model.md §3.3 + §4. System attribute `name` is used for the
 * happy-path checks (it's pinned channel+language-scoped by
 * SYSTEM_ATTRIBUTE_SCOPES, so no DB toggling is required).
 */
describe('PATCH /api/v1/admin/catalog/products/:id/value-overrides', () => {
  let h: BackendServerHandle;
  let productId: string;
  let retailChannelId: string;
  let vipChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const product = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `OVR-${Date.now()}`,
        type: 'simple',
        name: { 'en-US': 'Override probe', 'pl-PL': 'Probe nadpisań' },
        description: { 'en-US': 'Override probe', 'pl-PL': 'Probe' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(product.statusCode).toBe(201);
    productId = (product.json() as { data: { id: string } }).data.id;

    // The seed creates two channels — pl_retail and pl_b2b_vip — and
    // assigns the three SEED products to both. The new product above
    // is auto-bound to the system-default channel only. Add an
    // explicit binding so we can write VIP-scoped overrides.
    const conn = h.em().getConnection();
    const rows = await conn.execute<Array<{ id: string; code: string }>>(
      `select id, code from sales_channels where code in ('pl_retail', 'pl_b2b_vip')`,
      [],
      'all',
    );
    retailChannelId = rows.find((r) => r.code === 'pl_retail')!.id;
    vipChannelId = rows.find((r) => r.code === 'pl_b2b_vip')!.id;
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?)`,
      [retailChannelId, productId, vipChannelId, productId],
    );
    // Ensure both channels know the languages we'll use.
    await conn.execute(
      `update sales_channels set languages = '["pl-PL","en-US"]'::jsonb where id in (?, ?)`,
      [retailChannelId, vipChannelId],
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('happy path — bulk upsert + delete is atomic', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      payload: {
        upserts: [
          {
            attributeKey: 'name',
            channelId: vipChannelId,
            languageCode: 'en-US',
            value: { v: 'VIP wholesale name (EN)' },
          },
          {
            attributeKey: 'description',
            channelId: vipChannelId,
            languageCode: 'pl-PL',
            value: { v: 'Wholesale only — PL copy' },
          },
        ],
        deletes: [],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        productId: string;
        applied: { upserted: number; deleted: number };
        overrides: Array<{
          attributeKey: string;
          channelId: string;
          languageCode: string | null;
          value: { v: unknown };
        }>;
      };
    };
    expect(body.data.applied.upserted).toBe(2);
    expect(body.data.applied.deleted).toBe(0);
    expect(body.data.overrides).toHaveLength(2);
  });

  it('422 attribute_not_channel_scoped when the attribute is global-only', async () => {
    // The seeded `color` attribute defaults to channelScoped=false and
    // languageScoped=false. Attempting a channel-scoped override on it
    // MUST be rejected by the validator.
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      payload: {
        upserts: [
          {
            attributeKey: 'color',
            channelId: vipChannelId,
            languageCode: null,
            value: { v: 'illegal' },
          },
        ],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.message).toBe('attribute_not_channel_scoped');
  });

  it('422 attribute_missing_language when language-scoped slot omits language', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      payload: {
        upserts: [
          {
            attributeKey: 'name',
            channelId: vipChannelId,
            languageCode: null,
            value: { v: 'oops' },
          },
        ],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'attribute_missing_language',
    );
  });

  it('422 channel_not_assigned_to_product', async () => {
    // Create a channel-only attribute, then point at a channel the
    // product is NOT bound to. Use a fresh UUID that does not exist
    // in sales_channels — the membership lookup will reject it before
    // we even check existence on sales_channels.
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      payload: {
        upserts: [
          {
            attributeKey: 'name',
            channelId: '00000000-0000-4000-8000-deadbeefdead',
            languageCode: 'en-US',
            value: { v: 'noop' },
          },
        ],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'channel_not_assigned_to_product',
    );
  });

  it('422 language_not_in_channel', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      payload: {
        upserts: [
          {
            attributeKey: 'name',
            channelId: vipChannelId,
            languageCode: 'de-DE',
            value: { v: 'no DE here' },
          },
        ],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'language_not_in_channel',
    );
  });
});
