import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T011 (feature 061) — SC-001 parity test for migration
 * `102_attributes_on_custom_fields.ts`.
 *
 * Strategy (the shared test DB is fully migrated by global-setup, so the test
 * drives the migrator itself):
 *   1. Revert migration 102 (guarded: the latest executed migration MUST be
 *      102, otherwise the test aborts before touching anything).
 *   2. Seed legacy-shaped fixtures via raw SQL — every legacy value type
 *      (string / number / price / boolean / date / enum / select /
 *      multiselect), rich options, all 12 catalog flags, set membership.
 *   3. Re-apply 102 and assert definition/option/membership parity plus the
 *      extension reshape (SC-001, data-model.md §3).
 *   4. Revert again and assert `down()` restores the legacy shape.
 *   5. Assert the loud abort on a reserved-key collision (`name`).
 *   6. Leave the DB fully migrated for the rest of the suite.
 */

const LEGACY_ATTRIBUTES: Array<{
  id: string;
  key: string;
  valueType: string;
  label: Record<string, string>;
  labelDefault: string;
  isRequired: boolean;
  createdAt: string;
  flags?: Partial<Record<string, boolean | number>>;
}> = [
  {
    id: randomUUID(),
    key: 'mig_color',
    valueType: 'enum',
    label: { 'en-US': 'Color', 'pl-PL': 'Kolor' },
    labelDefault: 'Color',
    isRequired: true,
    createdAt: '2024-01-01T10:00:00Z',
    flags: {
      is_searchable: true,
      is_filterable: true,
      is_variant_axis: true,
      is_comparable: true,
      quick_searchable: true,
      is_promo_rule: true,
      filter_position: 7,
      is_visible_on_product_page: true,
      channel_scoped: true,
      language_scoped: true,
      mass_editable: true,
    },
  },
  {
    id: randomUUID(),
    key: 'mig_finish',
    valueType: 'select',
    label: { 'en-US': 'Finish' },
    labelDefault: 'Finish',
    isRequired: false,
    createdAt: '2024-01-01T11:00:00Z',
  },
  {
    id: randomUUID(),
    key: 'mig_tags',
    valueType: 'multiselect',
    label: { 'en-US': 'Tags' },
    labelDefault: 'Tags',
    isRequired: false,
    createdAt: '2024-01-01T12:00:00Z',
  },
  {
    id: randomUUID(),
    key: 'mig_notes',
    valueType: 'string',
    label: { 'en-US': 'Notes' },
    labelDefault: 'Notes',
    isRequired: false,
    createdAt: '2024-01-02T10:00:00Z',
  },
  {
    id: randomUUID(),
    key: 'mig_weight',
    valueType: 'number',
    label: { 'en-US': 'Weight' },
    labelDefault: 'Weight',
    isRequired: false,
    createdAt: '2024-01-03T10:00:00Z',
    flags: { display_as_slider: true },
  },
  {
    id: randomUUID(),
    key: 'mig_msrp',
    valueType: 'price',
    label: { 'en-US': 'MSRP' },
    labelDefault: 'MSRP',
    isRequired: false,
    createdAt: '2024-01-04T10:00:00Z',
  },
  {
    id: randomUUID(),
    key: 'mig_active',
    valueType: 'boolean',
    label: { 'en-US': 'Active' },
    labelDefault: 'Active',
    isRequired: false,
    createdAt: '2024-01-05T10:00:00Z',
  },
  {
    id: randomUUID(),
    key: 'mig_release',
    valueType: 'date',
    label: { 'en-US': 'Release date' },
    labelDefault: 'Release date',
    isRequired: false,
    createdAt: '2024-01-06T10:00:00Z',
  },
];

const COLOR = LEGACY_ATTRIBUTES[0]!;
const FINISH = LEGACY_ATTRIBUTES[1]!;
const TAGS = LEGACY_ATTRIBUTES[2]!;

