import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import { ProductScopesService } from '../../../../packages/modules/catalog/dist/backend/services/product-scopes.service.js';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 10 (T073, US5, FR-050–FR-052, FR-053) — bulk scoped status on the
 * existing `POST /api/v1/admin/catalog/products/bulk-update`:
 *
 * - a selection and one scope → only that scope's row changes on each product; every
 *   other scope row and the global status stay as they were (US5 #1);
 * - each product's change is one `product.scopes.update` audit entry naming the scope,
 *   and one `product.updated.v1` `['scopedStatus']` (SC-006, FR-082);
 * - a product not in the chosen channel, or a language the channel does not offer, is
 *   skipped as `scope_invalid` and never added to the channel (US5 #3, FR-051);
 * - `scopedStatus` beside `status` is `400 VALIDATION_FAILED` (one meaning per action),
 *   and `draft` / `archived` are refused by the schema (FR-053, FR-112);
 * - above `BULK_ASYNC_THRESHOLD` the edit is queued, and its undo restores the scope
 *   rows as a whole with the per-product conflict report (US5 #2), announcing
 *   `product.updated.v1` `['scopedStatus']` per reverted product and never touching
 *   `archivedAt`; 1 000 products are undone in one action.
 */
describe('POST /products/bulk-update — fields.scopedStatus (spec 163, T073)', () => {
  let h: BackendServerHandle;
  const RUN = randomUUID().slice(0, 8);
  const adminCookie = { b2b_session: 'stub-admin-session' };
  let b2c: string; // pl-PL, de-DE
  let b2b: string; // pl-PL
  let other: string; // pl-PL — no selected product is a member
  const channels: string[] = [];

  const conn = () => h.em().getConnection();

  async function insertChannel(label: string, languages: string[]): Promise<string> {
    const id = randomUUID();
    await conn().execute(
      `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
       values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', now(), now())`,
      [id, `bss-${RUN}-${label}`, JSON.stringify({ 'en-US': `bulk scoped ${label}` }), languages[0], JSON.stringify(languages)],
    );
    channels.push(id);
    return id;
  }

  async function seedProducts(count: number, label: string, memberOf: string[] = [b2c, b2b]): Promise<string[]> {
    const em = h.em();
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const sku = `BSS-${RUN}-${label}-${i}`;
      const p = em.create(Product, {
        sku,
        slug: sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: `Bulk scoped ${sku}`,
        description: '',
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: {},
      });
      em.persist(p);
      ids.push(p.id);
    }
    await em.flush();
    if (memberOf.length > 0) {
      const values = ids.flatMap((id) => memberOf.map((channelId) => [channelId, id]));
      await conn().execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values ${values.map(() => '(?, ?)').join(', ')}`,
        values.flat(),
      );
    }
    return ids;
  }

  async function channelStatus(productId: string, channelId: string): Promise<string | null | undefined> {
    const [row] = await conn().execute<Array<{ status: string | null }>>(
      `select status from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
      [productId, channelId],
    );
    return row === undefined ? undefined : row.status;
  }

  async function languageStatus(productId: string, channelId: string, languageCode: string): Promise<string | undefined> {
    const [row] = await conn().execute<Array<{ status: string }>>(
      `select status from product_channel_language_scopes where product_id = ? and sales_channel_id = ? and language_code = ?`,
      [productId, channelId, languageCode],
    );
    return row?.status;
  }

  async function isMember(productId: string, channelId: string): Promise<boolean> {
    const rows = await conn().execute<Array<{ n: number }>>(
      `select 1 as n from sales_channel_products where product_id = ? and sales_channel_id = ?`,
      [productId, channelId],
    );
    return rows.length > 0;
  }

  async function scopeAudits(productId: string): Promise<Array<{ state_before: unknown; state_after: unknown }>> {
    return conn().execute(
      `select state_before, state_after from audit_log_entries
        where action = 'product.scopes.update' and object_type = 'product' and object_id = ?
        order by acted_at`,
      [productId],
    );
  }

  function bulk(productIds: string[], fields: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds, fields },
      cookies: adminCookie,
    });
  }

  function capture(bus: EventBus, ids: string[]) {
    const wanted = new Set(ids);
    const seen: Array<{ productId: string; changedFields: string[] }> = [];
    const off = bus.on('product.updated.v1' as never, ((p: { productId: string; changedFields: string[] }) => {
      if (wanted.has(p.productId)) seen.push({ productId: p.productId, changedFields: p.changedFields });
    }) as never);
    return { seen, stop: off };
  }

  interface Results {
    data: { results: Array<{ productId: string; status: string; reason?: string; changedFields?: string[] }> };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    b2c = await insertChannel('b2c', ['pl-PL', 'de-DE']);
    b2b = await insertChannel('b2b', ['pl-PL']);
    other = await insertChannel('other', ['pl-PL']);
  }, 60_000);

  afterAll(async () => {
    if (h) {
      for (const id of channels) {
        await conn().execute(`delete from sales_channel_products where sales_channel_id = ?`, [id]);
        await conn().execute(`delete from sales_channels where id = ?`, [id]);
      }
      await teardownBackendServer(h);
    }
  });

  describe('inline path', () => {
    it('changes only the chosen channel × language row on each product, one audit entry and one event each', async () => {
      const ids = await seedProducts(3, 'cl');
      // A row at another scope that must survive untouched.
      await conn().execute(
        `insert into product_channel_scopes (product_id, sales_channel_id, status, created_at, updated_at) values (?, ?, 'inactive', now(), now())`,
        [ids[0], b2b],
      );
      const events = capture(h.eventBus, ids);
      const res = await bulk(ids, { scopedStatus: { channelId: b2c, languageCode: 'de-de', value: 'inactive' } });
      events.stop();
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as Results).data.results).toEqual(
        ids.map((productId) => ({ productId, status: 'succeeded', changedFields: ['scopedStatus'] })),
      );
      for (const id of ids) {
        // Stored in the channel's spelling.
        expect(await languageStatus(id, b2c, 'de-DE')).toBe('inactive');
        expect(await languageStatus(id, b2c, 'pl-PL')).toBeUndefined();
        expect(await channelStatus(id, b2c)).toBeUndefined();
        const product = await h.em().fork().findOneOrFail(Product, { id });
        expect(product.status).toBe('active');
        expect(product.archivedAt ?? null).toBeNull();
        const audits = await scopeAudits(id);
        expect(audits).toHaveLength(1);
        expect(audits[0]!.state_after).toMatchObject({
          channels: [{ channelId: b2c, languageStatuses: [{ languageCode: 'de-DE', status: 'inactive' }] }],
        });
        expect(audits[0]!.state_before).toMatchObject({
          channels: [{ channelId: b2c, languageStatuses: [{ languageCode: 'de-DE', status: null }] }],
        });
        expect(events.seen.filter((e) => e.productId === id)).toEqual([{ productId: id, changedFields: ['scopedStatus'] }]);
      }
      expect(await channelStatus(ids[0]!, b2b)).toBe('inactive');
    });

    it('a channel-level value writes the channel row, and inherit removes it again (FR-012)', async () => {
      const ids = await seedProducts(2, 'ch');
      expect((await bulk(ids, { scopedStatus: { channelId: b2b, languageCode: null, value: 'inactive' } })).statusCode).toBe(200);
      for (const id of ids) expect(await channelStatus(id, b2b)).toBe('inactive');
      const res = await bulk(ids, { scopedStatus: { channelId: b2b, languageCode: null, value: 'inherit' } });
      expect(res.statusCode).toBe(200);
      for (const id of ids) expect(await channelStatus(id, b2b)).toBeUndefined();
    });

    it('a product already holding the value succeeds with changedFields [] and no audit entry', async () => {
      const [id] = await seedProducts(1, 'noop');
      expect((await bulk([id!], { scopedStatus: { channelId: b2b, languageCode: null, value: 'active' } })).statusCode).toBe(200);
      const res = await bulk([id!], { scopedStatus: { channelId: b2b, languageCode: null, value: 'active' } });
      expect((res.json() as Results).data.results).toEqual([{ productId: id, status: 'succeeded', changedFields: [] }]);
      expect(await scopeAudits(id!)).toHaveLength(1);
    });

    it('a non-member is skipped as scope_invalid and not added to the channel (US5 #3)', async () => {
      const [member] = await seedProducts(1, 'member', [other]);
      const [outsider] = await seedProducts(1, 'outsider', [b2c]);
      const res = await bulk([member!, outsider!], { scopedStatus: { channelId: other, languageCode: null, value: 'inactive' } });
      expect(res.statusCode).toBe(200);
      const results = (res.json() as Results).data.results;
      expect(results.find((r) => r.productId === member)).toMatchObject({ status: 'succeeded' });
      expect(results.find((r) => r.productId === outsider)).toMatchObject({ status: 'skipped', reason: 'scope_invalid' });
      expect(await isMember(outsider!, other)).toBe(false);
      expect(await channelStatus(outsider!, other)).toBeUndefined();
      expect(await scopeAudits(outsider!)).toHaveLength(0);
    });

    it('a language the channel does not offer is skipped as scope_invalid', async () => {
      const [id] = await seedProducts(1, 'lang');
      const res = await bulk([id!], { scopedStatus: { channelId: b2b, languageCode: 'de-DE', value: 'inactive' } });
      expect((res.json() as Results).data.results).toEqual([
        expect.objectContaining({ productId: id, status: 'skipped', reason: 'scope_invalid' }),
      ]);
      expect(await languageStatus(id!, b2b, 'de-DE')).toBeUndefined();
    });

    it('refuses scopedStatus beside status with 400 VALIDATION_FAILED on the scopedStatus path, writing nothing', async () => {
      const [id] = await seedProducts(1, 'mix');
      const res = await bulk([id!], { status: 'inactive', scopedStatus: { channelId: b2b, languageCode: null, value: 'inactive' } });
      expect(res.statusCode).toBe(400);
      const error = (res.json() as { error: { code: string; details?: Array<{ path?: unknown }> } }).error;
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(JSON.stringify(error.details)).toContain('scopedStatus');
      expect(await channelStatus(id!, b2b)).toBeUndefined();
      expect((await h.em().fork().findOneOrFail(Product, { id: id! })).status).toBe('active');
    });

    it.each(['draft', 'archived'])('refuses the value %s with 400 VALIDATION_FAILED (FR-053, FR-112)', async (value) => {
      const [id] = await seedProducts(1, `bad-${value}`);
      const res = await bulk([id!], { scopedStatus: { channelId: b2b, languageCode: null, value } });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('queued path and undo', () => {
    function chain() {
      const em = (): EntityManager => h.orm.em.fork();
      const events = new EventBus();
      const audit = h.auditLogService;
      const commandBus = new CommandBus(h.orm, audit, events);
      const membership = (h.container as unknown as { resolve<T>(n: string): T }).resolve<SalesChannelMembershipPort>(
        'salesChannelMembershipPort',
      );
      const catalogAdmin = new CatalogAdminService(em, events as CatalogEventBus, audit, membership, commandBus);
      const scopes = new ProductScopesService(em, membership, commandBus);
      const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, membership, audit, scopes);
      const bulkOps = new BulkOperationService(em, bulkUpdate, { events: events as CatalogEventBus }, commandBus);
      const run = <T>(fn: () => Promise<T>) => withSystemScope('163 bulk scoped status test — worker', fn);
      return { events, bulkOps, run };
    }

    it('queues above the threshold; the undo restores each scope row as a whole, reports a conflict and announces scopedStatus', async () => {
      const ids = await seedProducts(60, 'queued');
      // One product already holds an override at the scope: the undo must put it back, not delete it.
      await conn().execute(
        `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
         values (?, ?, 'de-DE', 'active', now(), now())`,
        [ids[1], b2c],
      );
      const res = await bulk(ids, { scopedStatus: { channelId: b2c, languageCode: 'de-DE', value: 'inactive' } });
      expect(res.statusCode).toBe(202);
      const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;

      const { events, bulkOps, run } = chain();
      await run(() => bulkOps.processById(opId));
      const op = await bulkOps.get(opId);
      expect(op?.status).toBe('completed');
      expect(op?.succeeded).toBe(60);
      expect(op?.reversible).toBe(true);
      expect(op?.touchedFields).toEqual(['scopedStatus']);
      for (const id of ids) expect(await languageStatus(id, b2c, 'de-DE')).toBe('inactive');
      // S-W2 — each product's entry names the admin who queued the operation, not a null actor.
      const actorRows = await conn().execute<Array<{ actor_admin_user_id: string | null }>>(
        `select distinct actor_admin_user_id from audit_log_entries
          where action = 'product.scopes.update' and object_id = any(?::text[])`,
        [`{${ids.join(',')}}`],
      );
      expect(actorRows.map((row) => row.actor_admin_user_id)).toEqual([op?.requestedByAdminUserId]);

      // Changed since the operation to a third state (neither its before, `null`, nor
      // its after, `inactive`): refused, never clobbered. Put back to `null` it would
      // count as already reverted.
      const changed = ids[0]!;
      expect(
        (await bulk([changed], { scopedStatus: { channelId: b2c, languageCode: 'de-DE', value: 'active' } })).statusCode,
      ).toBe(200);

      const seen = capture(events, ids);
      const undo = await run(() => bulkOps.undo(opId));
      seen.stop();
      expect(undo.ok).toBe(true);
      if (undo.ok) {
        expect(undo.conflicts).toEqual([{ recordId: changed, reason: 'changed_since_operation' }]);
        expect(undo.reverted).toHaveLength(59);
      }
      expect(await languageStatus(changed, b2c, 'de-DE')).toBe('active');
      expect(await languageStatus(ids[1]!, b2c, 'de-DE')).toBe('active');
      for (const id of ids.slice(2)) expect(await languageStatus(id, b2c, 'de-DE')).toBeUndefined();
      for (const id of ids.slice(1)) {
        expect(seen.seen.filter((e) => e.productId === id)).toEqual([{ productId: id, changedFields: ['scopedStatus'] }]);
        expect((await h.em().fork().findOneOrFail(Product, { id })).archivedAt ?? null).toBeNull();
      }
      expect(seen.seen.filter((e) => e.productId === changed)).toEqual([]);
    }, 120_000);

    it('a channel-row undo deletes a row the edit created and keeps the row’s other overrides', async () => {
      const ids = await seedProducts(60, 'chq');
      await conn().execute(
        `insert into product_channel_scopes (product_id, sales_channel_id, status, min_order_quantity, created_at, updated_at)
         values (?, ?, null, 5, now(), now())`,
        [ids[0], b2b],
      );
      const res = await bulk(ids, { scopedStatus: { channelId: b2b, languageCode: null, value: 'inactive' } });
      const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;
      const { bulkOps, run } = chain();
      await run(() => bulkOps.processById(opId));
      const undo = await run(() => bulkOps.undo(opId));
      expect(undo.ok && undo.conflicts).toEqual([]);
      expect(await channelStatus(ids[0]!, b2b)).toBeNull();
      const [kept] = await conn().execute<Array<{ min_order_quantity: number }>>(
        `select min_order_quantity from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
        [ids[0], b2b],
      );
      expect(kept?.min_order_quantity).toBe(5);
      for (const id of ids.slice(1)) expect(await channelStatus(id, b2b)).toBeUndefined();
    }, 120_000);

    it('1 000 products are undone in one action', async () => {
      const ids = await seedProducts(1000, 'k');
      const res = await bulk(ids, { scopedStatus: { channelId: b2b, languageCode: null, value: 'inactive' } });
      expect(res.statusCode).toBe(202);
      const opId = (res.json() as { data: { bulkOperationId: string } }).data.bulkOperationId;
      const { bulkOps, run } = chain();
      await run(() => bulkOps.processById(opId));
      expect((await bulkOps.get(opId))?.succeeded).toBe(1000);
      const undo = await run(() => bulkOps.undo(opId));
      expect(undo.ok).toBe(true);
      if (undo.ok) {
        expect(undo.reverted).toHaveLength(1000);
        expect(undo.undoStatus).toBe('reverted');
      }
      const [left] = await conn().execute<Array<{ n: string }>>(
        `select count(*)::text as n from product_channel_scopes where sales_channel_id = ? and product_id = any(?::uuid[])`,
        [b2b, `{${ids.join(',')}}`],
      );
      expect(Number(left?.n)).toBe(0);
    }, 600_000);
  });
});
