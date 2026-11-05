import { randomUUID } from 'node:crypto';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-007 – FR-009, owner
 * ruling OR-5, research R-21; contracts/admin-api.md §2–§3) — deleting an
 * attribute of **every** type.
 *
 * `GET …/attributes/:idOrKey/usage` reports what the delete would meet, from
 * the **same** query the delete guard runs, so the dialog and the refusal
 * cannot disagree:
 *
 * - a set membership refuses (unchanged);
 * - a value on a **live** product refuses — a baseline value, and now also a
 *   per-channel override or a variant value, which the guard used to miss;
 * - a value on a **soft-deleted** product no longer refuses (R-21: nothing
 *   purges a soft-deleted product, so it would block the attribute for ever);
 * - product content is deleted with the attribute, counted in the audit row.
 *
 * After commit the delete emits `attribute.updated.v1` with both flags `false`,
 * so `search` and `price_lists` drop the key from what they compute.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

const tree = (text: string): Record<string, unknown> => ({
  root: { props: {} },
  content: [{ type: 'RichContent', props: { id: `rc-${text.length}`, html: `<p>${text}</p>` } }],
});

interface Usage {
  attributeSetCount: number;
  productValueCount: number;
  productContentCount: number;
}

describe('Attribute delete for every type (feature 172, US6)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const run = randomUUID().slice(0, 6);
  let serial = 0;

  const k = (base: string): string => `ad_${base}_${run}`;

  async function sql<T = unknown>(query: string, params: unknown[] = []): Promise<T> {
    return (await h.em().getConnection().execute(query, params, 'all')) as T;
  }

  async function createAttribute(key: string, type: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      cookies: ADMIN,
      payload: {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        type,
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        ...extra,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function createSet(attributeIds: string[]): Promise<string> {
    const set = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      cookies: ADMIN,
      payload: { code: `ad_set_${run}_${(serial += 1)}`, name: { 'en-US': 'Delete set' } },
    });
    expect(set.statusCode, set.body).toBe(201);
    const setId = (set.json() as { data: { id: string } }).data.id;
    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
      cookies: ADMIN,
      payload: { assignments: attributeIds.map((attributeId, position) => ({ attributeId, position })) },
    });
    expect(assign.statusCode, assign.body).toBe(200);
    return setId;
  }

  async function removeFromSet(setId: string, attributeId: string): Promise<void> {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes/${attributeId}`,
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(204);
  }

  async function createProduct(attributeSetId?: string): Promise<string> {
    serial += 1;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `AD-172-${run}-${serial}`,
        type: 'simple',
        name: `Delete probe ${serial}`,
        description: 'Probe',
        categoryIds: [],
        ...(attributeSetId ? { attributeSetId } : {}),
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function softDelete(productId: string): Promise<void> {
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${productId}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBeLessThan(300);
  }

  const setBaselineValue = (productId: string, key: string): Promise<unknown> =>
    sql(`update products set attribute_values = attribute_values || jsonb_build_object(?::text, 'x') where id = ?`, [
      key,
      productId,
    ]);
  const setOverride = (productId: string, key: string): Promise<unknown> =>
    sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (?, ?, ?, ?, null, '{"v":"x"}'::jsonb, now(), now())`,
      [randomUUID(), productId, key, channelId],
    );
  const setVariantValue = (productId: string, key: string): Promise<unknown> =>
    sql(
      `insert into product_variants (id, parent_product_id, sku, variant_attribute_values, created_at, updated_at)
       values (?, ?, ?, jsonb_build_object(?::text, 'x'), now(), now())`,
      [randomUUID(), productId, `AD-VAR-${run}-${(serial += 1)}`, key],
    );

  const usage = async (idOrKey: string): Promise<Usage> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attributes/${idOrKey}/usage`,
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Usage }).data;
  };
  const del = (idOrKey: string) =>
    h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/attributes/${idOrKey}`, cookies: ADMIN });

  async function definitionExists(key: string): Promise<boolean> {
    const rows = await sql<Array<{ id: string }>>(
      `select id from custom_field_definitions where entity_type = 'product' and key = ?`,
      [key],
    );
    return rows.length > 0;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const rows = await sql<Array<{ id: string }>>(`select id from sales_channels where code = 'pl_retail'`);
    channelId = rows[0]!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('usage (FR-007)', () => {
    it('reports the three counts for a text, a select and a page_builder attribute', async () => {
      const text = await createAttribute(k('u_text'), 'input');
      const select = await createAttribute(k('u_select'), 'select', {
        options: [{ value: 'a', labelDefault: 'A' }],
      });
      const content = await createAttribute(k('u_content'), 'page_builder');
      const setId = await createSet([text, select, content]);

      const p1 = await createProduct(setId);
      const p2 = await createProduct(setId);
      await setBaselineValue(p1, k('u_text'));
      await setOverride(p2, k('u_text'));
      await setVariantValue(p1, k('u_select'));
      for (const productId of [p1, p2]) {
        const put = await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/catalog/products/${productId}/content/${k('u_content')}`,
          cookies: ADMIN,
          payload: { content: { languages: { 'en-US': tree('Usage') } } },
        });
        expect(put.statusCode, put.body).toBe(200);
      }

      expect(await usage(k('u_text'))).toEqual({ attributeSetCount: 1, productValueCount: 2, productContentCount: 0 });
      expect(await usage(select)).toEqual({ attributeSetCount: 1, productValueCount: 1, productContentCount: 0 });
      expect(await usage(k('u_content'))).toEqual({
        attributeSetCount: 1,
        productValueCount: 0,
        productContentCount: 2,
      });
    });

    it('answers 404 for an unknown attribute', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/attributes/${k('nobody')}/usage`,
        cookies: ADMIN,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('refusals (FR-008)', () => {
    async function expectRefused(key: string, reason: RegExp): Promise<void> {
      const res = await del(key);
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: { message: string } }).error.message).toMatch(reason);
      expect(await definitionExists(key)).toBe(true);
    }

    it('refuses while the attribute is in a set', async () => {
      const id = await createAttribute(k('r_set'), 'input');
      await createSet([id]);
      expect((await usage(id)).attributeSetCount).toBe(1);
      await expectRefused(k('r_set'), /attribute set/);
    });

    it('refuses while a live product holds a baseline value', async () => {
      await createAttribute(k('r_base'), 'input');
      await setBaselineValue(await createProduct(), k('r_base'));
      expect((await usage(k('r_base'))).productValueCount).toBe(1);
      await expectRefused(k('r_base'), /1 product/);
    });

    it('refuses while a live product holds only a channel override (new)', async () => {
      await createAttribute(k('r_override'), 'input');
      await setOverride(await createProduct(), k('r_override'));
      expect((await usage(k('r_override'))).productValueCount).toBe(1);
      await expectRefused(k('r_override'), /1 product/);
    });

    it('refuses while a live product holds only a variant value (new)', async () => {
      await createAttribute(k('r_variant'), 'input');
      await setVariantValue(await createProduct(), k('r_variant'));
      expect((await usage(k('r_variant'))).productValueCount).toBe(1);
      await expectRefused(k('r_variant'), /1 product/);
    });

    it('does not count a soft-deleted product’s values, and /usage agrees with the guard (R-21)', async () => {
      await createAttribute(k('r_softdel'), 'input');
      const productId = await createProduct();
      await setBaselineValue(productId, k('r_softdel'));
      await setOverride(productId, k('r_softdel'));
      await setVariantValue(productId, k('r_softdel'));
      expect((await usage(k('r_softdel'))).productValueCount).toBe(1);
      await softDelete(productId);
      expect(await usage(k('r_softdel'))).toEqual({
        attributeSetCount: 0,
        productValueCount: 0,
        productContentCount: 0,
      });
      const res = await del(k('r_softdel'));
      expect(res.statusCode, res.body).toBe(204);
      expect(await definitionExists(k('r_softdel'))).toBe(false);
    });
  });

  describe('delete', () => {
    it('removes a select attribute’s definition, extension and options in one audit row (FR-008)', async () => {
      const id = await createAttribute(k('d_select'), 'select', {
        options: [
          { value: 'a', labelDefault: 'A' },
          { value: 'b', labelDefault: 'B' },
        ],
      });
      const definitionId = (
        await sql<Array<{ id: string }>>(`select id from custom_field_definitions where entity_type = 'product' and key = ?`, [
          k('d_select'),
        ])
      )[0]!.id;
      const res = await del(id);
      expect(res.statusCode, res.body).toBe(204);
      expect(await definitionExists(k('d_select'))).toBe(false);
      expect(await sql<unknown[]>(`select id from product_attributes where id = ?`, [id])).toHaveLength(0);
      expect(await sql<unknown[]>(`select id from custom_field_options where definition_id = ?`, [definitionId])).toHaveLength(0);
      const audit = await h.em().fork().find(AuditLogEntry, { action: 'catalog.attribute.delete', objectId: id });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.stateBefore).toMatchObject({ key: k('d_select'), productContentCount: 0 });
    });

    it('deletes a page_builder attribute’s content rows and counts them in the audit row (FR-007)', async () => {
      const id = await createAttribute(k('d_content'), 'page_builder');
      const setId = await createSet([id]);
      const products = [await createProduct(setId), await createProduct(setId), await createProduct(setId)];
      for (const productId of products) {
        const put = await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/catalog/products/${productId}/content/${k('d_content')}`,
          cookies: ADMIN,
          payload: { content: { languages: { 'en-US': tree('Deleted with it') } } },
        });
        expect(put.statusCode, put.body).toBe(200);
      }
      await removeFromSet(setId, id);
      expect(await usage(id)).toEqual({ attributeSetCount: 0, productValueCount: 0, productContentCount: 3 });

      const res = await del(id);
      expect(res.statusCode, res.body).toBe(204);
      expect(
        await sql<unknown[]>(`select id from product_content_values where product_attribute_id = ?`, [id]),
      ).toHaveLength(0);
      const audit = await h.em().fork().find(AuditLogEntry, { action: 'catalog.attribute.delete', objectId: id });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.stateBefore).toMatchObject({ key: k('d_content'), productContentCount: 3 });
      expect(JSON.stringify(audit[0])).not.toContain('Deleted with it');
    });

    it('emits attribute.updated.v1 with the key and both flags false after commit (FR-009)', async () => {
      await createAttribute(k('d_event'), 'input', { isSearchable: true, isFilterable: true });
      const events: Array<{ attributeKey: string; isSearchable: boolean; isFilterable: boolean }> = [];
      const off = h.eventBus.on('attribute.updated.v1', (payload) => {
        const event = payload as unknown as { attributeKey: string; isSearchable: boolean; isFilterable: boolean };
        if (event.attributeKey === k('d_event')) events.push(event);
      });
      try {
        const refused = await (async () => {
          await setBaselineValue(await createProduct(), k('d_event'));
          return del(k('d_event'));
        })();
        expect(refused.statusCode).toBe(409);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(events).toEqual([]);

        await sql(`update products set attribute_values = attribute_values - ?::text`, [k('d_event')]);
        const res = await del(k('d_event'));
        expect(res.statusCode, res.body).toBe(204);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } finally {
        off();
      }
      expect(events).toEqual([
        expect.objectContaining({ attributeKey: k('d_event'), isSearchable: false, isFilterable: false }),
      ]);
    });
  });
});