const LEGACY_OPTIONS: Array<{
  attributeId: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  isDefault: boolean;
  sortOrder: number;
}> = [
  { attributeId: COLOR.id, value: 'red', label: { 'pl-PL': 'Czerwony' }, labelDefault: 'Red', isDefault: true, sortOrder: 0 },
  { attributeId: COLOR.id, value: 'blue', label: {}, labelDefault: 'Blue', isDefault: false, sortOrder: 1 },
  { attributeId: FINISH.id, value: 'matte', label: {}, labelDefault: 'Matte', isDefault: false, sortOrder: 5 },
  { attributeId: TAGS.id, value: 'eco', label: { 'en-US': 'Eco' }, labelDefault: 'Eco', isDefault: true, sortOrder: 0 },
  { attributeId: TAGS.id, value: 'promo', label: {}, labelDefault: 'Promo', isDefault: true, sortOrder: 1 },
];

const DEFAULT_SET_ID = 'defa0017-0000-4000-8000-000000000000';

const EXPECTED_CF_TYPE: Record<string, string> = {
  mig_color: 'select',
  mig_finish: 'select',
  mig_tags: 'multiselect',
  mig_notes: 'text',
  mig_weight: 'number',
  mig_msrp: 'number',
  mig_active: 'boolean',
  mig_release: 'date',
};

