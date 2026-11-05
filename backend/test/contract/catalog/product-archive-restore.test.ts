import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedProductScopesAdmins } from '../../helpers/product-scopes-admins.js';

/**
 * Feature 163, Phase 9a (T156c) — Archive / Restore are their own audited actions and
 * a status write never touches `archivedAt` (spec Session 2026-10-25; FR-010, FR-019,
 * FR-082, FR-112; research R30.3).
 *
 * - `POST …/products/:id/archive` and `…/restore` answer 401 / 403 before anything,
 *   404 for an unknown, a soft-deleted or a non-UUID id;
 * - Archive sets `archivedAt`, leaves the status untouched globally and in every scope
 *   row, writes one `product.archive` audit row whose before / after are
 *   `{ archivedAt }`, and announces `product.updated.v1` `['archivedAt']` then
 *   `product.archived.v1`; a repeat is a 200 no-op with no row and no event;
 * - Restore clears it with one `product.restore` row and `product.updated.v1` only;
 * - `PATCH` with `inactive` is plain off and `active` never restores (O-5);
 * - `draft` and the legacy `archived` are refused on the admin create / update and on
 *   the API-key upsert, whose update with `inactive` does not archive either;
 * - a create without status, and a duplicate (also of an archived active source),
 *   are `inactive` and not archived (Q1-d).
 */
