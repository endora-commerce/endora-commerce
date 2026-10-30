import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  Migration20261030T113855CatalogScopeModelTexts,
  Migration20261030T113859CatalogScopeModelOrderRules,
  Migration20261030T113904CatalogScopeModelUrlKeys,
  Migration20261030T113908CatalogScopeModelMedia,
} from '@endora-commerce/mod-catalog/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/data-model.md` §1–§7, research R18, R22;
 * FR-020, FR-026, SC-002, US2 #7) — the four catalog migrations of the three-level scope model,
 * run on a database holding 163-model rows.
 *
 * The migrations have already run against the template, so each test first runs their `down`
 * in reverse order (a structure-only `down`: it restores the 163 shape and none of its data),
 * seeds the rows `up` meets on a database deployed before 168, and runs every `up` in order.
 * Everything happens in **one transaction the test rolls back** (PostgreSQL DDL is
 * transactional), as `product-status-drop-draft-migration.test.ts` does. The statements come
 * off the shipped classes rather than being copied here.
 */
type MigrationClass = new (...args: never[]) => {
  up(): Promise<void>;
  down(): Promise<void>;
  getQueries(): unknown[];
};

const ORDER: MigrationClass[] = [
  Migration20261030T113855CatalogScopeModelTexts,
  Migration20261030T113859CatalogScopeModelOrderRules,
  Migration20261030T113904CatalogScopeModelUrlKeys,
  Migration20261030T113908CatalogScopeModelMedia,
] as unknown as MigrationClass[];

