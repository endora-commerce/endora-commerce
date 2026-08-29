import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
} from '../../helpers/seed-catalog.js';
import { Product } from '../../helpers/package-entities.js';

/**
 * Feature 024 / T005-T008 — Integration tests against a real PostgreSQL
 * database for the dashboard's curated `/recent-activity` read path.
 *
 * Each `describe` block seeds the audit log directly via the public
 * `AuditLogService.record(...)` interface so the test exercises the read
 * path end-to-end without depending on every gap-fill (US2) emission
 * already being wired into other modules.
 */

describe('recent-activity — happy path (admin actor + product target)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.auditLogService.record({
      actorAdminUserId: '00000000-0000-4000-8000-0000000000b1',
      action: 'product.update',
      objectType: 'product',
      objectId: SEED_PRODUCT_101_ID,
      stateBefore: { name: { 'en-US': 'old name' } },
      stateAfter: { name: { 'en-US': 'Example simple product' } },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('resolves the admin actor display name and the product target details', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{
        action: string;
        actorDisplayName: string;
        actorKind: string;
        targetDisplayName: string;
        targetUrl: string | null;
        module: string;
      }>;
    };
    const row = body.data.find((r) => r.action === 'product.update');
    expect(row).toBeDefined();
    expect(row!.module).toBe('catalog');
    expect(row!.actorKind).toBe('admin');
    // Seeded admin "Plat Admin" — first name + last initial.
    expect(row!.actorDisplayName).toBe('Plat A.');
    // Live product lookup resolves the display name.
    expect(row!.targetDisplayName).toBe('Example simple product');
    expect(row!.targetUrl).toBe(`/catalog/products/${SEED_PRODUCT_101_ID}`);
  });
});

describe('recent-activity — deleted target falls back to snapshot label and disables click', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.auditLogService.record({
      actorAdminUserId: '00000000-0000-4000-8000-0000000000b1',
      action: 'product.update',
      objectType: 'product',
      objectId: SEED_PRODUCT_102_ID,
      stateAfter: { name: { 'en-US': 'Snapshot-only name' }, sku: 'GONE-SKU' },
    });
    // Hard-delete the product so the live lookup returns nothing.
    await h.em().nativeDelete(Product, { id: SEED_PRODUCT_102_ID });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('shows the snapshot label and a null targetUrl', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as {
      data: Array<{ targetId: string; targetDisplayName: string; targetUrl: string | null }>;
    };
    const row = body.data.find((r) => r.targetId === SEED_PRODUCT_102_ID);
    expect(row).toBeDefined();
    expect(row!.targetDisplayName).toBe('Snapshot-only name');
    expect(row!.targetUrl).toBeNull();
  });
});

describe('recent-activity — system actor renders as "System"', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.auditLogService.record({
      actorAdminUserId: null,
      action: 'product.update',
      objectType: 'product',
      objectId: SEED_PRODUCT_101_ID,
      stateAfter: { name: { 'en-US': 'Example simple product' } },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('uses "System" as the actor label and reports actorKind=system', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as {
      data: Array<{ actorDisplayName: string; actorKind: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    const systemRow = body.data.find((r) => r.actorKind === 'system');
    expect(systemRow).toBeDefined();
    expect(systemRow!.actorDisplayName).toBe('System');
  });
});

describe('recent-activity — impersonation context surfaces in the actor label', () => {
  let h: BackendServerHandle;
  const customerId = '00000000-0000-4000-8000-0000000000c1';

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.auditLogService.record({
      actorAdminUserId: '00000000-0000-4000-8000-0000000000b1',
      impersonatedCustomerAccountId: customerId,
      action: 'product.update',
      objectType: 'product',
      objectId: SEED_PRODUCT_101_ID,
      stateAfter: { name: { 'en-US': 'Example simple product' } },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('appends "(as <customer>)" to the admin display name', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log/recent-activity',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = res.json() as { data: Array<{ actorDisplayName: string; actorKind: string }> };
    const impersonated = body.data.find((r) => r.actorDisplayName.includes('(as '));
    expect(impersonated).toBeDefined();
    expect(impersonated!.actorKind).toBe('admin');
    // Customer was not seeded with an organization → falls back to ID
    // (or email if any seed inserts one) — we only assert the wrapping
    // and that the admin name is preserved.
    expect(impersonated!.actorDisplayName.startsWith('Plat A.')).toBe(true);
  });
});
