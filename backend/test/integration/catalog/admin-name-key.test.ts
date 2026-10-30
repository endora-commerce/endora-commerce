import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CommandBus } from '../../../src/commands/index.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { CatalogBulkImportService } from '../../../../packages/modules/catalog/src/backend/services/catalog-bulk-import.service.js';

/**
 * Feature 161, G15 redesign (`specs/161-price-book-editor/research.md` R14) —
 * `catalog` keeps a stored, generated admin **name key** and **search key** per
 * admin language on `products` (`admin_name_key_en|pl`, `admin_search_key_en|pl`),
 * so the price-book grid orders and searches 50 000 product lines without
 * deriving a name per row.
 *
 * The rule, for admin language `L`: the non-empty name whose tag's primary
 * subtag is `L` (the first tag in `jsonb` key order — shorter first, then
 * bytewise, so `en-GB` before `en-US`); else the same for English; else the
 * first non-empty name; else the SKU. The key folds case and accents (`ą→a`,
 * `ł→l`, `Ż→z`); the search key is the key, a space and the lower-cased SKU.
 * Postgres maintains the columns on every write path — the admin update, the
 * import, a bulk edit — and the ORM never writes them.
 */
describe('products — generated admin name and search keys (161 G15)', () => {
  let h: BackendServerHandle;
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  const ids: Record<string, string> = {};
  const sku = (key: string) => `G15K-${key}-${stamp}`;

  type Keys = { admin_name_key_en: string; admin_name_key_pl: string; admin_search_key_en: string; admin_search_key_pl: string };
  const keysOf = async (id: string): Promise<Keys> =>
    ((await h
      .em()
      .getConnection()
      .execute(`select admin_name_key_en, admin_name_key_pl, admin_search_key_en, admin_search_key_pl from products where id = ?`, [id])) as Keys[])[0]!;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const make = (key: string, name: Record<string, string>) => {
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
    await em.persistAndFlush([
      make('TWO', { 'en-US': 'Zebra screw', 'en-GB': 'Apple screw' }),
      make('PL', { 'pl-PL': 'Łącznik śrubowy' }),
      make('EMPTY', {}),
      make('BLANK', { 'en-US': '' }),
      make('FOLD', { 'pl-PL': 'Żaba ąę', 'en-US': 'FROG Leg' }),
    ]);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('two names in one language: the first tag (en-GB before en-US)', async () => {
    expect(await keysOf(ids['TWO']!)).toEqual({
      admin_name_key_en: 'apple screw',
      admin_name_key_pl: 'apple screw',
      admin_search_key_en: `apple screw ${sku('TWO').toLowerCase()}`,
      admin_search_key_pl: `apple screw ${sku('TWO').toLowerCase()}`,
    });
  });

  it('only a Polish name: Polish for pl, and the first name for en; diacritics folded', async () => {
    const keys = await keysOf(ids['PL']!);
    expect(keys.admin_name_key_pl).toBe('lacznik srubowy');
    expect(keys.admin_name_key_en).toBe('lacznik srubowy');
  });

  it('no name or an empty one: the SKU', async () => {
    expect((await keysOf(ids['EMPTY']!)).admin_name_key_en).toBe(sku('EMPTY').toLowerCase());
    expect((await keysOf(ids['BLANK']!)).admin_name_key_pl).toBe(sku('BLANK').toLowerCase());
  });

  it('each language its own name, case and accents folded', async () => {
    const keys = await keysOf(ids['FOLD']!);
    expect(keys.admin_name_key_pl).toBe('zaba ae');
    expect(keys.admin_name_key_en).toBe('frog leg');
    expect(keys.admin_search_key_pl).toBe(`zaba ae ${sku('FOLD').toLowerCase()}`);
  });

  it('the admin update moves the key', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${ids['TWO']}`,
      payload: { name: { 'en-US': 'Zebra screw', 'en-GB': 'Bolt screw' } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await keysOf(ids['TWO']!)).admin_name_key_en).toBe('bolt screw');
  });

  it('the product import moves the key', async () => {
    const service = new CatalogBulkImportService(new CommandBus(h.orm, h.auditLogService, h.eventBus), h.salesChannels.membershipService);
    const report = await withSystemScope('161 G15 key test — import', () =>
      service.importProducts([{ sku: sku('PL'), name: { 'pl-PL': 'Ćwiek' } }]),
    );
    expect(report).toEqual({ imported: 1, errors: [] });
    expect((await keysOf(ids['PL']!)).admin_name_key_pl).toBe('cwiek');
  });

  it('a bulk edit leaves the key equal to the rule (it changes neither name nor SKU)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: { productIds: [ids['FOLD']], fields: { status: 'inactive' } },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    expect((await keysOf(ids['FOLD']!)).admin_name_key_pl).toBe('zaba ae');
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
      ...({ adminNameKeyEn: 'zzz' } as Record<string, unknown>),
    });
    await em.persistAndFlush(p);
    expect((await keysOf(p.id)).admin_name_key_en).toBe('rivet');
    p.name = 'Washer';
    await em.flush();
    expect((await keysOf(p.id)).admin_name_key_en).toBe('washer');
  });
});
