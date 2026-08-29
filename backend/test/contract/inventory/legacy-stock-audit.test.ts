import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { CatalogCategoryReadPort, CatalogProductReadPort } from '@endora-commerce/contracts';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { StockLevel } from '../../helpers/package-entities.js';
import {
  StockLevelService,
  type InventoryAdjustedEvent,
} from '../../../../packages/modules/inventory/src/backend/services/stock-level-service.js';

/**
 * Issue #122 — the legacy single-bucket stock write audits like the other one.
 * Issue #139 (ruling D-66 part 2) — and it now delegates to
 * `StockLevelService.setOnHand` rather than writing through the EntityManager.
 *
 * `PUT /api/v1/admin/inventory` is foundation 001's backward-compatible stock
 * setter. The audited path for a stock change has been `StockLevelService`
 * (`stock_level.adjust`) since feature 024, and this endpoint wrote straight
 * through the EntityManager instead, recording nothing — invisible to
 * `check-command-coverage`, which never opened a `routes*.ts` file.
 *
 * The same hand-rolled write skipped two more things the service does, which is
 * the live defect D-66 repairs: it emitted no `inventory.adjusted.v1`, the one
 * event behind the back-in-stock fan-out (US6) and the low-stock crossing alert
 * (US4), and it validated neither the product nor the warehouse, so a typo'd
 * product id silently created a stock row for a product that does not exist.
 *
 * `admin-stock.test.ts` claims this surface is "covered by `legacy-stock.test.ts`".
 * That file has never existed.
 */
const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

describe('legacy admin stock write (issues #122, #139)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const put = (onHand: number) =>
    h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { productId: SEED_PRODUCT_101_ID, onHand },
    });

  it('records a stock_level.adjust entry carrying the delta', async () => {
    const first = await put(41);
    expect(first.statusCode).toBe(200);
    const second = await put(77);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { onHand: number } }).data.onHand).toBe(77);

    const entries = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const last = entries.at(-1)!;
    expect((last.stateBefore as { onHand?: number } | null)?.onHand).toBe(41);
    expect((last.stateAfter as { onHand?: number; delta?: number } | null)?.onHand).toBe(77);
    expect((last.stateAfter as { delta?: number } | null)?.delta).toBe(36);
  });

  it('writes no audit row when the value does not change', async () => {
    await put(77);
    const before = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    await put(77);
    const after = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    // "no write ⇒ no audit row", the same rule `CommandOutcome.skipAudit` keeps.
    expect(after.length).toBe(before.length);
  });

  // -------------------------------------------------------------------------
  // Issue #139 / D-66 part 2 — the route delegates to `StockLevelService`.
  // -------------------------------------------------------------------------

  /** The bus dispatches outside a request scope, so a handler may still be pending. */
  const waitForEvents = async (
    seen: InventoryAdjustedEvent[],
    atLeast: number,
  ): Promise<void> => {
    for (let i = 0; i < 50 && seen.length < atLeast; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('emits inventory.adjusted.v1 so restock and low-stock fan-out can react', async () => {
    const seen: InventoryAdjustedEvent[] = [];
    const off = h.eventBus.on('inventory.adjusted.v1', (payload) => {
      seen.push(payload as unknown as InventoryAdjustedEvent);
    });
    try {
      await put(5);
      await waitForEvents(seen, 1);
      seen.length = 0;

      const res = await put(0);
      expect(res.statusCode).toBe(200);
      await waitForEvents(seen, 1);
    } finally {
      off();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      productId: SEED_PRODUCT_101_ID,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
      before: 5,
      after: 0,
    });
  });

  it('emits nothing when the write is a no-op', async () => {
    const seen: InventoryAdjustedEvent[] = [];
    const off = h.eventBus.on('inventory.adjusted.v1', (payload) => {
      seen.push(payload as unknown as InventoryAdjustedEvent);
    });
    try {
      // Subscribed before the setup write, not after it: `dispatch` iterates the
      // live handler array with an `await` between entries, so a handler added
      // while an earlier emission is still draining is still called by it.
      await put(9);
      await waitForEvents(seen, 1);
      seen.length = 0;

      const res = await put(9);
      expect(res.statusCode).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      off();
    }

    expect(seen).toHaveLength(0);
  });

  it('404s an unknown product instead of creating a stock row for it', async () => {
    const ghostProductId = '00000000-0000-4000-8000-0000000f0139';

    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { productId: ghostProductId, onHand: 12 },
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error?: { code?: string } }).error?.code).toBe('PRODUCT_NOT_FOUND');

    const rows = await h.em().find(StockLevel, { productId: ghostProductId });
    expect(rows).toHaveLength(0);
  });

  /**
   * The route hard-codes the seeded Default warehouse, so its own body cannot
   * carry an unknown one — the warehouse check it gained is the delegate's.
   * Asserted directly on `StockLevelService` for that reason.
   */
  it('refuses an unknown warehouse at the delegate it now calls', async () => {
    // Feature 075, Phase C — the service reads `catalog` through its published
    // ports, so this resolves the container's registrations rather than
    // becoming a second reader of the same rows.
    const cradle = h.container.cradle as never as {
      catalogProductReadPort: CatalogProductReadPort;
      catalogCategoryReadPort: CatalogCategoryReadPort;
    };
    const service = new StockLevelService(
      () => h.em(),
      cradle.catalogProductReadPort,
      cradle.catalogCategoryReadPort,
      h.eventBus,
    );
    const ghostWarehouseId = '00000000-0000-4000-8000-0000000f0140';

    await expect(
      service.setOnHand({
        productId: SEED_PRODUCT_101_ID,
        warehouseId: ghostWarehouseId,
        onHand: 3,
      }),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_NOT_FOUND' });

    const rows = await h.em().find(StockLevel, { warehouseId: ghostWarehouseId });
    expect(rows).toHaveLength(0);
  });
});
