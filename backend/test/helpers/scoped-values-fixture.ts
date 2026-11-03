import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { ScopedValuesResponse } from '@endora-commerce/contracts';
import type { BackendServerHandle } from './test-server.js';
import type { LightMyRequestResponse as InjectResponse } from 'fastify';
import { createAttributeFixture } from './seed-catalog.js';

/**
 * Feature 170 — the scoped-values contract suites' fixture: per-run channels, an attribute set
 * holding the attributes a test asks for, products created through the admin API and added to
 * channels, and the read / save calls of `contracts/scoped-values-api.md` §2–§3. Everything is
 * committed (the suites run against `setupBackendServer`) and removed by {@link cleanup}.
 */
export interface ScopedValuesFixture {
  run: string;
  channel(languages: readonly string[]): Promise<string>;
  attribute(input: { key: string; valueType: string; scopable?: boolean; isRequired?: boolean; options?: string[] }): Promise<string>;
  product(input?: { channels?: string[]; type?: string; attributeValues?: Record<string, unknown>; name?: string; description?: string | null }): Promise<string>;
  read(productId: string, scope?: Scope, who?: Who): Promise<ScopedValuesResponse['data']>;
  readRaw(productId: string, scope?: Scope, who?: Who): Promise<InjectResponse>;
  put(productId: string, scope: Scope, changes: unknown, options?: { version?: string; who?: Who }): Promise<InjectResponse>;
  save(productId: string, scope: Scope, changes: unknown): Promise<ScopedValuesResponse['data']>;
  /** Two gallery items (the first holds `base_image` at Global), one attachment and one packaging unit, by SQL. */
  media(productId: string): Promise<{ items: [string, string]; attachment: string; unit: string }>;
  sql<T = Record<string, unknown>>(statement: string, params?: unknown[]): Promise<T[]>;
  cleanup(): Promise<void>;
}

export type Scope = { channelId?: string; languageCode?: string };
export type Who = { cookies: Record<string, string> };

export const ADMIN: Who = { cookies: { b2b_session: 'stub-admin-session' } };

