import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type PatchProductScopesResponse, type ProductScopesResponse } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { seedOrganization } from '../../helpers/admin-search-fixtures.js';

/**
 * Feature 163, Phase 4 (T022, T028) — `GET|PATCH /api/v1/admin/catalog/products/:id/scopes`
 * (`specs/163-product-data-scopes/contracts/admin-scopes-api.md` §1–§2).
 *
 * - the `catalog:read` / `catalog:write` gates answer 401/403 before the body is
 *   validated (FR-084);
 * - one audit row per request whose `before` / `after` are the complete projection of
 *   every touched scope row, and re-sending `before` through the route restores the
 *   previous state exactly (FR-080, FR-081; R29, owner decision Q-D → A — there is no
 *   undo endpoint to assert);
 * - `product.updated.v1` after commit with `changedFields` `scopedStatus`,
 *   `publicationWindow`, `audience`, `orderRules` (FR-082);
 * - the FR-014 refusals and the FR-015 exception, with nothing written;
 * - neither a scope `inactive` nor the global one archives (FR-010; spec Session
 *   2026-10-25 — archiving is the separate Archive action, T156j);
 * - a soft-deleted product keeps its scope rows (edge case, T028).
 *
 * Every channel this file uses is its own, created with a per-run code and deleted
 * in `afterAll` (its scope rows go with it by cascade); no seeded channel's
 * languages are changed.
 */
