import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import type { CatalogBulkImportPort } from '@endora-commerce/contracts';

/**
 * Feature 161, G15 redesign, on feature 170's model (`specs/170-product-editor-scope-switcher/`
 * data-model §1; FR-031) — `catalog` keeps one stored, generated admin **name key** and **search
 * key** on `products` (`admin_name_key`, `admin_search_key`) over the Global name, so the
 * price-book grid orders and searches 50 000 product lines without deriving a name per row. An
 * admin sees the Global name whatever the admin UI language.
 *
 * The rule: the Global name when it is not empty, else the SKU. The key folds case and accents
 * (`ą→a`, `ł→l`, `Ż→z`); the search key is the key, a space and the lower-cased SKU. Postgres
 * maintains the columns on every write path — the admin update, the import, a bulk edit — and
 * the ORM never writes them.
 */
describe('products — generated admin name and search keys (161 G15, 170)', () => {
  let h: BackendServerHandle;
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  const ids: Record<string, string> = {};
  const sku = (key: string) => `G15K-${key}-${stamp}`;

  type Keys = { admin_name_key: string; admin_search_key: string };
  const keysOf = async (id: string): Promise<Keys> =>
    ((await h
      .em()
      .getConnection()
      .execute(`select admin_name_key, admin_search_key from products where id = ?`, [id])) as Keys[])[0]!;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const make = (key: string, name: string) => {
      const p = em.create(Product, {
        sku: sku(key),
        slug: `g15k-${key.toLowerCase()}-${stamp.toLowerCase()}`,
        type: 'simple',
        status: 'active',
        name,
        description: '',
        visibility: 'public',
        attributeValues: {},
      });
      ids[key] = p.id;
      return p;
    };
    await em.persistAndFlush([make('PL', 'Łącznik śrubowy'), make('EMPTY', ''), make('FOLD', 'Żaba ąę')]);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the key is the folded Global name; the search key adds the SKU', async () => {
    const keys = await keysOf(ids['PL']!);
    expect(keys.admin_name_key).toBe('lacznik srubowy');
    expect(keys.admin_search_key).toBe(`lacznik srubowy ${sku('PL').toLowerCase()}`);
    expect((await keysOf(ids['FOLD']!)).admin_name_key).toBe('zaba ae');
  });

  it('an empty name: the SKU', async () => {
    expect((await keysOf(ids['EMPTY']!)).admin_name_key).toBe(sku('EMPTY').toLowerCase());
  });

  it('the admin update moves the key', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${ids['PL']}`,
      payload: { name: 'Bolt screw' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await keysOf(ids['PL']!)).admin_name_key).toBe('bolt screw');
  });

  it('the product import moves the key', async () => {
    // Feature 170 (T084) — the composed port: the scoped import needs its planner deps.
    const service = (h.container.cradle as unknown as { catalogBulkImportPort: CatalogBulkImportPort }).catalogBulkImportPort;
    const report = await withSystemScope('161 G15 key test — import', () =>
      service.importProducts([
        { sku: sku('EMPTY'), cells: [{ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Ćwiek' } }] },
      ]),
    );
    expect(report).toEqual({ imported: 1, errors: [] });
    expect((await keysOf(ids['EMPTY']!)).admin_name_key).toBe('cwiek');
  });

  it('a bulk edit leaves the key equal to the rule (it changes neither name nor SKU)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds: [ids['FOLD']], fields: { status: 'inactive' } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect((await keysOf(ids['FOLD']!)).admin_name_key).toBe('zaba ae');
  });

  it('the ORM never writes the columns: a value set on the entity is ignored', async () => {
    const em = h.em().fork();
    const p = em.create(Product, {
      sku: sku('ORM'),
      slug: `g15k-orm-${stamp.toLowerCase()}`,
      type: 'simple',
      status: 'active',
      name: 'Rivet',
      description: '',
      visibility: 'public',
      attributeValues: {},
      ...({ adminNameKey: 'zzz' } as Record<string, unknown>),
    });
    await em.persistAndFlush(p);
    expect((await keysOf(p.id)).admin_name_key).toBe('rivet');
    p.name = 'Washer';
    await em.flush();
    expect((await keysOf(p.id)).admin_name_key).toBe('washer');
  });
});