export function scopedValuesFixture(h: () => BackendServerHandle): ScopedValuesFixture {
  const run = randomUUID().slice(0, 8);
  const channels: string[] = [];
  const products: string[] = [];
  const sets: string[] = [];
  const assets: string[] = [];
  const types: string[] = [];
  let attributeSetId: string | null = null;
  const conn = () => h().em().getConnection();
  const url = (productId: string) => `/api/v1/admin/catalog/products/${productId}/scoped-values`;
  const qs = (scope: Scope = {}) => {
    const q = new URLSearchParams(scope as Record<string, string>).toString();
    return q ? `?${q}` : '';
  };

  const fixture: ScopedValuesFixture = {
    run,
    async channel(languages) {
      const id = randomUUID();
      await conn().execute(
        `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
         values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', now(), now())`,
        [id, `sv170-${run}-${channels.length}`, JSON.stringify({ 'en-US': `SV ${run} ${channels.length}` }), languages[0], JSON.stringify(languages)],
      );
      channels.push(id);
      return id;
    },
    async attribute(input) {
      if (attributeSetId === null) {
        attributeSetId = randomUUID();
        await conn().execute(
          `insert into attribute_sets (id, code, name, is_system, created_at, updated_at)
           values (?, ?, '{"en-US":"SV170"}'::jsonb, false, now(), now())`,
          [attributeSetId, `sv170_${run}`],
        );
        sets.push(attributeSetId);
      }
      const key = `${input.key}_${run.replace(/-/g, '')}`;
      const created = await createAttributeFixture(h().em().fork(), {
        key,
        label: { 'en-US': input.key },
        labelDefault: input.key,
        valueType: input.valueType as never,
        scopable: input.scopable ?? false,
        isRequired: input.isRequired ?? false,
        ...(input.options ? { options: input.options.map((value) => ({ value })) } : {}),
      });
      await conn().execute(
        `insert into attribute_set_attributes (attribute_set_id, custom_field_definition_id, position) values (?, ?, 0)`,
        [attributeSetId, (created.definition as { id: string }).id],
      );
      return key;
    },
    async product(input = {}) {
      const res = await h().app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        ...ADMIN,
        payload: {
          sku: `SV170-${run}-${products.length}`,
          type: input.type ?? 'simple',
          name: input.name ?? 'Drill X',
          description: input.description === undefined ? 'Global description' : input.description,
          categoryIds: [],
          ...(attributeSetId ? { attributeSetId } : {}),
          attributeValues: input.attributeValues ?? {},
          visibility: 'public',
          status: 'active',
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      products.push(id);
      for (const channelId of input.channels ?? []) {
        await conn().execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, id]);
      }
      return id;
    },
    readRaw(productId, scope = {}, who = ADMIN) {
      return h().app.inject({ method: 'GET', url: `${url(productId)}${qs(scope)}`, ...who });
    },
    async read(productId, scope = {}, who = ADMIN) {
      const res = await fixture.readRaw(productId, scope, who);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as ScopedValuesResponse).data;
    },
    async put(productId, scope, changes, options = {}) {
      const version = options.version ?? (await fixture.read(productId, scope.channelId ? { channelId: scope.channelId } : {})).version;
      return h().app.inject({
        method: 'PUT',
        url: url(productId),
        ...(options.who ?? ADMIN),
        payload: { scope, version, changes } as object,
      });
    },
    async save(productId, scope, changes) {
      const res = await fixture.put(productId, scope, changes);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as ScopedValuesResponse).data;
    },
    async media(productId) {
      const asset = async (kind: string, mime: string) => {
        const id = randomUUID();
        await conn().execute(
          `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
           values (?, ?, 'file.bin', ?, 1024, ?, now(), now())`,
          [id, kind, mime, `https://cdn.test/sv170/${id}`],
        );
        assets.push(id);
        return id;
      };
      const item = async (position: number) => {
        const id = randomUUID();
        await conn().execute(
          `insert into gallery_items (id, product_id, asset_id, position, alt_text, hidden, created_at, updated_at)
           values (?, ?, ?, ?, ?, false, now(), now())`,
          [id, productId, await asset('image', 'image/jpeg'), position, `Alt ${position}`],
        );
        return id;
      };
      const first = await item(0);
      const second = await item(1);
      await conn().execute(`insert into gallery_item_labels (gallery_item_id, label, product_id) values (?, 'base_image', ?)`, [first, productId]);
      const typeId = randomUUID();
      await conn().execute(
        `insert into attachment_types (id, code, name, position, created_at, updated_at) values (?, ?, '{"en-US":"Doc"}'::jsonb, 0, now(), now())`,
        [typeId, `sv170_${run}_${types.length}`],
      );
      types.push(typeId);
      const attachment = randomUUID();
      await conn().execute(
        `insert into product_attachments (id, product_id, asset_id, attachment_type_id, name, description, position, hidden, created_at, updated_at)
         values (?, ?, ?, ?, 'Data sheet', 'Specs', 0, false, now(), now())`,
        [attachment, productId, await asset('pdf', 'application/pdf'), typeId],
      );
      const unit = randomUUID();
      await conn().execute(
        `insert into product_packaging_units (id, product_id, name, base_quantity, position, is_default, created_at, updated_at)
         values (?, ?, 'Carton', 12, 0, false, now(), now())`,
        [unit, productId],
      );
      return { items: [first, second], attachment, unit };
    },
    async sql(statement, params = []) {
      return conn().execute(statement, params) as Promise<never>;
    },
    async cleanup() {
      for (const id of products) await conn().execute(`delete from products where id = ?`, [id]);
      for (const id of channels) await conn().execute(`delete from sales_channels where id = ?`, [id]);
      for (const id of sets) await conn().execute(`delete from attribute_sets where id = ?`, [id]);
      for (const id of assets) await conn().execute(`delete from assets where id = ?`, [id]);
      for (const id of types) await conn().execute(`delete from attachment_types where id = ?`, [id]);
    },
  };
  return fixture;
}
