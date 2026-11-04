import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  type CatalogProductScopeWritePort,
  type CatalogProductWritePort,
  type ScopeOverviewResponse,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 163, Phase 11 (T078, US6, FR-060, FR-061, FR-041) — the completeness gate.
 *
 * - `catalog.scope_completeness_gate` defaults to `warn`: the status change is saved
 *   and the answer names what is missing per pair;
 * - `refuse` refuses a single edit as a whole, naming every failing pair (N3) — the
 *   global switch through `PATCH /products/:id` and a channel row through the scopes
 *   PATCH — with nothing saved;
 * - bulk status, global and scoped, changes the passing products and skips the
 *   failing ones as `completeness_gate` (US6 #4);
 * - the integration ports (`catalogProductScopeWritePort`, `catalogProductWritePort`)
 *   are never gated (A-6);
 * - M3 → A: joining a channel, a channel gaining a language, a window-only and an
 *   audience-only scopes PATCH, Archive and Restore never fire it, even in `refuse` —
 *   and the scope overview then shows the gap (`cells[].missing`, FR-041);
 * - the gate reads status only: `active` on an archived product is refused in
 *   `refuse` mode although the product stays archived.
 *
 * Feature 172 (FR-095, FR-096): a Global name satisfies every (C, L), so the missing value is a
 * required scopable text attribute — every product holds it at (C, pl-PL) of each member channel
 * only, so (B2C, de-DE) lacks it; a "complete" product holds it at Global. The setting is put
 * back to its default after every case.
 */
describe('completeness gate (spec 163, T078)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const admin = { b2b_session: 'stub-admin-session' };
  const SETTING = 'catalog.scope_completeness_gate';
  let b2c: { id: string; code: string }; // pl-PL, de-DE
  let b2b: { id: string; code: string }; // pl-PL
  const channels: string[] = [];
  const products: string[] = [];
  let fx: ScopedValuesFixture;
  let required: string;
  let attributeSetId: string;
  /** What every incomplete product misses at (B2C, de-DE). */
  let MISSING: string[];

  const conn = () => h.em().getConnection();
  const asSystem = <T>(fn: () => Promise<T>) => withSystemScope('163 completeness gate test', fn);

  async function insertChannel(label: string, languages: string[]): Promise<{ id: string; code: string }> {
    const id = randomUUID();
    const code = `scg-${RUN}-${label}`;
    await conn().execute(
      // `currencies` carries the default currency, so the channel's own PATCH (a channel
      // gaining a language) passes the update's defaultCurrency ∈ currencies check.
      `insert into sales_channels (id, code, name, default_language, languages, default_currency, currencies, created_at, updated_at)
       values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', '["PLN"]'::jsonb, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `gate ${label}` }), languages[0], JSON.stringify(languages)],
    );
    channels.push(id);
    return { id, code };
  }

  /** A product holding the required attribute at (C, pl-PL) of each channel in `memberOf` only — or at Global when `complete`. */
  async function product(
    label: string,
    options: { status?: 'active' | 'inactive'; memberOf?: string[]; complete?: boolean } = {},
  ): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: admin,
      payload: {
        sku: `SCG-${RUN}-${label}`,
        type: 'simple',
        name: `Bramka ${label}`,
        description: '',
        categoryIds: [],
        attributeSetId,
        attributeValues: options.complete ? { [required]: 'Stal' } : {},
        visibility: 'public',
        status: options.status ?? 'inactive',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    await conn().execute(`delete from sales_channel_products where product_id = ?`, [id]);
    for (const channelId of options.memberOf ?? [b2c.id, b2b.id]) {
      await conn().execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, id]);
      if (!options.complete) {
        await conn().execute(
          `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
           values (gen_random_uuid(), ?, ?, ?, 'pl-PL', '{"v":"Stal"}'::jsonb, now(), now())`,
          [id, required, channelId],
        );
      }
    }
    products.push(id);
    return id;
  }

  async function setMode(value: 'warn' | 'refuse'): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${SETTING}/value`,
      cookies: admin,
      payload: { scope: 'all', value },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function status(productId: string): Promise<{ status: string; archived: boolean }> {
    const [row] = await conn().execute<Array<{ status: string; archived_at: unknown }>>(
      `select status, archived_at from products where id = ?`,
      [productId],
    );
    return { status: row!.status, archived: row!.archived_at !== null };
  }

  async function channelRow(productId: string, channelId: string): Promise<string | null | undefined> {
    const [row] = await conn().execute<Array<{ status: string | null }>>(
      `select status from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
      [productId, channelId],
    );
    return row === undefined ? undefined : row.status;
  }

  const patchProduct = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/catalog/products/${id}`, cookies: admin, payload });
  const patchScopes = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/catalog/products/${id}/scopes`, cookies: admin, payload });
  const bulk = (productIds: string[], fields: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      cookies: admin,
      payload: { productIds, fields },
    });
  const overview = async (id: string): Promise<ScopeOverviewResponse['data']> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}/scope-overview`,
      cookies: admin,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as ScopeOverviewResponse).data;
  };
  const cellOf = (data: ScopeOverviewResponse['data'], channelId: string, languageCode: string) =>
    data.cells.find((c) => c.channelId === channelId && c.languageCode === languageCode);
  const port = <T>(name: string): T => (h.container as unknown as { resolve<U>(n: string): U }).resolve<T>(name);

  interface Warning {
    kind: string;
    channelId: string;
    languageCode: string;
    missing: string[];
  }
  interface Refusal {
    error: { code: string; details: { pairs: Array<{ channelId: string; languageCode: string; missing: string[] }> } };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    required = await fx.attribute({ key: 'gate_material', valueType: 'string', scopable: true, isRequired: true });
    attributeSetId = (await fx.sql<{ id: string }>(`select id::text as id from attribute_sets where code = ?`, [`sv170_${fx.run}`]))[0]!.id;
    MISSING = [`attribute:${required}`];
    b2c = await insertChannel('b2c', ['pl-PL', 'de-DE']);
    b2b = await insertChannel('b2b', ['pl-PL']);
  }, 60_000);

  afterEach(async () => {
    // Back to the default: the global value removed, not overwritten with `warn`.
    const reset = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/settings/${SETTING}/values`, cookies: admin });
    expect(reset.statusCode, reset.body).toBeLessThan(300);
  });

  afterAll(async () => {
    if (h) {
      for (const id of products) await conn().execute(`delete from products where id = ?`, [id]);
      await fx.cleanup();
      for (const id of channels) {
        await conn().execute(`delete from sales_channel_products where sales_channel_id = ?`, [id]);
        await conn().execute(`delete from sales_channels where id = ?`, [id]);
      }
      await teardownBackendServer(h);
    }
  });

  describe('warn (the default)', () => {
    it('saves the global switch and names the missing German value at (B2C, de-DE) (US6 #1)', async () => {
      const id = await product('warn-global');
      const res = await patchProduct(id, { status: 'active' });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { warnings: Warning[] }).warnings).toEqual([
        { kind: 'completeness', channelId: b2c.id, languageCode: 'de-DE', missing: MISSING },
      ]);
      expect((await status(id)).status).toBe('active');
    });

    it('saves a channel × language status and warns on the scopes answer', async () => {
      const id = await product('warn-scope');
      const res = await patchScopes(id, { channels: [{ channelId: b2c.id, languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] }] });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { warnings: Warning[] }).warnings).toContainEqual({
        kind: 'completeness',
        channelId: b2c.id,
        languageCode: 'de-DE',
        missing: MISSING,
      });
    });

    it('a complete product warns about nothing (US6 #2), and a global key satisfies the URL key (US6 #5)', async () => {
      const id = await product('complete', { complete: true });
      const res = await patchProduct(id, { status: 'active' });
      expect((res.json() as { warnings: Warning[] }).warnings).toEqual([]);
    });
  });

  describe('refuse', () => {
    it('refuses the global switch as a whole, naming the failing pair, with nothing saved (US6 #3, N3)', async () => {
      await setMode('refuse');
      const id = await product('refuse-global');
      const res = await patchProduct(id, { status: 'active', name: 'Zmieniona' });
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as Refusal).error;
      expect(error.code).toBe(ERROR_CODES.SCOPE_INCOMPLETE);
      expect(error.details.pairs).toEqual([{ channelId: b2c.id, languageCode: 'de-DE', missing: MISSING }]);
      expect((await status(id)).status).toBe('inactive');
      const [row] = await conn().execute<Array<{ name: string }>>(`select name from products where id = ?`, [id]);
      expect(row?.name).toBe(`Bramka refuse-global`);
    });

    it('refuses a channel row that turns on every language of the channel, writing no row', async () => {
      await setMode('refuse');
      const id = await product('refuse-channel');
      const res = await patchScopes(id, { channels: [{ channelId: b2c.id, status: 'active' }] });
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as Refusal).error.details.pairs).toEqual([
        { channelId: b2c.id, languageCode: 'de-DE', missing: MISSING },
      ]);
      expect(await channelRow(id, b2c.id)).toBeUndefined();
      // A pair that passes is saved: B2B offers pl-PL only.
      const passing = await patchScopes(id, { channels: [{ channelId: b2b.id, status: 'active' }] });
      expect(passing.statusCode, passing.body).toBe(200);
      expect(await channelRow(id, b2b.id)).toBe('active');
    });

    it('a status write turning nothing on is not gated (an `inactive` write)', async () => {
      await setMode('refuse');
      const id = await product('refuse-off', { status: 'active' });
      expect((await patchProduct(id, { status: 'inactive' })).statusCode).toBe(200);
    });

    it('bulk global status changes the passing products and skips the failing one (US6 #4)', async () => {
      await setMode('refuse');
      const failing = await product('bulk-fail');
      const passing = await product('bulk-pass', { complete: true });
      const res = await bulk([failing, passing], { status: 'active' });
      expect(res.statusCode, res.body).toBe(200);
      const results = (res.json() as { data: { results: Array<{ productId: string; status: string; reason?: string }> } }).data
        .results;
      expect(results.find((r) => r.productId === failing)).toMatchObject({ status: 'skipped', reason: 'completeness_gate' });
      expect(results.find((r) => r.productId === passing)).toMatchObject({ status: 'succeeded' });
      expect((await status(failing)).status).toBe('inactive');
      expect((await status(passing)).status).toBe('active');
    });

    it('bulk scoped status likewise; in warn the failing product succeeds with details.code SCOPE_INCOMPLETE', async () => {
      await setMode('refuse');
      const failing = await product('bulks-fail');
      const passing = await product('bulks-pass', { complete: true });
      const scoped = { scopedStatus: { channelId: b2c.id, languageCode: null, value: 'active' } };
      const refused = (await bulk([failing, passing], scoped)).json() as {
        data: { results: Array<{ productId: string; status: string; reason?: string; details?: { code?: string } }> };
      };
      expect(refused.data.results.find((r) => r.productId === failing)).toMatchObject({ status: 'skipped', reason: 'completeness_gate' });
      expect(refused.data.results.find((r) => r.productId === passing)).toMatchObject({ status: 'succeeded' });
      expect(await channelRow(failing, b2c.id)).toBeUndefined();

      await setMode('warn');
      const warned = (await bulk([failing], scoped)).json() as typeof refused;
      expect(warned.data.results[0]).toMatchObject({ status: 'succeeded', details: { code: ERROR_CODES.SCOPE_INCOMPLETE } });
      expect(await channelRow(failing, b2c.id)).toBe('active');
    });

    it('the integration ports are never gated (A-6, FR-061)', async () => {
      await setMode('refuse');
      const scoped = await product('port-scope');
      await asSystem(() =>
        port<CatalogProductScopeWritePort>('catalogProductScopeWritePort').applyScopes(
          scoped,
          { cells: [{ scope: { level: 'channel', channelId: b2c.id }, field: 'status', op: { op: 'set', value: 'active' } }] },
          { source: 'pim_connector' },
        ),
      );
      expect(await channelRow(scoped, b2c.id)).toBe('active');
      const global = await product('port-global');
      await asSystem(() => port<CatalogProductWritePort>('catalogProductWritePort').updateProduct(global, { status: 'active' }));
      expect((await status(global)).status).toBe('active');
    });

    it('the API-key upsert is an integration path and is never gated (A-6, S-W3)', async () => {
      await setMode('refuse');
      const id = await product('api-key');
      const key = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        cookies: admin,
        payload: { name: `163 gate ${RUN}`, scopes: ['catalog:write'] },
      });
      expect(key.statusCode, key.body).toBe(201);
      const token = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/catalog/products/by-sku/SCG-${RUN}-api-key`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          sku: `SCG-${RUN}-api-key`,
          type: 'simple',
          name: 'Bramka api-key',
          description: '',
          categoryIds: [],
          attributeSetId,
          // The upsert validates the set's required attributes at Global; the gate is what is not run.
          attributeValues: { [required]: 'Stal' },
          visibility: 'public',
          status: 'active',
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect((await status(id)).status).toBe('active');
    });

    it('the gate reads status only: active on an archived product is refused, and it stays archived (FR-060)', async () => {
      await setMode('refuse');
      const id = await product('archived');
      expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${id}/archive`, cookies: admin })).statusCode).toBe(200);
      const res = await patchProduct(id, { status: 'active' });
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as Refusal).error.details.pairs).toEqual([
        { channelId: b2c.id, languageCode: 'de-DE', missing: MISSING },
      ]);
      expect(await status(id)).toEqual({ status: 'inactive', archived: true });
    });
  });

  describe('M3 → A: nothing but a status write fires it, even in refuse', () => {
    it('Archive and Restore, single and bulk, are saved without a refusal or a warning (FR-019)', async () => {
      await setMode('refuse');
      const id = await product('restore', { status: 'active', memberOf: [b2b.id] });
      expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${id}/archive`, cookies: admin })).statusCode).toBe(200);
      await conn().execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [b2c.id, id]);
      expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/catalog/products/${id}/restore`, cookies: admin })).statusCode).toBe(200);
      expect(await status(id)).toEqual({ status: 'active', archived: false });
      expect((await bulk([id], { archived: true })).json()).toMatchObject({ data: { results: [{ status: 'succeeded' }] } });
      const restored = (await bulk([id], { archived: false })).json() as { data: { results: Array<Record<string, unknown>> } };
      expect(restored.data.results[0]).toEqual({ productId: id, status: 'succeeded', changedFields: ['archivedAt'] });
    });

    it('joining a channel offering German saves, and the overview shows the gap there (US6 #6, FR-041)', async () => {
      await setMode('refuse');
      const id = await product('join', { status: 'active', memberOf: [b2b.id] });
      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/sales-channels/${b2c.code}/product/${id}`,
        cookies: admin,
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
      const data = await overview(id);
      // Feature 172: the product's value is a (B2B, pl-PL) one, so the joined channel lacks it in
      // every language it offers.
      expect(cellOf(data, b2c.id, 'de-DE')?.missing).toEqual(MISSING);
      expect(cellOf(data, b2c.id, 'pl-PL')?.missing).toEqual(MISSING);
      expect(cellOf(data, b2b.id, 'pl-PL')?.missing).toEqual([]);
      // A language the channel does not offer is not evaluable.
      expect(cellOf(data, b2b.id, 'de-DE')).not.toHaveProperty('missing');
    });

    it('a bulk channel join without status saves', async () => {
      await setMode('refuse');
      const id = await product('bulk-join', { status: 'active', memberOf: [b2b.id] });
      const res = await bulk([id], { salesChannels: { mode: 'add', channelIds: [b2c.id] } });
      expect((res.json() as { data: { results: Array<{ status: string }> } }).data.results[0]).toMatchObject({ status: 'succeeded' });
    });

    it('a channel gaining a language saves, and the overview shows the gap (US6 #6)', async () => {
      await setMode('refuse');
      const solo = await insertChannel('solo', ['pl-PL']);
      const id = await product('gain', { status: 'active', memberOf: [solo.id] });
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/sales-channels/${solo.code}`, cookies: admin });
      const version = (detail.json() as { data?: { version: number }; version?: number }).data?.version ??
        (detail.json() as { version: number }).version;
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/sales-channels/${solo.code}`,
        cookies: admin,
        payload: { languages: ['pl-PL', 'en-US'], expectedVersion: version },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(cellOf(await overview(id), solo.id, 'en-US')?.missing).toEqual(MISSING);
    });

    it.each([
      ['a window-only change opening the window now', { window: { from: new Date(Date.now() - 60_000).toISOString(), until: null } }],
      ['an audience-only change', { audience: { visibility: 'logged_in_only', allowedOrganizationIds: [] } }],
    ])('%s saves without a warning', async (_name, change) => {
      await setMode('refuse');
      const id = await product(`m3-${_name.length}`, { status: 'active' });
      const res = await patchScopes(id, { channels: [{ channelId: b2c.id, ...change }] });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { warnings: Warning[] }).warnings.filter((w) => w.kind === 'completeness')).toEqual([]);
    });
  });
});
