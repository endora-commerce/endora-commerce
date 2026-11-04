import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminRole,
  AdminUser,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES, OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestCustomer } from '../../helpers/seed-organizations.js';
import { createImportProfile } from '../../helpers/import-profile.js';

/**
 * Each import/export entity is gated by the code that protects the same rows on
 * the route that owns them: customers by `customers:read`, orders by
 * `orders:read`, stock by `inventory:read` (export) and `inventory:write`
 * (import), products and categories by `catalog:read` (export) and
 * `catalog:write` (import). The entity listing offers a caller only what those
 * codes let them use, and a scoped sales representative exports only the rows
 * of the organizations assigned to them — the same answer the owning lists give.
 */

const HEADER_ONLY_STOCK_CSV = 'product_sku,variant_id,on_hand\n';
const HEADER_ONLY_PRODUCTS_CSV = 'sku,status,visibility,name,description\n';

describe('import_export — per-entity permissions [integration]', () => {
  let h: BackendServerHandle;
  const suffix = Date.now().toString(36);
  const cookies = {
    catalogOnly: `stub-ie-catalog-only-${suffix}`,
    catalogReader: `stub-ie-catalog-reader-${suffix}`,
    customersOrdersStock: `stub-ie-customers-orders-stock-${suffix}`,
    unrelated: `stub-ie-unrelated-${suffix}`,
    scopedRep: `stub-ie-scoped-rep-${suffix}`,
  };
  let salesRepRole: AdminRole;
  // Feature 172 — a products import runs with a profile.
  let profileId = '';
  let salesRepOriginalPermissions: string[] = [];

  async function adminWithRole(
    code: string,
    permissions: string[],
    cookie: string,
  ): Promise<void> {
    const em = h.em();
    const role = em.create(AdminRole, { code, name: code, permissions });
    await em.persistAndFlush(role);
    const admin = em.create(AdminUser, {
      email: `${code}@import-export.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Import',
      lastName: 'Export',
    });
    await em.persistAndFlush(admin);
    ADMIN_COOKIES[cookie] = { adminUserId: admin.id };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    profileId = await createImportProfile(h);
    await adminWithRole(`ie_catalog_only_${suffix}`, ['catalog:read', 'catalog:write'], cookies.catalogOnly);
    await adminWithRole(`ie_catalog_reader_${suffix}`, ['catalog:read'], cookies.catalogReader);
    await adminWithRole(
      `ie_customers_orders_stock_${suffix}`,
      ['customers:read', 'orders:read', 'inventory:read', 'inventory:write'],
      cookies.customersOrdersStock,
    );
    await adminWithRole(`ie_unrelated_${suffix}`, ['settings:read'], cookies.unrelated);

    // A scoped sales representative: the tenant scope is decided by the role
    // code, so the shared `sales_representative` role is given the two read
    // codes for the duration of this file and restored afterwards.
    const em = h.em();
    await seedOtherTestCustomer(em);
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: [],
      });
      await em.persistAndFlush(role);
    }
    salesRepRole = role;
    salesRepOriginalPermissions = [...role.permissions];
    role.permissions = [
      ...new Set([...role.permissions, 'customers:read', 'orders:read']),
    ];
    const rep = em.create(AdminUser, {
      email: `ie-scoped-rep-${suffix}@import-export.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Scoped',
      lastName: 'Rep',
    });
    await em.persistAndFlush([role, rep]);
    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: OTHER_TEST_ORGANIZATION_ID,
        adminUserId: rep.id,
      }),
    );
    ADMIN_COOKIES[cookies.scopedRep] = { adminUserId: rep.id };
  }, 120_000);

  afterAll(async () => {
    for (const cookie of Object.values(cookies)) delete ADMIN_COOKIES[cookie];
    if (salesRepRole) {
      const em = h.em();
      const role = await em.findOne(AdminRole, { id: salesRepRole.id });
      if (role) {
        role.permissions = salesRepOriginalPermissions;
        await em.persistAndFlush(role);
      }
    }
    await teardownBackendServer(h);
  });

  function get(url: string, cookie: string) {
    return h.app.inject({ method: 'GET', url, cookies: { b2b_session: cookie } });
  }

  function postCsv(url: string, cookie: string, payload: string) {
    return h.app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'text/csv' },
      cookies: { b2b_session: cookie },
      payload,
    });
  }

  type ListedEntity = { name: string; canExport: boolean; canImport: boolean };

  async function listed(cookie: string): Promise<ListedEntity[]> {
    const res = await get('/api/v1/admin/import-export/entities', cookie);
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { entities: ListedEntity[] } }).data.entities;
  }

  describe('a catalogue-only administrator', () => {
    it('is refused the customers and orders exports', async () => {
      expect((await get('/api/v1/admin/export/customers.csv', cookies.catalogOnly)).statusCode).toBe(403);
      expect((await get('/api/v1/admin/export/orders.csv', cookies.catalogOnly)).statusCode).toBe(403);
    });

    it('is refused the stock export and the stock import', async () => {
      expect((await get('/api/v1/admin/export/stock.csv', cookies.catalogOnly)).statusCode).toBe(403);
      const res = await postCsv('/api/v1/admin/import/stock', cookies.catalogOnly, HEADER_ONLY_STOCK_CSV);
      expect(res.statusCode).toBe(403);
    });

    it('is refused an import of an export-only entity it may not read', async () => {
      const res = await postCsv('/api/v1/admin/import/orders', cookies.catalogOnly, 'id\n');
      expect(res.statusCode).toBe(403);
    });

    it('keeps the products and categories exports and the products import', async () => {
      expect((await get('/api/v1/admin/export/products.csv', cookies.catalogOnly)).statusCode).toBe(200);
      expect((await get('/api/v1/admin/export/categories.csv', cookies.catalogOnly)).statusCode).toBe(200);
      const res = await postCsv(
        `/api/v1/admin/import/products?profileId=${profileId}`,
        cookies.catalogOnly,
        HEADER_ONLY_PRODUCTS_CSV,
      );
      expect(res.statusCode).toBe(200);
    });

    it('is offered only the products and categories entities', async () => {
      const entities = await listed(cookies.catalogOnly);
      expect(entities.map((e) => e.name).sort()).toEqual(['categories', 'products']);
      for (const entity of entities) {
        expect(entity).toMatchObject({ canExport: true, canImport: true });
      }
    });
  });

  describe('a catalogue reader without the write code', () => {
    it('may export products but not import them', async () => {
      expect((await get('/api/v1/admin/export/products.csv', cookies.catalogReader)).statusCode).toBe(200);
      const res = await postCsv(
        `/api/v1/admin/import/products?profileId=${profileId}`,
        cookies.catalogReader,
        HEADER_ONLY_PRODUCTS_CSV,
      );
      expect(res.statusCode).toBe(403);
    });

    it('is offered the catalogue entities as export-only', async () => {
      const entities = await listed(cookies.catalogReader);
      expect(entities.map((e) => e.name).sort()).toEqual(['categories', 'products']);
      for (const entity of entities) {
        expect(entity).toMatchObject({ canExport: true, canImport: false });
      }
    });
  });

  describe('an administrator holding the owning modules’ codes', () => {
    it('exports customers, orders and stock', async () => {
      for (const entity of ['customers', 'orders', 'stock']) {
        const res = await get(`/api/v1/admin/export/${entity}.csv`, cookies.customersOrdersStock);
        expect(res.statusCode, entity).toBe(200);
      }
    });

    it('imports stock', async () => {
      const res = await postCsv(
        '/api/v1/admin/import/stock',
        cookies.customersOrdersStock,
        HEADER_ONLY_STOCK_CSV,
      );
      expect(res.statusCode).toBe(200);
    });

    it('is refused the catalogue entities', async () => {
      expect((await get('/api/v1/admin/export/products.csv', cookies.customersOrdersStock)).statusCode).toBe(403);
      const res = await postCsv(
        `/api/v1/admin/import/products?profileId=${profileId}`,
        cookies.customersOrdersStock,
        HEADER_ONLY_PRODUCTS_CSV,
      );
      expect(res.statusCode).toBe(403);
    });

    it('is offered customers, orders and stock only', async () => {
      const entities = await listed(cookies.customersOrdersStock);
      expect(entities.map((e) => e.name).sort()).toEqual(['customers', 'orders', 'stock']);
      const byName = new Map(entities.map((e) => [e.name, e]));
      expect(byName.get('stock')).toMatchObject({ canExport: true, canImport: true });
      expect(byName.get('orders')).toMatchObject({ canExport: true, canImport: false });
      expect(byName.get('customers')).toMatchObject({ canExport: true, canImport: false });
    });
  });

  describe('an administrator holding none of the codes', () => {
    it('is refused the listing and every entity', async () => {
      expect((await get('/api/v1/admin/import-export/entities', cookies.unrelated)).statusCode).toBe(403);
      expect((await get('/api/v1/admin/export/products.csv', cookies.unrelated)).statusCode).toBe(403);
      expect((await get('/api/v1/admin/export/nonexistent.csv', cookies.unrelated)).statusCode).toBe(403);
    });

    it('is refused before the entity is looked up when signed out', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/export/nonexistent.csv' });
      expect(res.statusCode).toBe(401);
    });
  });

  it('answers an unknown entity with 404 once the caller holds an import/export code', async () => {
    expect((await get('/api/v1/admin/export/nonexistent.csv', cookies.catalogOnly)).statusCode).toBe(404);
  });

  describe('a sales representative scoped to one organization', () => {
    it('exports only the customers of the assigned organization', async () => {
      const res = await get('/api/v1/admin/export/customers.csv', cookies.scopedRep);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('stub-customer-other-org@example.com');
      // No customer of any other organization is in the sheet.
      const platform = await get('/api/v1/admin/export/customers.csv', 'stub-admin-session');
      const outsider = platform.body
        .split('\n')
        .slice(1)
        .filter((line) => line.length > 0 && !line.includes('stub-customer-other-org@example.com'));
      expect(outsider.length).toBeGreaterThan(0);
      for (const line of outsider) expect(res.body).not.toContain(line.split(',')[0]);
    });

    it('exports only the orders of the assigned organization', async () => {
      const res = await get('/api/v1/admin/export/orders.csv', cookies.scopedRep);
      expect(res.statusCode).toBe(200);
      const rows = res.body.split('\n').slice(1).filter((line) => line.length > 0);
      for (const row of rows) expect(row.split(',')[2]).toBe(OTHER_TEST_ORGANIZATION_ID);
    });
  });
});
