import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { CatalogAttributeValueKeyApi } from '@endora-commerce/mod-catalog/ports';

import { Product, ProductValueOverride } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `catalog`'s value-key rename on Postgres, and what it does to data already
 * under its destination (`specs/134-paid-module-extraction/research.md` D12,
 * *Ergonode key repair: what a rename does to data already under its
 * destination*, rule 1).
 *
 * Whatever sits under the destination belongs to a deleted definition — the
 * seam's one caller reserves every live key — so it is never merged into the
 * moved value and never left to collide with it. The caller chooses, with no
 * default: `refuse` writes nothing, `displace` removes and returns it before
 * the key moves. The two unique indexes on `product_value_overrides`
 * (channel-only and channel+language) are the reason the override case is
 * here: under the old `jsonb ||` merge a destination row in the same slot
 * failed one of them and rolled the whole transaction back.
 */
describe('catalog — renaming a value key onto an occupied destination [integration]', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const TAG = 'avk';

  function seam(): CatalogAttributeValueKeyApi {
    return h.container.resolve('catalogAttributeValueKeyPort') as CatalogAttributeValueKeyApi;
  }

  async function seedProduct(attributeValues: Record<string, unknown>): Promise<string> {
    const em = h.em();
    const suffix = randomUUID().slice(0, 8);
    const product = em.create(Product, {
      sku: `${TAG}-${suffix}`,
      slug: `${TAG}-${suffix}`,
      type: 'simple',
      status: 'active',
      name: { en: 'Value key fixture' },
      description: { en: 'fixture' },
      visibility: 'public',
      attributeValues,
    });
    await em.persistAndFlush(product);
    em.clear();
    return product.id;
  }

  async function seedOverride(
    productId: string,
    attributeKey: string,
    value: unknown,
    languageCode: string | null = null,
  ): Promise<void> {
    const em = h.em();
    em.persist(
      em.create(ProductValueOverride, {
        productId,
        attributeKey,
        channelId,
        languageCode,
        value: { v: value },
      }),
    );
    await em.flush();
    em.clear();
  }

  async function valuesOf(productId: string): Promise<Record<string, unknown>> {
    const em = h.em();
    em.clear();
    return (await em.findOneOrFail(Product, { id: productId })).attributeValues;
  }

  async function overridesOf(productId: string): Promise<Array<[string, string | null, unknown]>> {
    const em = h.em();
    em.clear();
    const rows = await em.find(ProductValueOverride, { productId });
    return rows
      .map((row): [string, string | null, unknown] => [
        row.attributeKey,
        row.languageCode ?? null,
        row.value.v,
      ])
      .sort((a, b) => `${a[0]}|${a[1] ?? ''}`.localeCompare(`${b[0]}|${b[1] ?? ''}`));
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = (await h.em().findOneOrFail(SalesChannel, { systemDefault: true })).id;
  });

  afterEach(async () => {
    const em = h.em();
    await em.execute(`delete from product_value_overrides where attribute_key like '${TAG}_%'`);
    await em.execute(`delete from products where sku like '${TAG}-%'`);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuse: an occupied destination throws target_occupied and writes nothing', async () => {
    const productId = await seedProduct({ [`${TAG}_from`]: 'live', [`${TAG}_to`]: 'dormant' });
    await seedOverride(productId, `${TAG}_from`, 'live override');
    await seedOverride(productId, `${TAG}_to`, 'dormant override');

    await expect(
      h
        .em()
        .transactional((tx) =>
          seam().renameValueKey(tx, `${TAG}_from`, `${TAG}_to`, { occupied: 'refuse' }),
        ),
    ).rejects.toMatchObject({ code: 'target_occupied' });

    expect(await valuesOf(productId)).toEqual({
      [`${TAG}_from`]: 'live',
      [`${TAG}_to`]: 'dormant',
    });
    expect(await overridesOf(productId)).toEqual([
      [`${TAG}_from`, null, 'live override'],
      [`${TAG}_to`, null, 'dormant override'],
    ]);
  });

  it('displace: removes and returns what was under the destination, then the move lands', async () => {
    const both = await seedProduct({ [`${TAG}_from`]: 'live', [`${TAG}_to`]: 'dormant' });
    const onlyDormant = await seedProduct({ [`${TAG}_to`]: 'orphan', other: 'kept' });
    // Same slot as the live override in both unique indexes: channel-only, and
    // channel + language.
    await seedOverride(both, `${TAG}_from`, 'live override');
    await seedOverride(both, `${TAG}_to`, 'dormant override');
    await seedOverride(both, `${TAG}_from`, 'live pl', 'pl');
    await seedOverride(both, `${TAG}_to`, 'dormant pl', 'pl');

    const moved = await h
      .em()
      .transactional((tx) =>
        seam().renameValueKey(tx, `${TAG}_from`, `${TAG}_to`, { occupied: 'displace' }),
      );

    expect(moved.products).toBe(1);
    expect(moved.overrides).toBe(2);
    expect(
      [...moved.displaced.values].sort((a, b) => String(a.value).localeCompare(String(b.value))),
    ).toEqual([
      { productId: both, value: 'dormant' },
      { productId: onlyDormant, value: 'orphan' },
    ]);
    expect(
      [...moved.displaced.overrides].sort((a, b) =>
        String(a.languageCode).localeCompare(String(b.languageCode)),
      ),
    ).toEqual([
      { productId: both, channelId, languageCode: null, value: { v: 'dormant override' } },
      { productId: both, channelId, languageCode: 'pl', value: { v: 'dormant pl' } },
    ]);

    expect(await valuesOf(both)).toEqual({ [`${TAG}_to`]: 'live' });
    // A product holding only the dormant value ends with nothing under the
    // destination: that value belongs to a deleted attribute, not the renamed one.
    expect(await valuesOf(onlyDormant)).toEqual({ other: 'kept' });
    expect(await overridesOf(both)).toEqual([
      [`${TAG}_to`, null, 'live override'],
      [`${TAG}_to`, 'pl', 'live pl'],
    ]);
  });

  it('displace with nothing under the destination displaces nothing', async () => {
    const productId = await seedProduct({ [`${TAG}_from`]: 'live' });

    const moved = await h
      .em()
      .transactional((tx) =>
        seam().renameValueKey(tx, `${TAG}_from`, `${TAG}_to`, { occupied: 'displace' }),
      );

    expect(moved).toEqual({ products: 1, overrides: 0, displaced: { values: [], overrides: [] } });
    expect(await valuesOf(productId)).toEqual({ [`${TAG}_to`]: 'live' });
  });
});