describe('catalog scope model migrations (168 T015)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  async function run(Class: MigrationClass, direction: 'up' | 'down'): Promise<void> {
    const m = new (Class as unknown as new (driver: unknown, config: unknown) => InstanceType<MigrationClass>)(
      em.getDriver(),
      em.config,
    );
    await m[direction]();
    for (const query of m.getQueries()) await em.execute(query as unknown as string);
    em.clear();
  }
  const downAll = async () => {
    for (const Class of [...ORDER].reverse()) await run(Class, 'down');
  };
  const upAll = async () => {
    for (const Class of ORDER) await run(Class, 'up');
  };

  const rows = <T>(sql: string, params: unknown[] = []): Promise<T[]> => em.execute(sql, params) as Promise<T[]>;

  async function column(table: string, name: string): Promise<{ data_type: string; is_nullable: string } | undefined> {
    const [row] = await rows<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema = current_schema() and table_name = ? and column_name = ?`,
      [table, name],
    );
    return row;
  }
  async function tableExists(table: string): Promise<boolean> {
    const [row] = await rows<{ n: string }>(
      `select count(*)::text as n from information_schema.tables where table_schema = current_schema() and table_name = ?`,
      [table],
    );
    return row!.n === '1';
  }
  async function indexExists(name: string): Promise<boolean> {
    const [row] = await rows<{ n: string }>(`select count(*)::text as n from pg_indexes where indexname = ?`, [name]);
    return row!.n === '1';
  }
  async function constraintType(name: string): Promise<string | undefined> {
    const [row] = await rows<{ contype: string }>(`select contype from pg_constraint where conname = ?`, [name]);
    return row?.contype;
  }
  async function expectRefused(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
    await em.execute('savepoint t015');
    await expect(em.execute(sql, params)).rejects.toThrow(pattern);
    await em.execute('rollback to savepoint t015');
  }

  async function channel(): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "sales_channels" ("id", "code", "name", "default_language", "languages", "default_currency", "created_at", "updated_at")
       values (?, ?, '{"en-US":"T015"}'::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, 'PLN', now(), now())`,
      [id, `t015-${id.slice(0, 8)}`],
    );
    return id;
  }
  async function asset(kind: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "assets"
         ("id", "kind", "filename", "mime_type", "size_bytes", "storage_url", "visibility",
          "storage_backend", "storage_locator", "created_at", "updated_at")
       values (?, ?, ?, 'application/octet-stream', 2048, ?, 'public', 'local', ?, now(), now())`,
      [id, kind, `${id}.bin`, `/media/${id}.bin`, `t015/${id}.bin`],
    );
    return id;
  }
  async function product(sku: string, name: string, description: string, attributeValues = '{}'): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "attribute_values", "created_at", "updated_at")
       values (?, ?, ?, 'simple', 'active', ?::jsonb, ?::jsonb, ?::jsonb, now(), now())`,
      [id, sku, sku.toLowerCase(), name, description, attributeValues],
    );
    return id;
  }
  async function attribute(key: string, flags: { channel: boolean; language: boolean }): Promise<void> {
    const definitionId = randomUUID();
    await em.execute(
      `insert into "custom_field_definitions" ("id", "entity_type", "key", "label_default", "value_type", "created_at", "updated_at")
       values (?, 'product', ?, ?, 'text', now(), now())`,
      [definitionId, key, key],
    );
    await em.execute(
      `insert into "product_attributes" ("id", "custom_field_definition_id", "channel_scoped", "language_scoped", "created_at", "updated_at")
       values (?, ?, ?, ?, now(), now())`,
      [randomUUID(), definitionId, flags.channel, flags.language],
    );
  }

  /** A 163-model database: every row kind the four migrations convert or drop. */
  async function seed163() {
    const c = await channel();
    const sfx = randomUUID().slice(0, 6).toUpperCase();
    await attribute(`t015_colour_${sfx.toLowerCase()}`, { channel: true, language: true });
    await attribute(`t015_size_${sfx.toLowerCase()}`, { channel: true, language: false });
    const colour = `t015_colour_${sfx.toLowerCase()}`;
    const size = `t015_size_${sfx.toLowerCase()}`;
    const drill = await product(
      `T015-DRILL-${sfx}`,
      '{"de-DE":"Bohrer","pl-PL":"Wiertarka","en-US":"Drill"}',
      '{"pl-PL":"Opis","de-DE":"Beschreibung"}',
      JSON.stringify({ [colour]: { 'pl-PL': 'czerwony', 'de-DE': 'rot' }, [size]: 3 }),
    );
    const polish = await product(`T015-PL-${sfx}`, '{"pl-PL":"Tylko polski","en-US":""}', '{}');
    const scalar = await product(`T015-SCALAR-${sfx}`, '"Plain name"', '"Plain description"');
    const empty = await product(`T015-EMPTY-${sfx}`, '{}', '{}');

    // product_value_overrides: a wrapped row and an unwrapped one.
    await em.execute(
      `insert into "product_value_overrides" ("id", "product_id", "attribute_key", "channel_id", "language_code", "value", "created_at", "updated_at")
       values (?, ?, 'name', ?, 'pl-PL', '{"v":"Wiertarka B2B"}'::jsonb, now(), now()),
              (?, ?, 'description', ?, null, '"unwrapped"'::jsonb, now(), now())`,
      [randomUUID(), drill, c, randomUUID(), drill, c],
    );
    // 163 channel rows with a minimum of 5, 1 and none.
    await em.execute(
      `insert into "product_channel_scopes" ("product_id", "sales_channel_id", "min_order_quantity", "created_at", "updated_at")
       values (?, ?, 5, now(), now()), (?, ?, 1, now(), now()), (?, ?, null, now(), now())`,
      [drill, c, polish, c, scalar, c],
    );
    // 163 language keys, channel × language keys and redirects.
    await em.execute(
      `insert into "product_url_keys" ("id", "product_id", "language_code", "sales_channel_id", "key", "created_at", "updated_at")
       values (?, ?, 'de-DE', null, ?, now(), now()), (?, ?, 'pl-PL', ?, ?, now(), now())`,
      [randomUUID(), drill, `bohrer-${sfx.toLowerCase()}`, randomUUID(), drill, c, `wiertarka-${sfx.toLowerCase()}`],
    );
    await em.execute(
      `insert into "product_url_redirects" ("id", "product_id", "language_code", "key", "created_at")
       values (?, ?, null, ?, now()), (?, ?, 'de-DE', ?, now())`,
      [randomUUID(), drill, `old-drill-${sfx.toLowerCase()}`, randomUUID(), drill, `alter-bohrer-${sfx.toLowerCase()}`],
    );
    // Gallery: an alt-text map, a channel role holder and a channel-hidden item.
    const assetId = await asset('image');
    const item = randomUUID();
    await em.execute(
      `insert into "gallery_items" ("id", "product_id", "asset_id", "position", "alt_text", "created_at", "updated_at")
       values (?, ?, ?, 0, '{"pl-PL":"Wiertarka z boku","en-US":"Drill, side"}'::jsonb, now(), now())`,
      [item, drill, assetId],
    );
    await em.execute(
      `insert into "gallery_item_channel_labels" ("product_id", "sales_channel_id", "label", "gallery_item_id") values (?, ?, 'base_image', ?)`,
      [drill, c, item],
    );
    await em.execute(
      `insert into "gallery_item_channel_hidden" ("gallery_item_id", "sales_channel_id", "product_id") values (?, ?, ?)`,
      [item, c, drill],
    );
    // An attachment and a packaging unit with translation maps; a channel-hidden attachment.
    const typeId = randomUUID();
    await em.execute(
      `insert into "attachment_types" ("id", "code", "name", "created_at", "updated_at") values (?, ?, '{"en-US":"Sheet"}'::jsonb, now(), now())`,
      [typeId, `t015-${sfx.toLowerCase()}`],
    );
    const attachment = randomUUID();
    await em.execute(
      `insert into "product_attachments" ("id", "product_id", "asset_id", "attachment_type_id", "name", "position", "name_translations", "description_translations", "created_at", "updated_at")
       values (?, ?, ?, ?, 'Data sheet', 0, '{"pl-PL":"Karta"}'::jsonb, '{}'::jsonb, now(), now())`,
      [attachment, drill, await asset('pdf'), typeId],
    );
    await em.execute(
      `insert into "product_attachment_channel_hidden" ("attachment_id", "sales_channel_id", "product_id") values (?, ?, ?)`,
      [attachment, c, drill],
    );
    const unit = randomUUID();
    await em.execute(
      `insert into "product_packaging_units" ("id", "product_id", "name", "base_quantity", "position", "is_default", "name_translations", "created_at", "updated_at")
       values (?, ?, 'Carton', 12, 0, false, '{"pl-PL":"Karton"}'::jsonb, now(), now())`,
      [unit, drill],
    );
    // An editor preference in the 163 encoding (`null` language = the primary admin language).
    const [admin] = await rows<{ id: string }>(`select "id" from "admin_users" limit 1`);
    if (admin) {
      await em.execute(
        `insert into "product_editor_preferences" ("admin_user_id", "product_id", "last_channel_id", "last_language_code", "updated_at")
         values (?, ?, null, 'pl-PL', now())`,
        [admin.id, drill],
      );
    }
    return { c, drill, polish, scalar, empty, colour, size, item, attachment, unit, sfx };
  }

  async function productRow(id: string) {
    const [row] = await rows<{ name: string; description: string | null; attribute_values: Record<string, unknown>; scope_version: string; admin_name_key: string }>(
      `select "name", "description", "attribute_values", "scope_version"::text as scope_version, "admin_name_key" from "products" where "id" = ?`,
      [id],
    );
    return row!;
  }

  it('converts the texts to Global strings, collapses language maps and adds scope_version (§1–§3)', async () => {
    await downAll();
    const s = await seed163();
    await upAll();

    expect(await column('products', 'name')).toEqual({ data_type: 'text', is_nullable: 'NO' });
    expect(await column('products', 'description')).toEqual({ data_type: 'text', is_nullable: 'YES' });
    const drill = await productRow(s.drill);
    expect(drill.name).toBe('Drill');
    // No en-US value: the first non-empty value in jsonb key order (shorter keys first).
    expect(drill.description).toBe('Beschreibung');
    expect(drill.attribute_values).toEqual({ [s.colour]: 'rot', [s.size]: 3 });
    expect(drill.scope_version).toBe('0');
    expect(drill.admin_name_key).toBe('drill');
    expect((await productRow(s.polish)).name).toBe('Tylko polski');
    expect((await productRow(s.polish)).description).toBeNull();
    expect(await productRow(s.scalar)).toMatchObject({ name: 'Plain name', description: 'Plain description' });
    // Nothing anywhere: the SKU.
    expect((await productRow(s.empty)).name).toBe(`T015-EMPTY-${s.sfx}`);

    // The admin keys: one pair over the Global name, the per-language pair gone (data-model §1).
    for (const gone of ['admin_name_key_en', 'admin_name_key_pl', 'admin_search_key_en', 'admin_search_key_pl']) {
      expect(await column('products', gone)).toBeUndefined();
    }
    expect(await indexExists('products_admin_order')).toBe(true);
    expect(await indexExists('products_admin_search_trgm')).toBe(true);
    expect(await indexExists('products_admin_order_en')).toBe(false);
  });

  it('replaces the two attribute flags with scopable, wraps override values and guards them (§2, §3)', async () => {
    await downAll();
    const s = await seed163();
    await upAll();

    expect(await column('product_attributes', 'channel_scoped')).toBeUndefined();
    expect(await column('product_attributes', 'language_scoped')).toBeUndefined();
    const flags = await rows<{ key: string; scopable: boolean }>(
      `select d."key", pa."scopable" from "product_attributes" pa join "custom_field_definitions" d on d."id" = pa."custom_field_definition_id"
        where d."key" in (?, ?) order by d."key"`,
      [s.colour, s.size],
    );
    expect(flags).toEqual([
      { key: s.colour, scopable: true },
      { key: s.size, scopable: true },
    ]);
    const values = await rows<{ attribute_key: string; value: unknown }>(
      `select "attribute_key", "value" from "product_value_overrides" where "product_id" = ? order by "attribute_key"`,
      [s.drill],
    );
    expect(values).toEqual([
      { attribute_key: 'description', value: { v: 'unwrapped' } },
      { attribute_key: 'name', value: { v: 'Wiertarka B2B' } },
    ]);
    await expectRefused(
      `insert into "product_value_overrides" ("id", "product_id", "attribute_key", "channel_id", "language_code", "value", "created_at", "updated_at")
       values (?, ?, 'name', ?, 'de-DE', '"bare"'::jsonb, now(), now())`,
      [randomUUID(), s.drill, s.c],
      /check constraint/,
    );
    expect(await indexExists('product_value_overrides_product_attr_idx')).toBe(true);
  });

  it('empties the editor preferences and refuses a language without a channel (§10)', async () => {
    await downAll();
    const s = await seed163();
    await upAll();
    const [count] = await rows<{ n: string }>(`select count(*)::text as n from "product_editor_preferences"`);
    expect(count!.n).toBe('0');
    const [admin] = await rows<{ id: string }>(`select "id" from "admin_users" limit 1`);
    if (admin) {
      await expectRefused(
        `insert into "product_editor_preferences" ("admin_user_id", "product_id", "last_channel_id", "last_language_code", "updated_at")
         values (?, ?, null, 'pl-PL', now())`,
        [admin.id, s.drill],
        /check constraint/,
      );
    }
  });

  it('turns the 163 minimum order quantity into the override flag, after the backfill (§4)', async () => {
    await downAll();
    const s = await seed163();
    await upAll();
    const moq = await rows<{ product_id: string; overridden: boolean; moq: number | null }>(
      `select "product_id", "min_order_quantity_overridden" as overridden, "min_order_quantity" as moq
         from "product_channel_scopes" where "sales_channel_id" = ?`,
      [s.c],
    );
    const by = new Map(moq.map((row) => [row.product_id, row]));
    expect(by.get(s.drill)).toMatchObject({ overridden: true, moq: 5 });
    // 163's `1` meant "no minimum in this channel": now an override holding none.
    expect(by.get(s.polish)).toMatchObject({ overridden: true, moq: null });
    expect(by.get(s.scalar)).toMatchObject({ overridden: false, moq: null });
    await expectRefused(
      `update "product_channel_scopes" set "min_order_quantity_overridden" = false, "min_order_quantity" = 3
        where "product_id" = ? and "sales_channel_id" = ?`,
      [s.drill, s.c],
      /check constraint/,
    );
  });

  it('recreates URL keys and redirects per (channel, language) with the exclusion constraint (§5)', async () => {
    await downAll();
    const s = await seed163();
    await upAll();
    for (const table of ['product_url_keys', 'product_url_redirects']) {
      const [n] = await rows<{ n: string }>(`select count(*)::text as n from "${table}" where "product_id" = ?`, [s.drill]);
      expect(n!.n, table).toBe('0');
    }
    expect(await column('product_url_keys', 'sales_channel_id')).toMatchObject({ is_nullable: 'NO' });
    expect(await column('product_url_keys', 'language_code')).toMatchObject({ is_nullable: 'YES' });
    expect(await column('product_url_redirects', 'sales_channel_id')).toMatchObject({ is_nullable: 'NO' });
    expect(await column('product_url_redirects', 'language_code')).toMatchObject({ is_nullable: 'NO' });
    expect(await constraintType('product_url_keys_one_product_per_channel_key')).toBe('x');
    for (const index of [
      'product_url_keys_channel_key_unique',
      'product_url_keys_channel_language_key_unique',
      'product_url_keys_product_channel_unique',
      'product_url_keys_product_channel_language_unique',
      'product_url_keys_product_idx',
      'product_url_keys_key_idx',
      'product_url_redirects_channel_language_key_unique',
      'product_url_redirects_product_idx',
    ]) {
      expect(await indexExists(index), index).toBe(true);
    }

    // One product per channel key across all languages: another product's key at another
    // language of the same channel is refused by the database; the same product may repeat it.
    const insertKey = `insert into "product_url_keys" ("id", "product_id", "sales_channel_id", "language_code", "key", "created_at", "updated_at")
                       values (?, ?, ?, ?, ?, now(), now())`;
    await em.execute(insertKey, [randomUUID(), s.drill, s.c, 'pl-PL', 'shared-key']);
    await em.execute(insertKey, [randomUUID(), s.drill, s.c, 'de-DE', 'shared-key']);
    await expectRefused(insertKey, [randomUUID(), s.polish, s.c, null, 'shared-key'], /exclusion constraint|conflicting key/);
  });

  it('moves the media scopes to the override tables with composite FKs and type checks (§6, §7)', async () => {
    await downAll();
    const s = await seed163();
    await upAll();

    expect(await column('gallery_items', 'alt_text')).toMatchObject({ data_type: 'text', is_nullable: 'YES' });
    const [item] = await rows<{ alt_text: string | null; hidden: boolean }>(
      `select "alt_text", "hidden" from "gallery_items" where "id" = ?`,
      [s.item],
    );
    expect(item).toEqual({ alt_text: 'Drill, side', hidden: false });
    expect(await column('product_attachments', 'hidden')).toMatchObject({ data_type: 'boolean' });
    for (const [table, col] of [
      ['product_attachments', 'name_translations'],
      ['product_attachments', 'description_translations'],
      ['product_packaging_units', 'name_translations'],
    ] as const) {
      expect(await column(table, col), `${table}.${col}`).toBeUndefined();
    }
    for (const gone of ['gallery_item_channel_labels', 'gallery_item_channel_hidden', 'product_attachment_channel_hidden']) {
      expect(await tableExists(gone), gone).toBe(false);
    }
    for (const table of [
      'gallery_item_scope_overrides',
      'gallery_role_scope_overrides',
      'product_attachment_scope_overrides',
      'product_packaging_unit_scope_overrides',
    ]) {
      expect(await tableExists(table), table).toBe(true);
    }
    for (const index of [
      'gallery_item_scope_overrides_item_idx',
      'gallery_item_scope_overrides_product_idx',
      'gallery_role_scope_overrides_product_idx',
      'gallery_role_scope_overrides_item_idx',
      'product_attachment_scope_overrides_attachment_idx',
      'product_attachment_scope_overrides_product_idx',
      'product_packaging_unit_scope_overrides_unit_idx',
      'product_packaging_unit_scope_overrides_product_idx',
    ]) {
      expect(await indexExists(index), index).toBe(true);
    }

    const insertOverride = `insert into "gallery_item_scope_overrides" ("id", "gallery_item_id", "product_id", "sales_channel_id", "language_code", "field", "value", "created_at", "updated_at")
                            values (?, ?, ?, ?, ?, ?, ?::jsonb, now(), now())`;
    await em.execute(insertOverride, [randomUUID(), s.item, s.drill, s.c, 'pl-PL', 'alt_text', '{"v":null}']);
    // An override can never point at another product's image (composite FK, R22).
    await expectRefused(insertOverride, [randomUUID(), s.item, s.polish, s.c, null, 'alt_text', '{"v":"x"}'], /foreign key/);
    // Per-field type checks: hidden is a boolean, never empty; alt text is a text or empty.
    await expectRefused(insertOverride, [randomUUID(), s.item, s.drill, s.c, null, 'hidden', '{"v":null}'], /check constraint/);
    await expectRefused(insertOverride, [randomUUID(), s.item, s.drill, s.c, 'de-DE', 'alt_text', '{"v":5}'], /check constraint/);
    await expectRefused(insertOverride, [randomUUID(), s.item, s.drill, s.c, 'de-DE', 'caption', '{"v":"x"}'], /check constraint/);

    // The role holder is nullable (the empty override) and composite.
    const insertRole = `insert into "gallery_role_scope_overrides" ("id", "product_id", "sales_channel_id", "language_code", "label", "gallery_item_id", "created_at", "updated_at")
                        values (?, ?, ?, ?, 'thumbnail', ?, now(), now())`;
    await em.execute(insertRole, [randomUUID(), s.drill, s.c, null, null]);
    await expectRefused(insertRole, [randomUUID(), s.polish, s.c, 'pl-PL', s.item], /foreign key/);

    // Removing the subject removes its overrides (cascade), so the role inherits again.
    await em.execute(insertRole, [randomUUID(), s.drill, s.c, 'pl-PL', s.item]);
    await em.execute(`delete from "gallery_items" where "id" = ?`, [s.item]);
    const [left] = await rows<{ n: string }>(
      `select (select count(*) from "gallery_item_scope_overrides" where "gallery_item_id" = ?)
            + (select count(*) from "gallery_role_scope_overrides" where "gallery_item_id" = ?) as n`,
      [s.item, s.item],
    );
    expect(Number(left!.n)).toBe(0);

    const insertAttachment = `insert into "product_attachment_scope_overrides" ("id", "attachment_id", "product_id", "sales_channel_id", "language_code", "field", "value", "created_at", "updated_at")
                              values (?, ?, ?, ?, ?, ?, ?::jsonb, now(), now())`;
    await em.execute(insertAttachment, [randomUUID(), s.attachment, s.drill, s.c, null, 'hidden', '{"v":true}']);
    await expectRefused(insertAttachment, [randomUUID(), s.attachment, s.polish, s.c, null, 'name', '{"v":"x"}'], /foreign key/);
    const insertUnit = `insert into "product_packaging_unit_scope_overrides" ("id", "packaging_unit_id", "product_id", "sales_channel_id", "language_code", "field", "value", "created_at", "updated_at")
                        values (?, ?, ?, ?, ?, 'name', ?::jsonb, now(), now())`;
    await em.execute(insertUnit, [randomUUID(), s.unit, s.drill, s.c, 'pl-PL', '{"v":"Karton"}']);
    await expectRefused(insertUnit, [randomUUID(), s.unit, s.drill, s.c, 'de-DE', '{"v":false}'], /check constraint/);
  });

  it('is a no-op when run a second time', async () => {
    await downAll();
    const s = await seed163();
    await upAll();
    const before = await productRow(s.drill);
    await upAll();
    expect(await productRow(s.drill)).toEqual(before);
    const [moq] = await rows<{ overridden: boolean; moq: number | null }>(
      `select "min_order_quantity_overridden" as overridden, "min_order_quantity" as moq
         from "product_channel_scopes" where "product_id" = ? and "sales_channel_id" = ?`,
      [s.polish, s.c],
    );
    expect(moq).toEqual({ overridden: true, moq: null });
  });
});
