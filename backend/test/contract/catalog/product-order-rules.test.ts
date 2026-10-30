import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

import { ERROR_CODES } from '@endora-commerce/contracts';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import { Order, OrderItem, Product } from '../../helpers/package-entities.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 155, Phase 5 (T028) — the catalogue writes of the order rules
 * (`specs/155-catalog-order-constraints/contracts/catalog-api.md` §1–§2).
 *
 *  - `PATCH /api/v1/admin/catalog/products/:id` sets and clears
 *    `minOrderQuantity`, refuses an out-of-range value at the route (400) and a
 *    non-null value on an ineligible type in the service (422, D5);
 *  - `POST /api/v1/admin/catalog/products` applies the same type rule;
 *  - `returnable` is writable on every type and `false` on a product nobody set;
 *  - the Command's audit row carries both keys (FR-005);
 *  - the bulk edit's "set returnable" writes one `product.update` audit row per
 *    product with the old and new value, on the synchronous and the queued
 *    path, and the queued path's undo restores the flag (FR-003, analyze F3);
 *  - documents already holding the product are untouched by the change
 *    (FR-005, analyze F9).
 */
describe('155 — catalogue writes of minOrderQuantity and returnable [contract]', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createProduct(
    suffix: string,
    type: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual' = 'simple',
    extra: Record<string, unknown> = {},
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `MOQ-${RUN}-${suffix}`,
        type,
        name: { 'en-US': `Order rules ${RUN} ${suffix}` },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        ...(type === 'virtual' ? { downloadUrl: 'https://files.example.com/x.pdf' } : {}),
        ...extra,
      },
      cookies: adminCookie,
    });
    return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
  }

  async function createdId(suffix: string, type?: Parameters<typeof createProduct>[1]): Promise<string> {
    const res = await createProduct(suffix, type);
    expect(res.statusCode).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  }

  function patch(id: string, payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload,
      cookies: adminCookie,
    });
  }

  async function adminGet(id: string): Promise<{ minOrderQuantity: unknown; returnable: unknown }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { minOrderQuantity: unknown; returnable: unknown } }).data;
  }

  describe('PATCH minOrderQuantity', () => {
    it('sets and clears the minimum, and the admin read carries it', async () => {
      const id = await createdId('set-clear');

      const set = await patch(id, { minOrderQuantity: 12 });
      expect(set.statusCode).toBe(200);
      expect((set.json() as { data: { minOrderQuantity: unknown } }).data.minOrderQuantity).toBe(12);
      expect((await adminGet(id)).minOrderQuantity).toBe(12);

      const cleared = await patch(id, { minOrderQuantity: null });
      expect(cleared.statusCode).toBe(200);
      expect((await adminGet(id)).minOrderQuantity).toBeNull();
    });

    it('accepts both ends of the range on a configurable product', async () => {
      const id = await createdId('range-ends', 'configurable');
      expect((await patch(id, { minOrderQuantity: 1 })).statusCode).toBe(200);
      expect((await patch(id, { minOrderQuantity: 1_000_000 })).statusCode).toBe(200);
      expect((await adminGet(id)).minOrderQuantity).toBe(1_000_000);
    });

    it.each([0, 1.5, 1_000_001, -1])('refuses %s at the route with 400 VALIDATION_FAILED [F5]', async (value) => {
      const id = await createdId(`out-of-range-${String(value).replace('.', '_')}`);
      const res = await patch(id, { minOrderQuantity: value });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((await adminGet(id)).minOrderQuantity).toBeNull();
    });

    it.each(['bundle', 'grouped', 'virtual'] as const)(
      'refuses a non-null minimum on a %s product with 422 VALIDATION_FAILED naming the field [D5]',
      async (type) => {
        const id = await createdId(`ineligible-${type}`, type);
        const res = await patch(id, { minOrderQuantity: 5 });
        expect(res.statusCode).toBe(422);
        const body = res.json() as { error: { code: string; details?: { field?: string } } };
        expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
        expect(body.error.details?.field).toBe('minOrderQuantity');
        expect((await adminGet(id)).minOrderQuantity).toBeNull();
        // Clearing is always allowed — it is how a stored value is removed.
        expect((await patch(id, { minOrderQuantity: null })).statusCode).toBe(200);
      },
    );
  });

  describe('POST create', () => {
    it('creates a simple product with a minimum and the flag', async () => {
      const res = await createProduct('create-with-rules', 'simple', {
        minOrderQuantity: 6,
        returnable: true,
      });
      expect(res.statusCode).toBe(201);
      const data = (res.body as { data: { id: string; minOrderQuantity: unknown; returnable: unknown } }).data;
      expect(data.minOrderQuantity).toBe(6);
      expect(data.returnable).toBe(true);
      const read = await adminGet(data.id);
      expect(read.minOrderQuantity).toBe(6);
      expect(read.returnable).toBe(true);
    });

    it('refuses a non-null minimum on a bundle with 422 VALIDATION_FAILED naming the field [D5, analyze F14]', async () => {
      const sku = `MOQ-${RUN}-create-bundle-min`;
      const res = await createProduct('create-bundle-min', 'bundle', { minOrderQuantity: 4 });
      expect(res.statusCode).toBe(422);
      const body = res.body as { error: { code: string; details?: { field?: string } } };
      expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(body.error.details?.field).toBe('minOrderQuantity');
      expect(await h.em().findOne(Product, { sku })).toBeNull();
    });

    it('refuses an out-of-range minimum at the route with 400', async () => {
      const res = await createProduct('create-range', 'simple', { minOrderQuantity: 1_000_001 });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('returnable', () => {
    it.each(['simple', 'configurable', 'grouped', 'bundle', 'virtual'] as const)(
      'is settable on a %s product',
      async (type) => {
        const id = await createdId(`returnable-${type}`, type);
        expect((await adminGet(id)).returnable).toBe(false);
        const res = await patch(id, { returnable: true });
        expect(res.statusCode).toBe(200);
        expect((res.json() as { data: { returnable: unknown } }).data.returnable).toBe(true);
        expect((await adminGet(id)).returnable).toBe(true);
      },
    );

    it('reads false on a pre-existing product nobody set it on (US5 #3)', async () => {
      const read = await adminGet(SEED_PRODUCT_101_ID);
      expect(read.returnable).toBe(false);
      expect(read.minOrderQuantity).toBeNull();
    });
  });

  describe('audit (FR-005)', () => {
    it("the Command's before/after carry both keys", async () => {
      const id = await createdId('audit-command');
      const res = await patch(id, { minOrderQuantity: 24, returnable: true });
      expect(res.statusCode).toBe(200);

      const rows = await h.em().find(AuditLogEntry, { action: 'product.update', objectId: id });
      expect(rows).toHaveLength(1);
      const before = (rows[0]!.stateBefore ?? {}) as Record<string, unknown>;
      const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
      expect(before).toMatchObject({ minOrderQuantity: null, returnable: false });
      expect(after).toMatchObject({ minOrderQuantity: 24, returnable: true });
      expect(after['changedFields']).toEqual(expect.arrayContaining(['minOrderQuantity', 'returnable']));
    });

    it("the create Command's after carries both keys", async () => {
      const res = await createProduct('audit-create', 'simple', { minOrderQuantity: 3, returnable: true });
      expect(res.statusCode).toBe(201);
      const id = (res.body as { data: { id: string } }).data.id;
      const rows = await h.em().find(AuditLogEntry, { action: 'product.create', objectId: id });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.stateAfter).toMatchObject({ minOrderQuantity: 3, returnable: true });
    });
  });

  describe('bulk "set returnable" (FR-003, US5 #4, SC-005)', () => {
    async function seedProducts(count: number, label: string): Promise<string[]> {
      const em = h.em();
      const ids: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const sku = `MOQ-${RUN}-${label}-${i}`;
        const p = em.create(Product, {
          sku,
          slug: sku.toLowerCase(),
          type: 'simple',
          status: 'active',
          name: `Bulk returnable ${sku}`,
          description: '',
          visibility: 'public',
          allowedOrganizationIds: [],
          attributeValues: {},
        });
        em.persist(p);
        ids.push(p.id);
      }
      await em.flush();
      return ids;
    }

    async function returnableOf(ids: string[]): Promise<boolean[]> {
      const rows = await h.em().find(Product, { id: { $in: ids } });
      const byId = new Map(rows.map((r) => [r.id, r.returnable]));
      return ids.map((id) => byId.get(id)!);
    }

    function assertPerProductAudit(rows: AuditLogEntry[], ids: string[], actor?: string): void {
      const byObject = new Map<string, AuditLogEntry[]>();
      for (const row of rows) {
        byObject.set(row.objectId, [...(byObject.get(row.objectId) ?? []), row]);
      }
      for (const id of ids) {
        const own = byObject.get(id) ?? [];
        expect(own, `one product.update row for ${id}`).toHaveLength(1);
        const row = own[0]!;
        expect((row.stateBefore as Record<string, unknown>)['returnable']).toBe(false);
        expect((row.stateAfter as Record<string, unknown>)['returnable']).toBe(true);
        expect((row.stateAfter as Record<string, unknown>)['changedFields']).toContain('returnable');
        if (actor !== undefined) expect(row.actorAdminUserId).toBe(actor);
      }
    }

    it('synchronous path: every product changed, one audited row per product plus the summary', async () => {
      const ids = await seedProducts(20, 'bulk-sync');
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/bulk-update',
        payload: { productIds: ids, fields: { returnable: true } },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(200);
      const data = (
        res.json() as {
          data: {
            bulkOperationId: string;
            summary: { succeeded: number; total: number };
            results: Array<{ productId: string; status: string; changedFields?: string[] }>;
          };
        }
      ).data;
      expect(data.summary).toMatchObject({ succeeded: 20, total: 20 });
      for (const r of data.results) {
        expect(r.status).toBe('succeeded');
        expect(r.changedFields).toContain('returnable');
      }
      expect(await returnableOf(ids)).toEqual(ids.map(() => true));

      const rows = await h.em().find(AuditLogEntry, { action: 'product.update', objectId: { $in: ids } });
      assertPerProductAudit(rows, ids);
      const summary = await h
        .em()
        .find(AuditLogEntry, { action: 'product.bulk_update', objectId: data.bulkOperationId });
      expect(summary).toHaveLength(1);
      expect((summary[0]!.stateAfter as { touchedFields: string[] }).touchedFields).toEqual(['returnable']);
    });

    it('queued path: 200 products in one request, one audited row per product, undo restores the flag', async () => {
      const ids = await seedProducts(200, 'bulk-queued');
      const startedAt = new Date();
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products/bulk-update',
        payload: { productIds: ids, fields: { returnable: true } },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(202);
      const opId = (res.json() as { data: { bulkOperationId: string; total: number } }).data.bulkOperationId;

      // The queued worker does not run in the harness; process the operation
      // with the same service chain the worker composes (bulk-undo.test.ts).
      const em = (): EntityManager => h.orm.em.fork();
      const events = new EventBus();
      const audit = h.auditLogService;
      const commandBus = new CommandBus(h.orm, audit, events);
      const catalogAdmin = new CatalogAdminService(em, events as CatalogEventBus, audit);
      const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
      const bulkOps = new BulkOperationService(em, bulkUpdate, {}, commandBus);
      await bulkOps.processById(opId);

      const op = await bulkOps.get(opId);
      expect(op?.status).toBe('completed');
      expect(op?.succeeded).toBe(200);
      expect(await returnableOf(ids)).toEqual(ids.map(() => true));

      const rows = await h.em().find(AuditLogEntry, { action: 'product.update', objectId: { $in: ids } });
      assertPerProductAudit(rows, ids, op!.requestedByAdminUserId);

      const summaries = (
        await h.em().find(AuditLogEntry, { action: 'product.bulk_update', actedAt: { $gte: startedAt } })
      ).filter((row) => ((row.stateAfter as { selectionIds?: string[] }).selectionIds ?? []).includes(ids[0]!));
      expect(summaries).toHaveLength(1);
      const outcomes = (summaries[0]!.stateAfter as {
        perProductOutcomes: Array<{ productId: string; changedFields?: string[] }>;
      }).perProductOutcomes;
      expect(outcomes).toHaveLength(200);
      for (const outcome of outcomes) expect(outcome.changedFields).toContain('returnable');

      const undo = await bulkOps.undo(opId);
      expect(undo.ok).toBe(true);
      expect(await returnableOf(ids)).toEqual(ids.map(() => false));
    }, 120_000);
  });

  describe('existing documents are untouched (FR-005, analyze F9)', () => {
    const seeded: Array<{ table: string; id: string }> = [];

    async function snapshot(em: EntityManager): Promise<unknown[]> {
      const out: unknown[] = [];
      for (const { table, id } of seeded) {
        const rows = await em.execute<Array<{ row: unknown }>>(
          `select to_jsonb(t) as row from "${table}" t where t."id" = ?`,
          [id],
        );
        expect(rows, `${table} ${id} seeded`).toHaveLength(1);
        out.push(rows[0]!.row);
      }
      return out;
    }

    afterAll(async () => {
      const em = h.em();
      for (const { table, id } of [...seeded].reverse()) {
        await em.execute(`delete from "${table}" where "id" = ?`, [id]);
      }
    });

    it('a cart line, an order line, a quote-request line and a return-case line keep every byte', async () => {
      const productId = await createdId('documents');
      const em = h.em();
      const channelId = await systemDefaultSalesChannelId(em);

      const cartId = randomUUID();
      const cartItemId = randomUUID();
      await em.execute(
        `insert into "carts" ("id", "anonymous_cart_token", "created_at", "updated_at") values (?, ?, now(), now())`,
        [cartId, `148-p5-${cartId}`],
      );
      await em.execute(
        `insert into "cart_items" ("id", "cart_id", "product_id", "quantity", "unit_price", "currency", "created_at", "updated_at")
         values (?, ?, ?, 3, 10, 'PLN', now(), now())`,
        [cartItemId, cartId, productId],
      );
      seeded.push({ table: 'carts', id: cartId }, { table: 'cart_items', id: cartItemId });

      const quoteId = randomUUID();
      const quoteItemId = randomUUID();
      await em.execute(
        `insert into "quote_requests" ("id", "organization_id", "customer_account_id", "status", "created_at", "updated_at", "business_id")
         values (?, ?, ?, 'Pending', now(), now(), ?)`,
        [quoteId, TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID, `148-P5-${quoteId}`],
      );
      await em.execute(
        `insert into "quote_request_items" ("id", "quote_request_id", "product_id", "product_name", "quantity", "line_currency", "created_at", "updated_at")
         values (?, ?, ?, '148 product', 2, 'PLN', now(), now())`,
        [quoteItemId, quoteId, productId],
      );
      seeded.push({ table: 'quote_requests', id: quoteId }, { table: 'quote_request_items', id: quoteItemId });

      const order = em.create(Order, {
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        status: 'completed',
        deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '30.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '30.00',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persistAndFlush(order);
      const orderItem = em.create(OrderItem, {
        orderId: order.id,
        productId,
        productSnapshot: { sku: `MOQ-${RUN}-documents`, name: 'Order rules', primaryAssetUrl: null },
        quantity: 3,
        unitPrice: '10.00',
        taxRate: '0.0000',
        lineTotal: '30.00',
      });
      await em.persistAndFlush(orderItem);
      seeded.push({ table: 'orders', id: order.id }, { table: 'order_items', id: orderItem.id });

      const caseId = randomUUID();
      const caseItemId = randomUUID();
      await em.execute(
        `insert into "return_cases" ("id", "kind", "order_id", "sales_channel_id", "customer_account_id", "organization_id", "status_code", "currency", "submitted_at", "created_at", "updated_at")
         values (?, 'return', ?, ?, ?, ?, 'new', 'PLN', now(), now(), now())`,
        [caseId, order.id, channelId, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID],
      );
      await em.execute(
        `insert into "return_case_items" ("id", "return_case_id", "order_item_id", "product_id", "product_name", "quantity", "default_refund_amount")
         values (?, ?, ?, ?, '148 product', 1, 10)`,
        [caseItemId, caseId, orderItem.id, productId],
      );
      seeded.push({ table: 'return_cases', id: caseId }, { table: 'return_case_items', id: caseItemId });

      const before = await snapshot(h.em());

      expect((await patch(productId, { minOrderQuantity: 50, returnable: true })).statusCode).toBe(200);
      expect((await patch(productId, { minOrderQuantity: null, returnable: false })).statusCode).toBe(200);
      expect((await patch(productId, { minOrderQuantity: 7 })).statusCode).toBe(200);

      expect(await snapshot(h.em())).toEqual(before);
    });
  });
});
