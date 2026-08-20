import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 075 / D-74 — `import_export` off, and each of its five owners off.
 *
 * Two obligations meet here. The first is Constitution XVII checklist item 6,
 * which this module never had a test for. The second is what D-74 adds: the
 * module declares five `degrades-without` edges, and `degrades-without` obliges
 * it to **check presence before it reads**. Until the cut the five entity slugs
 * were a literal array in the admin SPA, so an operator who switched `inventory`
 * off was still offered a Stock import — and the POST behind it would have
 * reached a gated port and answered 503 for a capability the operator had
 * deliberately withdrawn.
 *
 * The shape asserted per owner is therefore three things at once: the entity
 * leaves the offered list, the routes for it answer the same 404 an unknown
 * slug gets, and **every other entity keeps working**. The last one is what
 * makes the edge non-binding rather than a dependency wearing a different name.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const HEADER_ONLY_PRODUCTS_CSV = 'sku,status,visibility,name_en,description_en\n';

describe('import_export — off state [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function offeredEntities(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/import-export/entities',
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { entities: Array<{ name: string }> } };
    return body.data.entities.map((entity) => entity.name);
  }

  async function exportStatus(entity: string): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/export/${entity}.csv`,
      cookies: ADMIN,
    });
    return res.statusCode;
  }

  it('is absent on every surface while off, and fully restored when on', async () => {
    await expectModuleAbsent(h, 'import_export', {
      routes: [
        { url: '/api/v1/admin/import-export/entities', cookies: ADMIN },
        {
          method: 'POST',
          url: '/api/v1/admin/import/products',
          headers: { 'content-type': 'text/csv' },
          cookies: ADMIN,
          payload: HEADER_ONLY_PRODUCTS_CSV,
        },
      ],
      adminPresence: { cookies: ADMIN },
      settingWrite: {
        // Not the activation control — that is the documented exception. This
        // module owns exactly one Setting, so there is nothing else to probe,
        // and the activation endpoint's own contract test covers it.
        code: 'import_export.enabled',
        value: true,
        cookies: ADMIN,
      },
    });
  });

  it('offers every entity while all five owners are present', async () => {
    expect(await offeredEntities()).toEqual([
      'products',
      'categories',
      'stock',
      'customers',
      'orders',
    ]);
  });

  it('drops the Stock entity while `inventory` is deactivated, and nothing else', async () => {
    await withModuleOff('inventory', 'deactivated', async () => {
      expect(await offeredEntities()).toEqual(['products', 'categories', 'customers', 'orders']);

      // The entity this deployment does not have — the same 404 an unknown
      // slug gets, not a 503 an operator has to interpret.
      expect(await exportStatus('stock')).toBe(404);
      const post = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/import/stock',
        headers: { 'content-type': 'text/csv' },
        cookies: ADMIN,
        payload: 'product_sku,variant_id,on_hand\n',
      });
      expect(post.statusCode).toBe(404);

      // Every other entity is unaffected — that is the `whenAbsent` sentence.
      expect(await exportStatus('products')).toBe(200);
      expect(await exportStatus('orders')).toBe(200);
    });

    expect(await offeredEntities()).toContain('stock');
    expect(await exportStatus('stock')).toBe(200);
  });

  it('drops the Orders export while `orders` is platform-unavailable, and nothing else', async () => {
    // `orders` declares itself non-deactivatable, so the operator axis is inert
    // for it; the platform axis is the one a deployment can still reach.
    await withModuleOff('orders', 'platform-unavailable', async () => {
      expect(await offeredEntities()).not.toContain('orders');
      expect(await exportStatus('orders')).toBe(404);
      expect(await exportStatus('products')).toBe(200);
      expect(await exportStatus('stock')).toBe(200);
    });

    expect(await offeredEntities()).toContain('orders');
    expect(await exportStatus('orders')).toBe(200);
  });

  it('drops the Customers export when either of its two owners is away', async () => {
    // The sheet names each account's organisation, so the entity needs both
    // modules. Neither absence may take the rest of the centre with it.
    await withModuleOff('customer_accounts', 'platform-unavailable', async () => {
      expect(await offeredEntities()).not.toContain('customers');
      expect(await exportStatus('customers')).toBe(404);
      expect(await exportStatus('products')).toBe(200);
    });

    await withModuleOff('organizations', 'platform-unavailable', async () => {
      expect(await offeredEntities()).not.toContain('customers');
      expect(await exportStatus('customers')).toBe(404);
      expect(await exportStatus('products')).toBe(200);
    });

    expect(await offeredEntities()).toContain('customers');
    expect(await exportStatus('customers')).toBe(200);
  });

  it('drops the catalogue entities while `catalog` is platform-unavailable', async () => {
    await withModuleOff('catalog', 'platform-unavailable', async () => {
      // Stock goes with them: its sheet is keyed by SKU, which is `catalog`'s.
      expect(await offeredEntities()).toEqual(['customers', 'orders']);
      expect(await exportStatus('products')).toBe(404);
      expect(await exportStatus('categories')).toBe(404);
      expect(await exportStatus('stock')).toBe(404);
      expect(await exportStatus('orders')).toBe(200);
    });

    expect(await offeredEntities()).toEqual([
      'products',
      'categories',
      'stock',
      'customers',
      'orders',
    ]);
  });
});