describe('Archive / Restore one product (spec 163, T156c)', () => {
  let h: BackendServerHandle;
  let writeToken: string;
  let writeKeyId: string;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const reader = { cookies: { b2b_session: 'stub-product-scopes-reader-session' } };
  const noCatalog = { cookies: { b2b_session: 'stub-product-scopes-no-catalog-session' } };
  let channel: string;

  interface ErrorBody {
    error: { code: string; details?: unknown };
  }
  interface ProductBody {
    data: { id: string; status: string; archivedAt: string | null };
  }

  const archiveUrl = (id: string): string => `/api/v1/admin/catalog/products/${id}/archive`;
  const restoreUrl = (id: string): string => `/api/v1/admin/catalog/products/${id}/restore`;

  function body(sku: string, extra: Record<string, unknown> = {}) {
    return {
      sku,
      type: 'simple' as const,
      name: `Archive ${sku}`,
      description: 'desc',
      categoryIds: [],
      attributeValues: {},
      visibility: 'public' as const,
      ...extra,
    };
  }

  /** `'omit'` sends no status at all — a default parameter would turn `undefined` into `'active'`. */
  async function createProduct(status: 'active' | 'inactive' | 'omit' = 'active'): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: body(`ARCH-${run}-${randomUUID().slice(0, 6)}`, status === 'omit' ? {} : { status }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as ProductBody).data.id;
  }

  async function row(id: string): Promise<{ status: string; archived_at: Date | null }> {
    const [r] = await h
      .em()
      .getConnection()
      .execute<Array<{ status: string; archived_at: Date | string | null }>>(
        `select status, archived_at from products where id = ?`,
        [id],
      );
    if (!r) throw new Error('product row missing');
    // The raw driver read may hand `timestamptz` back as a string; normalise it.
    return { status: r.status, archived_at: r.archived_at === null ? null : new Date(r.archived_at) };
  }

  async function auditRows(
    action: string,
    id: string,
  ): Promise<Array<{ state_before: Record<string, unknown>; state_after: Record<string, unknown> }>> {
    return h
      .em()
      .getConnection()
      .execute(
        `select state_before, state_after from audit_log_entries
          where action = ? and object_type = 'product' and object_id = ? order by acted_at`,
        [action, id],
      );
  }

  /** Every `product.updated.v1` / `product.archived.v1` for `id`, in dispatch order. */
  function captureEvents(id: string): { seen: Array<{ name: string; changedFields?: string[] }>; stop: () => void } {
    const seen: Array<{ name: string; changedFields?: string[] }> = [];
    const offUpdated = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === id) seen.push({ name: 'product.updated.v1', changedFields: p.changedFields });
    });
    const offArchived = h.eventBus.on('product.archived.v1', (payload) => {
      const p = payload as unknown as { productId: string };
      if (p.productId === id) seen.push({ name: 'product.archived.v1' });
    });
    return {
      seen,
      stop: () => {
        offUpdated();
        offArchived();
      },
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedProductScopesAdmins(h);
    channel = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
         values (?, ?, '{"en-US":"T156c"}'::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, 'PLN', now(), now())`,
        [channel, `t156c-${run}`],
      );
    const key = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: `T156c writer ${run}`, scopes: ['catalog:write'] },
      ...admin,
    });
    writeToken = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
    // `createApiKeyResponseSchema` — the key itself is `data.apiKey`, beside the token.
    writeKeyId = (key.json() as { data: { apiKey: { id: string } } }).data.apiKey.id;
  }, 60_000);

  afterAll(async () => {
    await h.em().getConnection().execute(`delete from sales_channels where id = ?`, [channel]);
    await teardownBackendServer(h);
  });

  describe('gates (FR-084)', () => {
    it.each([
      ['archive', archiveUrl],
      ['restore', restoreUrl],
    ])('%s answers 401 without an admin and 403 without catalog:write', async (_name, url) => {
      const id = await createProduct();
      expect((await h.app.inject({ method: 'POST', url: url(id) })).statusCode).toBe(401);
      expect((await h.app.inject({ method: 'POST', url: url(id), ...noCatalog })).statusCode).toBe(403);
      expect((await h.app.inject({ method: 'POST', url: url(id), ...reader })).statusCode).toBe(403);
      // An unauthorised caller learns nothing about a missing id either.
      expect((await h.app.inject({ method: 'POST', url: url(randomUUID()), ...reader })).statusCode).toBe(403);
      expect((await row(id)).archived_at).toBeNull();
    });
  });

  describe('404s', () => {
    it.each([
      ['archive', archiveUrl],
      ['restore', restoreUrl],
    ])('%s answers 404 PRODUCT_NOT_FOUND for unknown, soft-deleted and non-UUID ids', async (_name, url) => {
      const deleted = await createProduct();
      expect(
        (await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${deleted}`, ...admin })).statusCode,
      ).toBe(204);
      for (const id of [randomUUID(), deleted, 'not-a-uuid']) {
        const res = await h.app.inject({ method: 'POST', url: url(id), ...admin });
        expect(res.statusCode, id).toBe(404);
        expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      }
    });
  });

  describe('Archive (FR-019)', () => {
    it('sets archivedAt only, audits once and announces updated then archived', async () => {
      const id = await createProduct('active');
      await h
        .em()
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel, id]);
      const scopes = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${id}/scopes`,
        ...admin,
        payload: {
          channels: [{ channelId: channel, status: 'inactive', languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] }],
        },
      });
      expect(scopes.statusCode).toBe(200);

      const events = captureEvents(id);
      const before = Date.now();
      const res = await h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin });
      events.stop();
      expect(res.statusCode).toBe(200);
      const data = (res.json() as ProductBody).data;
      expect(data.status).toBe('active');
      expect(data.archivedAt).not.toBeNull();
      expect(new Date(data.archivedAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);

      const stored = await row(id);
      expect(stored.status).toBe('active');
      const conn = h.em().getConnection();
      const [c] = await conn.execute<Array<{ status: string }>>(
        `select status from product_channel_scopes where product_id = ?`,
        [id],
      );
      const [l] = await conn.execute<Array<{ status: string }>>(
        `select status from product_channel_language_scopes where product_id = ?`,
        [id],
      );
      expect(c?.status).toBe('inactive');
      expect(l?.status).toBe('active');

      const audits = await auditRows('product.archive', id);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.state_before).toEqual({ archivedAt: null });
      expect(audits[0]!.state_after['archivedAt']).toBeTruthy();
      expect(Object.keys(audits[0]!.state_after)).toEqual(['archivedAt']);

      expect(events.seen).toEqual([
        { name: 'product.updated.v1', changedFields: ['archivedAt'] },
        { name: 'product.archived.v1' },
      ]);
    });

    it('concurrent Archives of one product transition it once: one audit row, one product.archived.v1 (C-W1)', async () => {
      const id = await createProduct('active');
      const events = captureEvents(id);
      const answers = await Promise.all(
        Array.from({ length: 4 }, () => h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin })),
      );
      events.stop();
      expect(answers.map((res) => res.statusCode)).toEqual([200, 200, 200, 200]);
      expect(await auditRows('product.archive', id)).toHaveLength(1);
      expect(events.seen.filter((e) => e.name === 'product.archived.v1')).toHaveLength(1);
    });

    it('a second Archive answers 200 with no audit row and no event', async () => {
      const id = await createProduct('inactive');
      expect((await h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin })).statusCode).toBe(200);
      const first = (await row(id)).archived_at;
      const events = captureEvents(id);
      const again = await h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin });
      events.stop();
      expect(again.statusCode).toBe(200);
      expect((again.json() as ProductBody).data.archivedAt).not.toBeNull();
      expect((await row(id)).archived_at?.getTime()).toBe(first?.getTime());
      expect(await auditRows('product.archive', id)).toHaveLength(1);
      expect(events.seen).toEqual([]);
    });
  });

  describe('Restore (FR-019)', () => {
    it('clears archivedAt, leaves status, audits once and announces updated only', async () => {
      const id = await createProduct('inactive');
      expect((await h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin })).statusCode).toBe(200);
      const events = captureEvents(id);
      const res = await h.app.inject({ method: 'POST', url: restoreUrl(id), ...admin });
      events.stop();
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductBody).data).toMatchObject({ status: 'inactive', archivedAt: null });
      expect(await row(id)).toEqual({ status: 'inactive', archived_at: null });
      const audits = await auditRows('product.restore', id);
      expect(audits).toHaveLength(1);
      expect(audits[0]!.state_before['archivedAt']).toBeTruthy();
      expect(audits[0]!.state_after).toEqual({ archivedAt: null });
      expect(events.seen).toEqual([{ name: 'product.updated.v1', changedFields: ['archivedAt'] }]);
    });

    it('a Restore of a product that is not archived is a 200 no-op', async () => {
      const id = await createProduct('active');
      const events = captureEvents(id);
      const res = await h.app.inject({ method: 'POST', url: restoreUrl(id), ...admin });
      events.stop();
      expect(res.statusCode).toBe(200);
      expect(await auditRows('product.restore', id)).toHaveLength(0);
      expect(events.seen).toEqual([]);
    });
  });

  describe('a status write never touches archivedAt (FR-010, O-5)', () => {
    it('PATCH inactive leaves archivedAt null and announces no archive', async () => {
      const id = await createProduct('active');
      const events = captureEvents(id);
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${id}`,
        ...admin,
        payload: { status: 'inactive' },
      });
      events.stop();
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductBody).data).toMatchObject({ status: 'inactive', archivedAt: null });
      expect(events.seen).toEqual([{ name: 'product.updated.v1', changedFields: ['status'] }]);
    });

    it('PATCH active on an archived product leaves it archived', async () => {
      const id = await createProduct('inactive');
      expect((await h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin })).statusCode).toBe(200);
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${id}`,
        ...admin,
        payload: { status: 'active' },
      });
      expect(res.statusCode).toBe(200);
      const data = (res.json() as ProductBody).data;
      expect(data.status).toBe('active');
      expect(data.archivedAt).not.toBeNull();
    });
  });

  describe('draft and archived are refused (FR-112, O-1)', () => {
    function expectStatusRefused(res: { statusCode: number; json: () => unknown }): void {
      expect(res.statusCode).toBe(400);
      const error = (res.json() as ErrorBody).error;
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(JSON.stringify(error.details)).toContain('status');
    }

    it.each(['draft', 'archived'])('admin create refuses %s', async (status) => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        ...admin,
        payload: body(`ARCH-REF-${run}-${status}`, { status }),
      });
      expectStatusRefused(res);
    });

    it.each(['draft', 'archived'])('admin update refuses %s and changes nothing', async (status) => {
      const id = await createProduct('active');
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${id}`,
        ...admin,
        payload: { status },
      });
      expectStatusRefused(res);
      expect(await row(id)).toEqual({ status: 'active', archived_at: null });
    });

    it.each(['draft', 'archived'])('the API-key upsert refuses %s', async (status) => {
      const sku = `ARCH-KEY-${run}-${status}`;
      const res = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/catalog/products/by-sku/${sku}`,
        payload: body(sku, { status }),
        headers: { authorization: `Bearer ${writeToken}` },
      });
      expectStatusRefused(res);
    });

    it('the API-key upsert of an existing product with inactive does not archive it', async () => {
      const sku = `ARCH-KEY-${run}-inactive`;
      const first = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/catalog/products/by-sku/${sku}`,
        payload: body(sku, { status: 'active' }),
        headers: { authorization: `Bearer ${writeToken}` },
      });
      expect(first.statusCode).toBe(201);
      const id = (first.json() as ProductBody).data.id;
      const second = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/catalog/products/by-sku/${sku}`,
        payload: body(sku, { status: 'inactive' }),
        headers: { authorization: `Bearer ${writeToken}` },
      });
      expect(second.statusCode).toBe(200);
      expect(await row(id)).toEqual({ status: 'inactive', archived_at: null });
    });

    it('the API-key upsert of an existing product is one audited product.update naming the key (S-W3)', async () => {
      const sku = `ARCH-KEY-${run}-audit`;
      const first = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/catalog/products/by-sku/${sku}`,
        payload: body(sku, { status: 'inactive' }),
        headers: { authorization: `Bearer ${writeToken}` },
      });
      expect(first.statusCode).toBe(201);
      const id = (first.json() as ProductBody).data.id;
      const second = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/catalog/products/by-sku/${sku}`,
        payload: body(sku, { status: 'active' }),
        headers: { authorization: `Bearer ${writeToken}` },
      });
      expect(second.statusCode, second.body).toBe(200);
      const updates = await auditRows('product.update', id);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.state_before).toMatchObject({ status: 'inactive' });
      // An undefined id would match an absent `apiKeyId` and prove nothing.
      expect(writeKeyId).toMatch(/^[0-9a-f-]{36}$/);
      expect(updates[0]!.state_after).toMatchObject({ status: 'active', apiKeyId: writeKeyId });
    });
  });

  describe('defaults (Q1-d)', () => {
    it('a create without status is inactive and not archived', async () => {
      const id = await createProduct('omit');
      expect(await row(id)).toEqual({ status: 'inactive', archived_at: null });
    });

    it('a duplicate of an archived active source is inactive and not archived', async () => {
      const id = await createProduct('active');
      expect((await h.app.inject({ method: 'POST', url: archiveUrl(id), ...admin })).statusCode).toBe(200);
      const dup = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${id}/duplicate`,
        ...admin,
      });
      expect(dup.statusCode).toBe(201);
      expect((dup.json() as ProductBody).data).toMatchObject({ status: 'inactive', archivedAt: null });
    });
  });
});
