import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  attributeScopeChangePreviewResponseSchema,
  type AttributeScopeChangePreviewResponse,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedProductScopesAdmins } from '../../helpers/product-scopes-admins.js';

/**
 * Feature 163, Phase 9 (T068) — the FR-090 preview,
 * `GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview`
 * (`specs/163-product-data-scopes/contracts/admin-scopes-api.md` §6, research R27).
 *
 * - a narrowing counts, per channel, the overrides it would orphan — feature 174 (R15): the one
 *   `scopable` flag and the value type (`?valueType=`, text → non-text orphans the C×L rows);
 * - a widening reports 0;
 * - the attribute update that follows still retains every row (FR-015).
 *
 * The attribute keys and channels are per run; the override rows are this file's
 * own and deleted in `afterAll`.
 */
describe('Attribute scope-change preview (spec 163, FR-090)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const noCatalog = { cookies: { b2b_session: 'stub-product-scopes-no-catalog-session' } };
  let c1: string;
  let c2: string;
  const channels: string[] = [];
  const products: string[] = [];

  const url = (key: string, query = ''): string =>
    `/api/v1/admin/catalog/attributes/${key}/scope-change-preview${query}`;

  async function sql(statement: string, params: unknown[] = []): Promise<unknown> {
    return h.em().getConnection().execute(statement, params);
  }

  async function insertChannel(): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
       values (?, ?, ?::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, 'PLN', now(), now())`,
      [id, `sap-${run}-${channels.length}`, JSON.stringify({ 'en-US': `preview ${run}` })],
    );
    channels.push(id);
    return id;
  }

  async function createAttribute(key: string, scopable: boolean, type: 'input' | 'number' = 'input'): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      ...admin,
      payload: {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        type,
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        scopable,
      },
    });
    expect(res.statusCode).toBe(201);
  }

  async function createProduct(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: {
        sku: `SAP-${run}-${randomUUID().slice(0, 6)}`,
        type: 'simple',
        name: 'Preview probe',
        description: 'Preview probe',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    products.push(id);
    return id;
  }

  async function insertOverride(productId: string, key: string, channelId: string, languageCode: string | null): Promise<void> {
    await sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, ?, ?, ?::jsonb, now(), now())`,
      [productId, key, channelId, languageCode, JSON.stringify({ v: 'x' })],
    );
  }

  async function overrideCount(key: string): Promise<number> {
    const rows = (await sql(`select count(*)::text as n from product_value_overrides where attribute_key = ?`, [
      key,
    ])) as Array<{ n: string }>;
    return Number(rows[0]?.n ?? 0);
  }

  async function preview(key: string, query: string): Promise<AttributeScopeChangePreviewResponse['data']> {
    const res = await h.app.inject({ method: 'GET', url: url(key, query), ...admin });
    expect(res.statusCode).toBe(200);
    return attributeScopeChangePreviewResponseSchema.parse(res.json()).data;
  }

  /** Two products; channel × language rows in both channels, channel-only rows in c1. */
  async function seed(key: string): Promise<void> {
    const p1 = await createProduct();
    const p2 = await createProduct();
    await insertOverride(p1, key, c1, 'pl-PL');
    await insertOverride(p1, key, c1, 'de-DE');
    await insertOverride(p2, key, c1, 'pl-PL');
    await insertOverride(p2, key, c2, 'pl-PL');
    await insertOverride(p1, key, c1, null);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    // The no-catalog stub session answers 403 only once its admin row exists.
    await seedProductScopesAdmins(h);
    c1 = await insertChannel();
    c2 = await insertChannel();
  }, 60_000);

  afterAll(async () => {
    for (const id of products) await sql(`delete from product_value_overrides where product_id = ?`, [id]);
    for (const id of channels) await sql(`delete from sales_channels where id = ?`, [id]);
    await teardownBackendServer(h);
  });

  it('answers 401 without an admin and 403 without catalog:read', async () => {
    const key = `sap_gate_${run}`;
    await createAttribute(key, true);
    expect((await h.app.inject({ method: 'GET', url: url(key) })).statusCode).toBe(401);
    expect((await h.app.inject({ method: 'GET', url: url(key), ...noCatalog })).statusCode).toBe(403);
  });

  it('answers 404 for an unknown attribute and for a system one, 400 for a flag that is not a boolean', async () => {
    expect((await h.app.inject({ method: 'GET', url: url(`sap_none_${run}`), ...admin })).statusCode).toBe(404);
    expect((await h.app.inject({ method: 'GET', url: url('name'), ...admin })).statusCode).toBe(404);
    const key = `sap_bad_${run}`;
    await createAttribute(key, true);
    const bad = await h.app.inject({ method: 'GET', url: url(key, '?scopable=maybe'), ...admin });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  // Feature 174 (R15): scopable text → not scopable orphans every C and C×L row.
  it('scopable → not scopable counts every row the resolver reads now', async () => {
    const key = `sap_glob_${run}`;
    await createAttribute(key, true);
    await seed(key);
    const data = await preview(key, '?scopable=false');
    expect(data.orphanedOverrides).toBe(5);
    expect(data.byChannel.find((r) => r.channelId === c1)?.count).toBe(4);
    expect(data.byChannel.find((r) => r.channelId === c2)?.count).toBe(1);
  });

  // Feature 174 (T042, R15): a scopable text attribute turning non-text keeps {G, C}, so the
  // C×L rows are what it orphans.
  it('text \u2192 non-text counts the C\u00d7L rows only; an unknown value type is 400', async () => {
    const key = `sap_type_${run}`;
    await createAttribute(key, true);
    await seed(key);
    const data = await preview(key, '?valueType=number');
    expect(data.orphanedOverrides).toBe(4);
    expect(data.byChannel.find((r) => r.channelId === c1)?.count).toBe(3);
    expect(data.byChannel.find((r) => r.channelId === c2)?.count).toBe(1);
    expect(await preview(key, '?valueType=string')).toEqual({ orphanedOverrides: 0, byChannel: [] });
    const bad = await h.app.inject({ method: 'GET', url: url(key, '?valueType=colour'), ...admin });
    expect(bad.statusCode).toBe(400);
  });

  it('a widening reports 0', async () => {
    const key = `sap_wide_${run}`;
    await createAttribute(key, false);
    await seed(key);
    expect(await preview(key, '?scopable=true')).toEqual({ orphanedOverrides: 0, byChannel: [] });
    expect(await preview(key, '')).toEqual({ orphanedOverrides: 0, byChannel: [] });
  });

  it('the attribute update still retains every row after a narrowing (FR-015)', async () => {
    const key = `sap_keep_${run}`;
    await createAttribute(key, true);
    await seed(key);
    expect(await overrideCount(key)).toBe(5);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${key}`,
      ...admin,
      payload: { scopable: false },
    });
    expect(res.statusCode).toBe(200);
    expect(await overrideCount(key)).toBe(5);
    // Already orphaned: a further narrowing has nothing left to orphan.
    expect(await preview(key, '')).toEqual({ orphanedOverrides: 0, byChannel: [] });
  });
});
