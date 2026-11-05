import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScopedValuesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createAttributeFixture } from '../../helpers/seed-catalog.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 174, US1 (T026; FR-002, FR-003, FR-004, SC-001, US1 #1, #3) — saving a product never
 * loses its text in any language. Name, description and a scopable text attribute hold own values
 * at Channel × language in `en-US`, `pl-PL` and `de-DE`; three saves of **unrelated** fields at
 * other scopes (Channel, Global, another Channel × language) through
 * `PUT …/products/:id/scoped-values` leave every one of those cells — and the Global texts —
 * exactly as they were.
 *
 * Stays RED until the scoped-values read and save land (US2 T036–T038).
 */
describe('174 US1 — a save never loses another scope’s text (T026)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const LANGUAGES = ['pl-PL', 'en-US', 'de-DE'] as const;
  let channelId: string;
  let productId: string;
  let attributeKey: string;
  let attributeSetId: string;

  const url = (suffix = '') => `/api/v1/admin/catalog/products/${productId}/scoped-values${suffix}`;

  async function read(scope: { channelId?: string; languageCode?: string }): Promise<ScopedValuesResponse['data']> {
    const qs = new URLSearchParams(scope as Record<string, string>).toString();
    const res = await h.app.inject({ method: 'GET', url: `${url()}${qs ? `?${qs}` : ''}`, ...admin });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as ScopedValuesResponse).data;
  }

  async function save(scope: { channelId?: string; languageCode?: string }, changes: object): Promise<void> {
    const { version } = await read(scope);
    const res = await h.app.inject({ method: 'PUT', url: url(), ...admin, payload: { scope, version, changes } });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function snapshot(): Promise<unknown> {
    const conn = h.em().getConnection();
    const overrides = await conn.execute(
      `select attribute_key, channel_id::text as channel_id, language_code, value
         from product_value_overrides where product_id = ? order by attribute_key, language_code nulls first`,
      [productId],
    );
    const [row] = await conn.execute<Array<{ name: string; description: string | null; attribute_values: unknown }>>(
      `select name, description, attribute_values from products where id = ?`,
      [productId],
    );
    return { overrides, row };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const conn = h.em().getConnection();
    channelId = randomUUID();
    await conn.execute(
      `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
       values (?, ?, ?::jsonb, 'pl-PL', ?::jsonb, 'PLN', now(), now())`,
      [channelId, `t026-${run}`, JSON.stringify({ 'en-US': `T026 ${run}` }), JSON.stringify(LANGUAGES)],
    );
    attributeKey = `t026_material_${run.replace(/-/g, '')}`;
    const attribute = await createAttributeFixture(h.em(), {
      key: attributeKey,
      label: { 'en-US': 'Material' },
      labelDefault: 'Material',
      valueType: 'string',
      scopable: true,
    });
    attributeSetId = randomUUID();
    await conn.execute(
      `insert into attribute_sets (id, code, name, is_system, created_at, updated_at)
       values (?, ?, '{"en-US":"T026"}'::jsonb, false, now(), now())`,
      [attributeSetId, `t026_${run}`],
    );
    await conn.execute(
      `insert into attribute_set_attributes (attribute_set_id, custom_field_definition_id, position) values (?, ?, 0)`,
      [attributeSetId, (attribute.definition as { id: string }).id],
    );

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: {
        sku: `T026-${run}`,
        type: 'simple',
        name: 'Drill X',
        description: 'Global description',
        categoryIds: [],
        attributeSetId,
        attributeValues: { [attributeKey]: 'Steel' },
        visibility: 'public',
        status: 'active',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    productId = (created.json() as { data: { id: string } }).data.id;
    await conn.execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, productId]);

    const em = h.em().fork();
    await seedScopedValues(
      em,
      productId,
      LANGUAGES.flatMap((languageCode) => {
        const scope = { level: 'channel_language' as const, channelId, languageCode };
        return [
          { field: 'name', scope, value: `Drill X ${languageCode}` },
          { field: 'description', scope, value: `Description ${languageCode}` },
          { field: `attribute:${attributeKey}`, scope, value: `Material ${languageCode}` },
        ];
      }),
    );
  });

  afterAll(async () => {
    if (h) {
      await h.em().getConnection().execute(`delete from products where id = ?`, [productId]);
      await h.em().getConnection().execute(`delete from sales_channels where id = ?`, [channelId]);
      await h.em().getConnection().execute(`delete from attribute_sets where id = ?`, [attributeSetId]);
      await teardownBackendServer(h);
    }
  });

  it('three unrelated saves at other scopes leave every text cell unchanged', async () => {
    const before = await snapshot();

    await save({ channelId }, { minOrderQuantity: 5 });
    await save({}, { product: { manageStock: false } });
    await save({ channelId, languageCode: 'de-DE' }, { status: 'inactive' });

    expect(await snapshot()).toEqual(before);
    for (const languageCode of LANGUAGES) {
      const data = await read({ channelId, languageCode });
      expect(data.fields.name).toMatchObject({ value: `Drill X ${languageCode}`, source: 'set' });
      expect(data.fields.description).toMatchObject({ value: `Description ${languageCode}`, source: 'set' });
      const attribute = data.attributes.find((a) => a.key === attributeKey);
      expect(attribute?.view).toMatchObject({ value: `Material ${languageCode}`, source: 'set' });
    }
    const global = await read({});
    expect(global.fields.name).toMatchObject({ value: 'Drill X', source: 'set' });
    expect(global.fields.description).toMatchObject({ value: 'Global description', source: 'set' });
  });
});
