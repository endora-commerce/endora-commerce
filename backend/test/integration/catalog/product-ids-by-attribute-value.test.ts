import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CatalogProductReadService } from '../../../../packages/modules/catalog/src/backend/services/catalog-product-read.service.js';

/**
 * Feature 148, owner decision Q1 — `catalogProductReadPort.listProductIdsByAttributeValue`.
 *
 * The price matrix may select products by an attribute value, and the
 * storefront's price-ordered listing has to order those products by the
 * matrix price, so `price_lists` needs the ids an attribute value selects —
 * the attribute counterpart of `listProductIdsInCategory`. Three matching
 * rules, the ones the resolver applies to a product's own values: a scalar
 * equals the value (single choice), an array contains it (multiple choice), a
 * boolean is `true` or `false` — never a missing value. Structural like its
 * category twin: soft-deleted and inactive products are included, because the
 * caller intersects with its own visibility.
 */
describe('CatalogProductReadService.listProductIdsByAttributeValue', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const key = `pm148_${stamp}`;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const make = (label: string, value: unknown, extra: Record<string, unknown> = {}) =>
      em.create(Product, {
        sku: `PM148-${label}-${stamp}`,
        slug: `pm148-${label.toLowerCase()}-${stamp}`,
        type: 'simple',
        status: 'active',
        name: label,
        description: 'x',
        visibility: 'public',
        attributeValues: value === undefined ? {} : { [key]: value },
        ...extra,
      });
    const rows = {
      scalar: make('SCALAR', 'steel'),
      other: make('OTHER', 'brass'),
      array: make('ARRAY', ['steel', 'brass']),
      yes: make('YES', true),
      no: make('NO', false),
      missing: make('MISSING', undefined),
      stringTrue: make('STRTRUE', 'true'),
      deleted: make('DELETED', 'steel', { deletedAt: new Date() }),
      inactive: make('INACTIVE', 'steel', { status: 'inactive' }),
    };
    await em.persistAndFlush(Object.values(rows));
    for (const [name, row] of Object.entries(rows)) ids[name] = row.id;
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const read = () => new CatalogProductReadService(h.em);

  it('matches a scalar value by equality, structurally', async () => {
    const out = await read().listProductIdsByAttributeValue({ key, value: 'steel', match: 'scalar' });
    expect(out.sort()).toEqual([ids['scalar'], ids['deleted'], ids['inactive']].sort());
  });

  it('matches an array value by membership', async () => {
    const out = await read().listProductIdsByAttributeValue({ key, value: 'brass', match: 'array' });
    expect(out).toEqual([ids['array']]);
  });

  it('matches a boolean on true and false, never a missing value or the string "true"', async () => {
    expect(await read().listProductIdsByAttributeValue({ key, value: 'true', match: 'boolean' })).toEqual([ids['yes']]);
    expect(await read().listProductIdsByAttributeValue({ key, value: 'false', match: 'boolean' })).toEqual([ids['no']]);
  });

  it('answers nothing for an unknown key', async () => {
    expect(await read().listProductIdsByAttributeValue({ key: `${key}_none`, value: 'steel', match: 'scalar' })).toEqual([]);
  });
});
