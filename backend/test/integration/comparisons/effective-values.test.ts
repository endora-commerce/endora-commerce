import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 8 (T059, FR-017 c) — a comparison column carries the Name
 * the storefront shows at the reader's (channel, language).
 *
 * Final QA Q-M2 (FR-017 c) — and the compared attribute values likewise: a comparable,
 * channel- and language-scoped attribute overridden at (pl_retail, L) compares by the
 * override, not the baseline.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('163 — comparisons show effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;
  let language = '';
  const attributeKey = `s163_cmp_material_${minimumFixtureRun()}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    language = channel.defaultLanguage;
    product = await createMinimumProduct(em, { sku: `S163-CMPN-${RUN}`, nameEn: 'Plain', namePl: 'Plain', channelIds: [channel.id] });
    await setNameOverride(em, product.id, channel.id, null, `Compared ${RUN}`);
    const attr = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: attributeKey,
        label: { 'en-US': 'Material', 'pl-PL': 'Materiał' },
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isComparable: true,
        isVariantAxis: false,
        isVisibleOnProductPage: true,
        scopable: true,
      },
      cookies: ADMIN,
    });
    expect(attr.statusCode, attr.body).toBe(201);
    // The baseline goes straight onto the row (the create route refuses a value for an
    // attribute outside the product's attribute set, which is not the subject here).
    await em
      .getConnection()
      .execute(`update products set attribute_values = jsonb_build_object(?::text, 'Steel') where id = ?`, [
        attributeKey,
        product.id,
      ]);
    // Feature 172 — the override is written through the one save, `PUT …/scoped-values`, which
    // binds an attribute key to the product's attribute set (R21): the product gets a set of its
    // own holding the attribute.
    const conn = em.getConnection();
    const [definition] = await conn.execute<Array<{ id: string }>>(
      `select id from custom_field_definitions where key = ?`,
      [attributeKey],
    );
    const attributeSetId = randomUUID();
    await conn.execute(
      `insert into attribute_sets (id, code, name, is_system, created_at, updated_at)
       values (?, ?, '{"en-US":"S163 CMP"}'::jsonb, false, now(), now())`,
      [attributeSetId, `s163_cmp_${RUN}`],
    );
    await conn.execute(
      `insert into attribute_set_attributes (attribute_set_id, custom_field_definition_id, position) values (?, ?, 0)`,
      [attributeSetId, definition!.id],
    );
    await conn.execute(`update products set attribute_set_id = ? where id = ?`, [attributeSetId, product.id]);
    const scope = { channelId: channel.id, languageCode: language };
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${product.id}/scoped-values?${new URLSearchParams(scope).toString()}`,
      cookies: ADMIN,
    });
    expect(read.statusCode, read.body).toBe(200);
    const { version } = (read.json() as { data: { version: string } }).data;
    const save = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${product.id}/scoped-values`,
      payload: { scope, version, changes: { attributes: { [attributeKey]: `Brass ${RUN}` } } },
      cookies: ADMIN,
    });
    expect(save.statusCode, save.body).toBe(200);
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [product.id]);
    // The attribute stays (the product references it), but stops being compared.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${attributeKey}`,
      payload: { isComparable: false },
      cookies: ADMIN,
    });
    await teardownBackendServer(h);
  });

  it('names the column with the channel override in the reader’s language', async () => {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      cookies: BUYER,
      headers: { ...CHANNEL, 'accept-language': language, 'content-type': 'application/json' },
      payload: { productId: product.id },
    });
    expect(add.statusCode, add.body).toBe(200);
    // Feature 172 (`contracts/readers.md` §2) — the column's name is the effective string.
    const column = (add.json() as { data: { products: Array<{ id: string; name: string }> } }).data.products.find(
      (p) => p.id === product.id,
    );
    expect(column?.name).toBe(`Compared ${RUN}`);
  });

  it('compares the attribute by the (channel, language) override, not the baseline', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/comparisons/me',
      cookies: BUYER,
      headers: { ...CHANNEL, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    const view = (
      res.json() as {
        data: { products: Array<{ id: string }>; comparableAttributes: Array<{ key: string; values: Array<string | null> }> };
      }
    ).data;
    const index = view.products.findIndex((p) => p.id === product.id);
    expect(index).toBeGreaterThanOrEqual(0);
    const row = view.comparableAttributes.find((r) => r.key === attributeKey);
    expect(row?.values[index]).toBe(`Brass ${RUN}`);
  });
});
