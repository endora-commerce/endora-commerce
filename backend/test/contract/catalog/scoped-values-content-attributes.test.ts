import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CatalogProductScopeWritePort } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 174 × `specs/172-product-content-attributes/` (FR-011, FR-014, FR-040, FR-042) — a Page
 * Builder content attribute is no scoped value. Its document per language lives in
 * `product_content_values` and is edited on the product content screen, so the scoped read does
 * not list it as an `attribute:<key>` field, and every scoped write path refuses one: the editor's
 * save at Global and at a channel, and the connector's scope write port. Nothing reaches
 * `attribute_values` or `product_value_overrides`.
 */
describe('174 — a content attribute is not a scoped value (172 FR-011, FR-040, FR-042)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let plain: string;
  let guide: string;
  let productId: string;

  const port = () =>
    (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
  const stored = async () => {
    const [row] = await fx.sql<{ values: Record<string, unknown> }>(`select attribute_values as values from products where id = ?`, [productId]);
    const [overrides] = await fx.sql<{ n: number }>(
      `select count(*)::int as n from product_value_overrides where product_id = ? and attribute_key = ?`,
      [productId, guide],
    );
    return { global: row!.values?.[guide], overrides: overrides!.n };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    plain = await fx.attribute({ key: 'material', valueType: 'string', scopable: true });
    guide = await fx.attribute({ key: 'buying_guide', valueType: 'page_builder' });
    productId = await fx.product({ channels: [channel] });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('the scoped read lists the ordinary attribute and not the content one, at every level', async () => {
    for (const scope of [{}, { channelId: channel }, { channelId: channel, languageCode: 'pl-PL' }]) {
      const keys = (await fx.read(productId, scope)).attributes.map((attribute) => attribute.key);
      expect(keys, JSON.stringify(scope)).toContain(plain);
      expect(keys, JSON.stringify(scope)).not.toContain(guide);
    }
  });

  it('the save refuses the content key at Global and at a channel, and writes nothing', async () => {
    for (const scope of [{}, { channelId: channel }]) {
      const res = await fx.put(productId, scope, { attributes: { [guide]: 'x' } });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({
        error: {
          code: ERROR_CODES.SCOPED_VALUE_INVALID,
          details: { fields: [expect.objectContaining({ field: `attribute:${guide}`, reason: 'invalid' })] },
        },
      });
    }
    expect(await stored()).toEqual({ global: undefined, overrides: 0 });
  });

  it('the save refuses the content key also when it switches to a set holding it', async () => {
    const other = randomUUID();
    const [{ set } = { set: null }] = await fx.sql<{ set: string | null }>(`select attribute_set_id as set from products where id = ?`, [productId]);
    await fx.sql(
      `insert into attribute_sets (id, code, name, is_system, created_at, updated_at)
       values (?, ?, '{"en-US":"SV173 other"}'::jsonb, false, now(), now())`,
      [other, `sv173_other_${fx.run}`],
    );
    try {
      await fx.sql(
        `insert into attribute_set_attributes (attribute_set_id, custom_field_definition_id, position)
         select ?, d.id, 0 from custom_field_definitions d where d.entity_type = 'product' and d.key = ?`,
        [other, guide],
      );
      const res = await fx.put(productId, {}, { product: { attributeSetId: other }, attributes: { [guide]: 'x' } });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject({
        error: { code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [expect.objectContaining({ field: `attribute:${guide}` })] } },
      });
      expect(await stored()).toEqual({ global: undefined, overrides: 0 });
    } finally {
      await fx.sql(`update products set attribute_set_id = ? where id = ?`, [set, productId]);
      await fx.sql(`delete from attribute_sets where id = ?`, [other]);
    }
  });

  it('the connector port refuses a content cell and applies the rest of the call', async () => {
    const result = await withSystemScope('174 content attribute port test', () =>
      port().applyScopes(
        productId,
        {
          cells: [
            { scope: { level: 'global' }, field: `attribute:${guide}`, op: { op: 'set', value: '<p>Guide</p>' } },
            { scope: { level: 'channel', channelId: channel }, field: `attribute:${guide}`, op: { op: 'set', value: 'x' } },
            { scope: { level: 'global' }, field: `attribute:${plain}`, op: { op: 'set', value: 'Steel' } },
          ],
        },
        { source: 'pim_connector' },
      ),
    );
    expect(result.applied).toBe(1);
    expect(result.refused.map((refusal) => refusal.field)).toEqual([`attribute:${guide}`, `attribute:${guide}`]);
    expect(await stored()).toEqual({ global: undefined, overrides: 0 });
    expect((await fx.read(productId)).attributes.find((attribute) => attribute.key === plain)?.view.value).toBe('Steel');
  });
});