describe('Product scopes — GET|PATCH /admin/catalog/products/:id/scopes (spec 163)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const reader = { cookies: { b2b_session: 'stub-product-scopes-reader-session' } };
  const noCatalog = { cookies: { b2b_session: 'stub-product-scopes-no-catalog-session' } };
  const READER_ID = '00000000-0000-4000-8000-0000000162a1';
  const NO_CATALOG_ID = '00000000-0000-4000-8000-0000000162a2';
  const ORG_X = randomUUID();

  let b2b: string;
  let b2c: string;
  let notMember: string;
  const channels: string[] = [];

  interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
  }

  const url = (productId: string): string => `/api/v1/admin/catalog/products/${productId}/scopes`;

  async function insertChannel(languages: string[]): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
         values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', now(), now())`,
        [id, `s162-${run}-${channels.length}`, JSON.stringify({ 'en-US': `162 ${run}` }), languages[0], JSON.stringify(languages)],
      );
    channels.push(id);
    return id;
  }

  async function createProduct(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: {
        sku: `SCOPES-${run}-${randomUUID().slice(0, 6)}`,
        type: 'simple',
        name: 'Scopes probe',
        description: 'Scopes probe',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    await h
      .em()
      .getConnection()
      .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?), (?, ?)`, [
        b2b,
        id,
        b2c,
        id,
      ]);
    return id;
  }

  async function patch(productId: string, payload: unknown, who = admin) {
    return h.app.inject({ method: 'PATCH', url: url(productId), ...who, payload: payload as object });
  }

  async function auditRows(productId: string): Promise<Array<{ state_before: unknown; state_after: unknown }>> {
    return h
      .em()
      .getConnection()
      .execute(
        `select state_before, state_after from audit_log_entries
          where action = 'product.scopes.update' and object_type = 'product' and object_id = ?
          order by acted_at`,
        [productId],
      );
  }

  async function scopeRowCounts(productId: string): Promise<{ channel: number; language: number }> {
    const conn = h.em().getConnection();
    const [c] = await conn.execute<Array<{ n: string }>>(
      `select count(*)::text as n from product_channel_scopes where product_id = ?`,
      [productId],
    );
    const [l] = await conn.execute<Array<{ n: string }>>(
      `select count(*)::text as n from product_channel_language_scopes where product_id = ?`,
      [productId],
    );
    if (!c || !l) throw new Error('count(*) returned no row');
    return { channel: Number(c.n), language: Number(l.n) };
  }

  function captureUpdates(productId: string): { fields: () => string[][]; stop: () => void } {
    const seen: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === productId) seen.push(p.changedFields);
    });
    return { fields: () => seen, stop: off };
  }

  async function ensureRole(code: string, permissions: string[]): Promise<string> {
    const em = h.em();
    let role = await em.findOne(AdminRole, { code });
    if (!role) role = em.create(AdminRole, { code, name: code, permissions });
    else role.permissions = permissions;
    await em.persistAndFlush(role);
    return role.id;
  }

  async function ensureAdmin(id: string, email: string, roleId: string): Promise<void> {
    const em = h.em();
    const existing = await em.findOne(AdminUser, { id });
    if (existing) {
      existing.adminRoleId = roleId;
      existing.status = 'active';
    } else {
      em.create(AdminUser, {
        id,
        email,
        passwordHash: 'x'.repeat(60),
        firstName: 'Product',
        lastName: 'Scopes',
        adminRoleId: roleId,
        status: 'active',
      });
    }
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel(['pl-PL', 'de-DE']);
    b2c = await insertChannel(['pl-PL', 'en-GB']);
    notMember = await insertChannel(['pl-PL']);
    const readerRole = await ensureRole('product_scopes_catalog_reader', ['catalog:read']);
    const noCatalogRole = await ensureRole('product_scopes_no_catalog', ['orders:read']);
    await ensureAdmin(READER_ID, 'product-scopes-reader@example.com', readerRole);
    await ensureAdmin(NO_CATALOG_ID, 'product-scopes-no-catalog@example.com', noCatalogRole);
  }, 60_000);

  afterAll(async () => {
    const conn = h.em().getConnection();
    for (const id of channels) await conn.execute(`delete from sales_channels where id = ?`, [id]);
    await teardownBackendServer(h);
  });

  describe('gates (FR-084) — before the body is validated', () => {
    it('answers 401 without an admin, on both routes, even for an invalid body', async () => {
      const productId = await createProduct();
      const get = await h.app.inject({ method: 'GET', url: url(productId) });
      expect(get.statusCode).toBe(401);
      const write = await h.app.inject({ method: 'PATCH', url: url(productId), payload: { channels: 'nope' } });
      expect(write.statusCode).toBe(401);
    });

    it('answers 403 to an admin without catalog:read on both routes', async () => {
      const productId = await createProduct();
      const get = await h.app.inject({ method: 'GET', url: url(productId), ...noCatalog });
      expect(get.statusCode).toBe(403);
      const write = await patch(productId, { channels: 'nope' }, noCatalog);
      expect(write.statusCode).toBe(403);
    });

    it('lets a catalogue reader read and refuses its write with 403', async () => {
      const productId = await createProduct();
      const get = await h.app.inject({ method: 'GET', url: url(productId), ...reader });
      expect(get.statusCode).toBe(200);
      const write = await patch(productId, { channels: [{ channelId: b2b, status: 'inactive' }] }, reader);
      expect(write.statusCode).toBe(403);
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
    });
  });

  describe('GET', () => {
    it('lists the member channels with their languages and the global values', async () => {
      const productId = await createProduct();
      const res = await h.app.inject({ method: 'GET', url: url(productId), ...admin });
      expect(res.statusCode).toBe(200);
      const { data } = res.json() as ProductScopesResponse;
      expect(data.global).toMatchObject({ status: 'active', publishFrom: null, publishUntil: null, visibility: 'public' });
      const mine = data.channels.filter((c) => c.channelId === b2b || c.channelId === b2c);
      expect(mine.map((c) => c.channelId).sort()).toEqual([b2b, b2c].sort());
      const b2bRow = mine.find((c) => c.channelId === b2b)!;
      expect(b2bRow).toMatchObject({
        isMember: true,
        orphaned: false,
        languages: ['pl-PL', 'de-DE'],
        status: null,
        window: null,
        audience: null,
        minOrderQuantity: null,
        returnable: null,
        languageStatuses: [],
      });
      expect(data.channels.some((c) => c.channelId === notMember)).toBe(false);
    });

    // Owner decision U1 — the answer names the organizations its audience rules name, so a
    // catalogue reader without `customers:read` reads names; an unknown id stays unnamed.
    it('names the organizations the audience names to a catalogue reader; an unknown one is left out', async () => {
      const productId = await createProduct();
      const org = await seedOrganization(h.em().fork(), { name: `Westfield ${run}` });
      const write = await patch(productId, {
        channels: [{ channelId: b2b, audience: { visibility: 'organization_restricted', allowedOrganizationIds: [org.id, ORG_X] } }],
      });
      expect(write.statusCode, write.body).toBe(200);
      expect((write.json() as PatchProductScopesResponse).data.organizations).toEqual([{ id: org.id, name: `Westfield ${run}` }]);

      const res = await h.app.inject({ method: 'GET', url: url(productId), ...reader });
      expect(res.statusCode).toBe(200);
      expect((res.json() as ProductScopesResponse).data.organizations).toEqual([{ id: org.id, name: `Westfield ${run}` }]);
    });

    it('answers 404 PRODUCT_NOT_FOUND for an unknown product', async () => {
      const res = await h.app.inject({ method: 'GET', url: url(randomUUID()), ...admin });
      expect(res.statusCode).toBe(404);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });
  });

  describe('PATCH — writes, audit and events', () => {
    it('writes every scoped field, audits once with a complete projection and emits one event', async () => {
      const productId = await createProduct();
      const events = captureUpdates(productId);
      const res = await patch(productId, {
        channels: [
          {
            channelId: b2b,
            status: 'inactive',
            window: { from: '2026-12-01T00:00:00.000Z', until: null },
            audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] },
            minOrderQuantity: 5,
            returnable: true,
            languageStatuses: [{ languageCode: 'de-DE', status: 'active' }],
          },
        ],
      });
      events.stop();
      expect(res.statusCode).toBe(200);
      const body = res.json() as PatchProductScopesResponse;
      const row = body.data.channels.find((c) => c.channelId === b2b)!;
      expect(row).toMatchObject({
        status: 'inactive',
        window: { from: '2026-12-01T00:00:00.000Z', until: null },
        audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X], nonMemberOrganizationIds: [ORG_X] },
        minOrderQuantity: 5,
        returnable: true,
        languageStatuses: [{ languageCode: 'de-DE', status: 'active', orphaned: false }],
      });
      // C4 — the override may name an organization the channel does not offer; saved, with a warning.
      expect(body.warnings).toContainEqual({ kind: 'audience_non_members', channelId: b2b, organizationIds: [ORG_X] });

      const audits = await auditRows(productId);
      expect(audits).toHaveLength(1);
      // Feature 172 (FR-074, FR-116) — the before-state is in the write encoding: a scope that
      // held no own value is `{ inherit: true }`, so re-sending it restores the row exactly.
      const inherit = { inherit: true };
      expect(audits[0]!.state_before).toEqual({
        channels: [
          {
            channelId: b2b,
            status: inherit,
            window: inherit,
            audience: inherit,
            minOrderQuantity: inherit,
            returnable: inherit,
            languageStatuses: [{ languageCode: 'de-DE', status: inherit }],
          },
        ],
      });
      expect(audits[0]!.state_after).toMatchObject({
        channels: [
          {
            channelId: b2b,
            status: 'inactive',
            window: { from: '2026-12-01T00:00:00.000Z', until: null },
            audience: { visibility: 'organization_restricted', allowedOrganizationIds: [ORG_X] },
            minOrderQuantity: 5,
            returnable: true,
            languageStatuses: [{ languageCode: 'de-DE', status: 'active' }],
          },
        ],
      });
      expect(events.fields()).toHaveLength(1);
      expect([...events.fields()[0]!].sort()).toEqual(['audience', 'orderRules', 'publicationWindow', 'scopedStatus']);
    });

    it('re-sending the audit before-state restores the previous state exactly (R29, Q-D → A)', async () => {
      const productId = await createProduct();
      const first = await patch(productId, { channels: [{ channelId: b2b, status: 'inactive', returnable: false }] });
      expect(first.statusCode).toBe(200);
      const snapshot = (await h.app.inject({ method: 'GET', url: url(productId), ...admin })).json() as ProductScopesResponse;

      const second = await patch(productId, {
        channels: [
          {
            channelId: b2b,
            status: 'active',
            returnable: { inherit: true },
            languageStatuses: [{ languageCode: 'pl-PL', status: 'inactive' }],
          },
        ],
        global: { publishUntil: '2027-01-01T00:00:00.000Z' },
      });
      expect(second.statusCode).toBe(200);
      const audits = await auditRows(productId);
      expect(audits).toHaveLength(2);

      const restore = await patch(productId, audits[1]!.state_before);
      expect(restore.statusCode).toBe(200);
      const restored = (await h.app.inject({ method: 'GET', url: url(productId), ...admin })).json() as ProductScopesResponse;
      expect(restored.data).toEqual(snapshot.data);
    });

    it('"use inherited" ({ inherit: true }) on the last override deletes the row (FR-012, FR-116)', async () => {
      const productId = await createProduct();
      await patch(productId, { channels: [{ channelId: b2b, status: 'inactive', languageStatuses: [{ languageCode: 'de-DE', status: 'inactive' }] }] });
      expect(await scopeRowCounts(productId)).toEqual({ channel: 1, language: 1 });
      const inherit = { inherit: true };
      const res = await patch(productId, {
        channels: [{ channelId: b2b, status: inherit, languageStatuses: [{ languageCode: 'de-DE', status: inherit }] }],
      });
      expect(res.statusCode).toBe(200);
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
    });

    it('a status takes no empty value: null is refused (FR-113), nothing written', async () => {
      const productId = await createProduct();
      const res = await patch(productId, { channels: [{ channelId: b2b, status: null }] });
      expect(res.statusCode).toBe(422);
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
    });

    it('a request that changes nothing writes no audit row and emits no event', async () => {
      const productId = await createProduct();
      await patch(productId, { channels: [{ channelId: b2b, status: 'inactive' }] });
      const events = captureUpdates(productId);
      const res = await patch(productId, { channels: [{ channelId: b2b, status: 'inactive' }] });
      events.stop();
      expect(res.statusCode).toBe(200);
      expect(await auditRows(productId)).toHaveLength(1);
      expect(events.fields()).toHaveLength(0);
    });

    it('the global window is written through the same Command with changedFields publicationWindow', async () => {
      const productId = await createProduct();
      const events = captureUpdates(productId);
      const res = await patch(productId, { channels: [], global: { publishFrom: '2026-12-01T00:00:00.000Z' } });
      events.stop();
      expect(res.statusCode).toBe(200);
      expect((res.json() as PatchProductScopesResponse).data.global.publishFrom).toBe('2026-12-01T00:00:00.000Z');
      expect(events.fields()).toEqual([['publicationWindow']]);
    });
  });

  describe('PATCH /products/:id — the global window through product.update (T026)', () => {
    it('writes the global window, announces publicationWindow and leaves overrides alone', async () => {
      const productId = await createProduct();
      await patch(productId, { channels: [{ channelId: b2b, window: { from: null, until: null } }] });
      const events = captureUpdates(productId);
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${productId}`,
        ...admin,
        payload: { publishFrom: '2026-12-01T00:00:00.000Z', publishUntil: '2026-12-31T23:59:59.999Z' },
      });
      events.stop();
      expect(res.statusCode).toBe(200);
      expect(events.fields()).toEqual([['publicationWindow']]);
      const read = (await h.app.inject({ method: 'GET', url: url(productId), ...admin })).json() as ProductScopesResponse;
      expect(read.data.global).toMatchObject({
        publishFrom: '2026-12-01T00:00:00.000Z',
        publishUntil: '2026-12-31T23:59:59.999Z',
      });
      expect(read.data.channels.find((c) => c.channelId === b2b)?.window).toEqual({ from: null, until: null });
    });

    it('refuses a global window that does not start before it ends — 422 VALIDATION_FAILED, field window', async () => {
      const productId = await createProduct();
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${productId}`,
        ...admin,
        payload: { publishFrom: '2026-12-31T00:00:00.000Z', publishUntil: '2026-12-01T00:00:00.000Z' },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as ErrorBody).error.details).toMatchObject({ field: 'window' });
    });
  });

  describe('PATCH — refusals, with nothing written', () => {
    it('a channel the product is not a member of → 422 SCOPE_INVALID not_a_member', async () => {
      const productId = await createProduct();
      const res = await patch(productId, {
        channels: [
          { channelId: b2b, status: 'inactive' },
          { channelId: notMember, status: 'active' },
        ],
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(ERROR_CODES.SCOPE_INVALID);
      expect(body.error.details).toEqual({ channelId: notMember, reason: 'not_a_member' });
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
      expect(await auditRows(productId)).toHaveLength(0);
    });

    it('a language the channel does not offer → 422 SCOPE_INVALID language_not_offered', async () => {
      const productId = await createProduct();
      const res = await patch(productId, {
        channels: [{ channelId: b2b, languageStatuses: [{ languageCode: 'en-GB', status: 'active' }] }],
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as ErrorBody).error.details).toEqual({
        channelId: b2b,
        languageCode: 'en-GB',
        reason: 'language_not_offered',
      });
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
    });

    it('window from >= until → 422 VALIDATION_FAILED, field window', async () => {
      const productId = await createProduct();
      const res = await patch(productId, {
        channels: [{ channelId: b2b, window: { from: '2026-12-31T00:00:00.000Z', until: '2026-12-01T00:00:00.000Z' } }],
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(body.error.details).toMatchObject({ field: 'window' });
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
    });

    it('removing an orphaned override is always allowed (FR-015)', async () => {
      const productId = await createProduct();
      await patch(productId, { channels: [{ channelId: b2c, status: 'inactive' }] });
      await h
        .em()
        .getConnection()
        .execute(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [b2c, productId]);
      const read = (await h.app.inject({ method: 'GET', url: url(productId), ...admin })).json() as ProductScopesResponse;
      expect(read.data.channels.find((c) => c.channelId === b2c)).toMatchObject({ isMember: false, orphaned: true, status: 'inactive' });

      const refused = await patch(productId, { channels: [{ channelId: b2c, status: 'active' }] });
      expect(refused.statusCode).toBe(422);
      const removed = await patch(productId, { channels: [{ channelId: b2c, status: { inherit: true } }] });
      expect(removed.statusCode).toBe(200);
      expect(await scopeRowCounts(productId)).toEqual({ channel: 0, language: 0 });
    });
  });

  describe('status semantics (FR-010)', () => {
    it('a scope inactive never archives, and neither does the global inactive', async () => {
      const productId = await createProduct();
      const archived: string[] = [];
      const off = h.eventBus.on('product.archived.v1', (payload) => {
        const p = payload as unknown as { productId: string };
        if (p.productId === productId) archived.push(p.productId);
      });
      const scoped = await patch(productId, {
        channels: [{ channelId: b2b, status: 'inactive', languageStatuses: [{ languageCode: 'de-DE', status: 'inactive' }] }],
      });
      expect(scoped.statusCode).toBe(200);
      const [row] = await h
        .em()
        .getConnection()
        .execute<Array<{ status: string; archived_at: Date | null }>>(`select status, archived_at from products where id = ?`, [productId]);
      expect(row).toEqual({ status: 'active', archived_at: null });
      expect(archived).toHaveLength(0);

      const global = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${productId}`,
        ...admin,
        payload: { status: 'inactive' },
      });
      expect(global.statusCode).toBe(200);
      off();
      expect(archived).toHaveLength(0);
      const [after] = await h
        .em()
        .getConnection()
        .execute<Array<{ status: string; archived_at: Date | null }>>(`select status, archived_at from products where id = ?`, [productId]);
      expect(after).toEqual({ status: 'inactive', archived_at: null });
    });
  });

  describe('soft delete (edge case, T028)', () => {
    it('a soft-deleted product keeps its scope rows', async () => {
      const productId = await createProduct();
      await patch(productId, {
        channels: [{ channelId: b2b, status: 'inactive', languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] }],
      });
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${productId}`, ...admin });
      expect(del.statusCode).toBe(204);
      expect(await scopeRowCounts(productId)).toEqual({ channel: 1, language: 1 });
    });
  });
});
