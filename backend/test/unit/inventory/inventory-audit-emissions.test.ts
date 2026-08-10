import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';
const adminCookie = { b2b_session: 'stub-admin-session' };

// Warehouses persist across test files (not in SEEDED_TABLES) so concurrent
// vitest workers can race on warehouse codes. Each test run derives a
// unique suffix to make creates collision-free.
const SUFFIX = Math.random().toString(36).slice(2, 8);

/**
 * Feature 024 / T029-T032 — inventory gap-fill audit emissions.
 *
 * Validates that warehouse create/update/deactivate/reactivate, stock-level
 * adjust, low-stock-threshold patch, and CSV bulk-import each land an
 * append-only row in `audit_log_entries` with the action token the
 * dashboard's allowlist expects, the right `objectType`, and a snapshot
 * containing the identity fields needed for `targetDisplayName`.
 */
describe('Inventory audit emissions', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes warehouse.create on POST /admin/warehouses', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/warehouses',
      payload: { name: 'Audit Warehouse Alpha', code: `wh-audit-alpha-${SUFFIX}` },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;

    const rows = await h.em().find(AuditLogEntry, { action: 'warehouse.create', objectId: id });
    expect(rows.length).toBe(1);
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['name']).toBe('Audit Warehouse Alpha');
    expect(after['code']).toBe(`wh-audit-alpha-${SUFFIX}`);
    expect(after['active']).toBe(true);
  });

  it('writes warehouse.update on a name change', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/warehouses',
      payload: { name: 'Audit Warehouse Beta', code: `wh-audit-beta-${SUFFIX}` },
      cookies: adminCookie,
    });
    const id = (create.json() as { data: { id: string } }).data.id;

    const update = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/warehouses/${id}`,
      payload: { name: 'Renamed Warehouse Beta' },
      cookies: adminCookie,
    });
    expect(update.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, { action: 'warehouse.update', objectId: id });
    expect(rows.length).toBe(1);
    const before = (rows[0]!.stateBefore ?? {}) as Record<string, unknown>;
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(before['name']).toBe('Audit Warehouse Beta');
    expect(after['name']).toBe('Renamed Warehouse Beta');
  });

  it('writes warehouse.deactivate / warehouse.reactivate on active-flip-only PATCH', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/warehouses',
      payload: { name: 'Audit Warehouse Gamma', code: `wh-audit-gamma-${SUFFIX}` },
      cookies: adminCookie,
    });
    const id = (create.json() as { data: { id: string } }).data.id;

    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/warehouses/${id}`,
      payload: { active: false },
      cookies: adminCookie,
    });
    const deactivateRows = await h
      .em()
      .find(AuditLogEntry, { action: 'warehouse.deactivate', objectId: id });
    expect(deactivateRows.length).toBe(1);

    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/warehouses/${id}`,
      payload: { active: true },
      cookies: adminCookie,
    });
    const reactivateRows = await h
      .em()
      .find(AuditLogEntry, { action: 'warehouse.reactivate', objectId: id });
    expect(reactivateRows.length).toBe(1);
  });

  it('writes stock_level.adjust on PUT /admin/inventory/levels with a real delta', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory/levels',
      payload: {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        onHand: 77,
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const after = (rows[rows.length - 1]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['productId']).toBe(SEED_PRODUCT_101_ID);
    expect(after['warehouseId']).toBe(DEFAULT_WAREHOUSE_ID);
    expect(after['onHand']).toBe(77);
    expect(after['productSku']).toBeTruthy();
    expect(after['warehouseCode']).toBeTruthy();
  });

  it('writes low_stock_threshold.update on PATCH /admin/inventory/thresholds', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/inventory/thresholds',
      payload: { global: { high: 200, medium: 50, low: 5 } },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, { action: 'low_stock_threshold.update' });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const after = (rows[rows.length - 1]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['global']).toBeTruthy();
  });

  it('writes a SINGLE stock_level.bulk_import row per CSV import (never per row)', async () => {
    // Trigger with a 2-line CSV; assert exactly one audit row is written.
    const csv = ['sku,onHand', 'EXAMPLE-SIMPLE-001,5', 'EXAMPLE-BLUE-002,7'].join('\n');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/inventory/import',
      payload: { csv, warehouseId: DEFAULT_WAREHOUSE_ID },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    const rows = await h.em().find(AuditLogEntry, { action: 'stock_level.bulk_import' });
    expect(rows.length).toBe(1);
    const after = (rows[0]!.stateAfter ?? {}) as Record<string, unknown>;
    expect(after['rowsProcessed']).toBe(2);
    expect(after['warehouseId']).toBe(DEFAULT_WAREHOUSE_ID);
    expect(rows[0]!.objectType).toBe('bulk_operation');
  });
});