describe('migration 102 — attributes on custom fields (SC-001 parity)', () => {
  let db: TestDb;

  const conn = () => db.orm.em.getConnection();

  async function latestExecutedMigration(): Promise<string | null> {
    const rows = await conn().execute<Array<{ name: string }>>(
      `select "name" from "mikro_orm_migrations" order by "id" desc limit 1`,
    );
    return rows[0]?.name ?? null;
  }

  async function revert102(): Promise<void> {
    const latest = await latestExecutedMigration();
    expect(
      latest,
      'expected migration 102 to be the latest executed migration — refusing to down() anything else',
    ).toBe('Migration102AttributesOnCustomFields');
    await db.orm.getMigrator().down();
  }

  async function seedLegacyFixtures(): Promise<void> {
    // Clean slate for the tables involved (legacy shape at this point).
    await conn().execute(
      `truncate table "attribute_set_attributes", "attribute_options", "product_attributes" restart identity cascade`,
    );
    await conn().execute(
      `delete from "custom_field_definitions" where "entity_type" = 'product'`,
    );
    for (const a of LEGACY_ATTRIBUTES) {
      const flags = a.flags ?? {};
      await conn().execute(
        `insert into "product_attributes"
           ("id", "key", "label", "label_default", "value_type", "is_required",
            "is_searchable", "is_filterable", "is_variant_axis", "display_as_slider",
            "is_comparable", "quick_searchable", "is_promo_rule", "filter_position",
            "is_visible_on_product_page", "channel_scoped", "language_scoped",
            "mass_editable", "created_at", "updated_at")
         values (?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          a.id,
          a.key,
          JSON.stringify(a.label),
          a.labelDefault,
          a.valueType,
          a.isRequired,
          flags['is_searchable'] ?? false,
          flags['is_filterable'] ?? false,
          flags['is_variant_axis'] ?? false,
          flags['display_as_slider'] ?? false,
          flags['is_comparable'] ?? false,
          flags['quick_searchable'] ?? false,
          flags['is_promo_rule'] ?? false,
          flags['filter_position'] ?? 0,
          flags['is_visible_on_product_page'] ?? false,
          flags['channel_scoped'] ?? false,
          flags['language_scoped'] ?? false,
          flags['mass_editable'] ?? false,
          a.createdAt,
          a.createdAt,
        ],
      );
    }
    for (const o of LEGACY_OPTIONS) {
      await conn().execute(
        `insert into "attribute_options"
           ("id", "attribute_id", "value", "label", "label_default", "is_default", "sort_order", "created_at", "updated_at")
         values (?, ?, ?, ?::jsonb, ?, ?, ?, now(), now())`,
        [randomUUID(), o.attributeId, o.value, JSON.stringify(o.label), o.labelDefault, o.isDefault, o.sortOrder],
      );
    }
    // Set membership on the system Default set (kept by test truncation policy).
    await conn().execute(
      `insert into "attribute_set_attributes" ("attribute_set_id", "product_attribute_id", "position")
       values (?, ?, 0), (?, ?, 1)`,
      [DEFAULT_SET_ID, COLOR.id, DEFAULT_SET_ID, FINISH.id],
    );
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    // Whatever happened above, leave the DB fully migrated for other files.
    await db.orm.getMigrator().up();
    await db.close();
  });

  it('re-applies migration 102 over legacy fixtures with full parity (SC-001)', async () => {
    await revert102();
    await seedLegacyFixtures();
    await db.orm.getMigrator().up();

    // --- Definitions: one per legacy attribute, content preserved.
    const defs = await conn().execute<
      Array<{
        id: string;
        key: string;
        label: Record<string, string>;
        label_default: string;
        value_type: string;
        required: boolean;
        sort_order: number;
        config: Record<string, unknown>;
      }>
    >(
      `select "id", "key", "label", "label_default", "value_type", "required", "sort_order", "config"
       from "custom_field_definitions" where "entity_type" = 'product' order by "sort_order" asc`,
    );
    expect(defs).toHaveLength(LEGACY_ATTRIBUTES.length);
    // Deterministic sort_order: ROW_NUMBER() over (created_at, key) − 1.
    const expectedOrder = [...LEGACY_ATTRIBUTES]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key))
      .map((a) => a.key);
    expect(defs.map((d) => d.key)).toEqual(expectedOrder);
    expect(defs.map((d) => d.sort_order)).toEqual(expectedOrder.map((_, i) => i));
    for (const legacy of LEGACY_ATTRIBUTES) {
      const def = defs.find((d) => d.key === legacy.key);
      expect(def, `definition for ${legacy.key}`).toBeDefined();
      expect(def!.label).toEqual(legacy.label);
      expect(def!.label_default).toBe(legacy.labelDefault);
      expect(def!.value_type).toBe(EXPECTED_CF_TYPE[legacy.key]);
      expect(def!.required).toBe(legacy.isRequired);
      expect(def!.config).toEqual({});
    }

    // --- Options: copied to custom_field_options, matched by (key, value).
    const options = await conn().execute<
      Array<{
        key: string;
        value: string;
        label: Record<string, string>;
        label_default: string;
        is_default: boolean;
        sort_order: number;
      }>
    >(
      `select cfd."key", cfo."value", cfo."label", cfo."label_default", cfo."is_default", cfo."sort_order"
       from "custom_field_options" cfo
       join "custom_field_definitions" cfd on cfd."id" = cfo."definition_id"
       where cfd."entity_type" = 'product'
       order by cfd."key", cfo."sort_order", cfo."value"`,
    );
    expect(options).toHaveLength(LEGACY_OPTIONS.length);
    const legacyKeyById = new Map(LEGACY_ATTRIBUTES.map((a) => [a.id, a.key]));
    for (const legacyOpt of LEGACY_OPTIONS) {
      const key = legacyKeyById.get(legacyOpt.attributeId)!;
      const migrated = options.find((o) => o.key === key && o.value === legacyOpt.value);
      expect(migrated, `option ${key}/${legacyOpt.value}`).toBeDefined();
      expect(migrated!.label).toEqual(legacyOpt.label);
      expect(migrated!.label_default).toBe(legacyOpt.labelDefault);
      expect(migrated!.is_default).toBe(legacyOpt.isDefault);
      expect(migrated!.sort_order).toBe(legacyOpt.sortOrder);
    }

    // --- Extension reshape: stable id, definition FK, refinements, flags.
    const extCols = await conn().execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'product_attributes'`,
    );
    const colSet = new Set(extCols.map((c) => c.column_name));
    for (const dropped of ['key', 'label', 'label_default', 'value_type', 'is_required']) {
      expect(colSet.has(dropped), `column "${dropped}" must be dropped`).toBe(false);
    }
    for (const added of ['custom_field_definition_id', 'select_display', 'numeric_kind']) {
      expect(colSet.has(added), `column "${added}" must exist`).toBe(true);
    }

    const extensions = await conn().execute<
      Array<{
        id: string;
        custom_field_definition_id: string;
        select_display: string | null;
        numeric_kind: string | null;
        is_searchable: boolean;
        is_filterable: boolean;
        is_variant_axis: boolean;
        display_as_slider: boolean;
        is_comparable: boolean;
        quick_searchable: boolean;
        is_promo_rule: boolean;
        filter_position: number;
        is_visible_on_product_page: boolean;
        channel_scoped: boolean;
        language_scoped: boolean;
        mass_editable: boolean;
      }>
    >(`select * from "product_attributes"`);
    expect(extensions).toHaveLength(LEGACY_ATTRIBUTES.length);
    const defIdByKey = new Map(defs.map((d) => [d.key, d.id]));
    for (const legacy of LEGACY_ATTRIBUTES) {
      const ext = extensions.find((e) => e.id === legacy.id);
      expect(ext, `extension row keeps legacy id for ${legacy.key}`).toBeDefined();
      expect(ext!.custom_field_definition_id).toBe(defIdByKey.get(legacy.key));
      const expectedSelectDisplay =
        legacy.valueType === 'enum' ? 'pill' : legacy.valueType === 'select' ? 'dropdown' : null;
      const expectedNumericKind =
        legacy.valueType === 'number' ? 'number' : legacy.valueType === 'price' ? 'price' : null;
      expect(ext!.select_display).toBe(expectedSelectDisplay);
      expect(ext!.numeric_kind).toBe(expectedNumericKind);
      const flags = legacy.flags ?? {};
      expect(ext!.is_searchable).toBe(flags['is_searchable'] ?? false);
      expect(ext!.is_filterable).toBe(flags['is_filterable'] ?? false);
      expect(ext!.is_variant_axis).toBe(flags['is_variant_axis'] ?? false);
      expect(ext!.display_as_slider).toBe(flags['display_as_slider'] ?? false);
      expect(ext!.is_comparable).toBe(flags['is_comparable'] ?? false);
      expect(ext!.quick_searchable).toBe(flags['quick_searchable'] ?? false);
      expect(ext!.is_promo_rule).toBe(flags['is_promo_rule'] ?? false);
      expect(ext!.filter_position).toBe(flags['filter_position'] ?? 0);
      expect(ext!.is_visible_on_product_page).toBe(flags['is_visible_on_product_page'] ?? false);
      expect(ext!.channel_scoped).toBe(flags['channel_scoped'] ?? false);
      expect(ext!.language_scoped).toBe(flags['language_scoped'] ?? false);
      expect(ext!.mass_editable).toBe(flags['mass_editable'] ?? false);
    }

    // --- Set membership: re-keyed to definition ids, positions preserved.
    const membership = await conn().execute<
      Array<{ attribute_set_id: string; custom_field_definition_id: string; position: number }>
    >(`select * from "attribute_set_attributes" order by "position" asc`);
    expect(membership).toEqual([
      {
        attribute_set_id: DEFAULT_SET_ID,
        custom_field_definition_id: defIdByKey.get('mig_color'),
        position: 0,
      },
      {
        attribute_set_id: DEFAULT_SET_ID,
        custom_field_definition_id: defIdByKey.get('mig_finish'),
        position: 1,
      },
    ]);

    // --- attribute_options is gone.
    const legacyTable = await conn().execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'attribute_options'`,
    );
    expect(legacyTable).toHaveLength(0);
  });

  it('down() restores the legacy shape (reversible migration)', async () => {
    await revert102();

    const cols = await conn().execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'product_attributes'`,
    );
    const colSet = new Set(cols.map((c) => c.column_name));
    for (const legacyCol of ['key', 'label', 'label_default', 'value_type', 'is_required']) {
      expect(colSet.has(legacyCol), `column "${legacyCol}" restored`).toBe(true);
    }
    for (const newCol of ['custom_field_definition_id', 'select_display', 'numeric_kind']) {
      expect(colSet.has(newCol), `column "${newCol}" dropped by down()`).toBe(false);
    }

    const attrs = await conn().execute<
      Array<{ id: string; key: string; value_type: string; is_required: boolean; label_default: string }>
    >(`select "id", "key", "value_type", "is_required", "label_default" from "product_attributes"`);
    expect(attrs).toHaveLength(LEGACY_ATTRIBUTES.length);
    for (const legacy of LEGACY_ATTRIBUTES) {
      const row = attrs.find((a) => a.id === legacy.id);
      expect(row, `legacy row for ${legacy.key}`).toBeDefined();
      expect(row!.key).toBe(legacy.key);
      expect(row!.value_type).toBe(legacy.valueType);
      expect(row!.is_required).toBe(legacy.isRequired);
      expect(row!.label_default).toBe(legacy.labelDefault);
    }

    const restoredOptions = await conn().execute<
      Array<{ attribute_id: string; value: string; is_default: boolean; sort_order: number }>
    >(`select "attribute_id", "value", "is_default", "sort_order" from "attribute_options"`);
    expect(restoredOptions).toHaveLength(LEGACY_OPTIONS.length);
    for (const legacyOpt of LEGACY_OPTIONS) {
      const restored = restoredOptions.find(
        (o) => o.attribute_id === legacyOpt.attributeId && o.value === legacyOpt.value,
      );
      expect(restored, `restored option ${legacyOpt.value}`).toBeDefined();
      expect(restored!.is_default).toBe(legacyOpt.isDefault);
      expect(restored!.sort_order).toBe(legacyOpt.sortOrder);
    }

    const membership = await conn().execute<
      Array<{ attribute_set_id: string; product_attribute_id: string; position: number }>
    >(`select * from "attribute_set_attributes" order by "position" asc`);
    expect(membership).toEqual([
      { attribute_set_id: DEFAULT_SET_ID, product_attribute_id: COLOR.id, position: 0 },
      { attribute_set_id: DEFAULT_SET_ID, product_attribute_id: FINISH.id, position: 1 },
    ]);

    // Product-host definitions and options are gone after down().
    const defsLeft = await conn().execute<Array<{ count: string }>>(
      `select count(*)::text as count from "custom_field_definitions" where "entity_type" = 'product'`,
    );
    expect(Number(defsLeft[0]?.count)).toBe(0);
  });

  it('aborts loudly on a reserved-key collision and rolls back atomically', async () => {
    // The previous test left the DB in the legacy shape with fixtures present.
    await conn().execute(
      `insert into "product_attributes"
         ("id", "key", "label", "label_default", "value_type", "is_required", "created_at", "updated_at")
       values (?, 'name', '{"en-US":"Name"}'::jsonb, 'Name', 'string', false, now(), now())`,
      [randomUUID()],
    );

    await expect(db.orm.getMigrator().up()).rejects.toThrow(/reserved|collid/i);

    // Atomic: still legacy shape, nothing partially migrated.
    const cols = await conn().execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'product_attributes' and column_name = 'key'`,
    );
    expect(cols).toHaveLength(1);
    const defsLeft = await conn().execute<Array<{ count: string }>>(
      `select count(*)::text as count from "custom_field_definitions" where "entity_type" = 'product'`,
    );
    expect(Number(defsLeft[0]?.count)).toBe(0);

    // Clean up the offending row; re-apply so the suite continues migrated.
    await conn().execute(`delete from "product_attributes" where "key" = 'name'`);
    await db.orm.getMigrator().up();
    const latest = await latestExecutedMigration();
    expect(latest).toBe('Migration102AttributesOnCustomFields');
  });
});
