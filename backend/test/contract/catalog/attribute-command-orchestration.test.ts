import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * T017 (feature 061) — attribute + option mutations run as catalog Commands
 * (Principle XIII):
 *
 *   - each mutation commits ONE transaction with exactly ONE audit row in the
 *     `catalog.attribute.*` / `catalog.attribute_option.*` action namespace;
 *   - the definition + extension pair stays consistent (total 1:1);
 *   - an induced failure rolls back atomically — no orphan definition, no
 *     audit row;
 *   - `attribute.updated.v1` keeps its legacy emission points (create + every
 *     attribute update; never on option CRUD);
 *   - a committed mutation invalidates the CF definitions cache so the generic
 *     admin surface sees the product-host definitions fresh.
 */
describe('attribute command orchestration (feature 061, T017)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function auditRows(action: string): Promise<AuditLogEntry[]> {
    return h.em().find(AuditLogEntry, { action });
  }

  async function definitionRow(key: string): Promise<{ id: string } | undefined> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `select "id" from "custom_field_definitions" where "entity_type" = 'product' and "key" = ?`,
        [key],
      )) as Array<{ id: string }>;
    return rows[0];
  }

  async function extensionRowByDefinition(definitionId: string): Promise<{ id: string } | undefined> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `select "id" from "product_attributes" where "custom_field_definition_id" = ?`,
        [definitionId],
      )) as Array<{ id: string }>;
    return rows[0];
  }

  let attributeId: string;
  let definitionId: string;

  it('create commits definition + extension with exactly one audit row and emits attribute.updated.v1', async () => {
    const events: Array<{ attributeKey: string }> = [];
    const off = h.eventBus.on('attribute.updated.v1', (payload) => {
      events.push(payload as unknown as { attributeKey: string });
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'orch_material',
        label: { 'en-US': 'Material' },
        labelDefault: 'Material',
        type: 'select',
        isSearchable: true,
        isFilterable: true,
        isVariantAxis: false,
        options: [
          { value: 'steel', labelDefault: 'Steel', isDefault: true },
          { value: 'brass', labelDefault: 'Brass' },
        ],
      },
      cookies: adminCookie,
    });
    off();
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { id: string; customFieldDefinitionId: string } };
    attributeId = body.data.id;
    definitionId = body.data.customFieldDefinitionId;

    // Definition + extension pair is consistent.
    const def = await definitionRow('orch_material');
    expect(def?.id).toBe(definitionId);
    const ext = await extensionRowByDefinition(definitionId);
    expect(ext?.id).toBe(attributeId);

    // Exactly one audit row in the catalog action namespace.
    const rows = await auditRows('catalog.attribute.create');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectType).toBe('product_attribute');
    expect(rows[0]!.objectId).toBe(attributeId);

    // Reindex trigger contract preserved: create emits once.
    expect(events).toHaveLength(1);
    expect(events[0]!.attributeKey).toBe('orch_material');
  });

  it('the committed create invalidates the CF definitions cache (product entity type)', async () => {
    // Warm the cache first via the generic admin surface, then assert the new
    // definition is visible (the command published an invalidation on commit).
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=product',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ key: string; id: string }> };
    const def = body.data.find((d) => d.key === 'orch_material');
    expect(def).toBeDefined();
    expect(def!.id).toBe(definitionId);
  });

  it('update commits one audit row and emits attribute.updated.v1', async () => {
    const events: unknown[] = [];
    const off = h.eventBus.on('attribute.updated.v1', (payload) => {
      events.push(payload);
    });
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${attributeId}`,
      payload: { isFilterable: false, labelDefault: 'Material (edited)' },
      cookies: adminCookie,
    });
    off();
    expect(res.statusCode).toBe(200);
    const rows = await auditRows('catalog.attribute.update');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectId).toBe(attributeId);
    expect(events).toHaveLength(1);

    // The generic surface sees the label change (cache invalidated on commit).
    const cf = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/custom-fields/definitions/${definitionId}`,
      cookies: adminCookie,
    });
    expect((cf.json() as { data: { labelDefault: string } }).data.labelDefault).toBe(
      'Material (edited)',
    );
  });

  it('option mutations commit one audit row each and do NOT emit attribute.updated.v1', async () => {
    const events: unknown[] = [];
    const off = h.eventBus.on('attribute.updated.v1', (payload) => {
      events.push(payload);
    });

    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options`,
      payload: { value: 'copper', labelDefault: 'Copper' },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);
    const optionId = (created.json() as { data: { id: string } }).data.id;
    expect(await auditRows('catalog.attribute_option.create')).toHaveLength(1);

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options/${optionId}`,
      payload: { labelDefault: 'Copper (edited)' },
      cookies: adminCookie,
    });
    expect(patched.statusCode).toBe(200);
    expect(await auditRows('catalog.attribute_option.update')).toHaveLength(1);

    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attributes/${attributeId}/options/${optionId}`,
      cookies: adminCookie,
    });
    expect(deleted.statusCode).toBe(204);
    expect(await auditRows('catalog.attribute_option.delete')).toHaveLength(1);

    off();
    expect(events).toHaveLength(0);
  });

  it('rolls back atomically on an induced failure — no orphan definition, no audit row', async () => {
    // Duplicate key: the CF apply seam refuses inside the command transaction.
    const dup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'orch_material',
        label: { 'en-US': 'Material again' },
        labelDefault: 'Material again',
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(dup.statusCode).toBe(409);
    // Still exactly one create audit row (from the successful create above).
    expect(await auditRows('catalog.attribute.create')).toHaveLength(1);

    // Catalog-guard failure AFTER the definition insert would have happened:
    // two defaults on a single-select. The whole transaction must roll back —
    // no definition row may survive.
    const twoDefaults = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'orch_two_defaults',
        label: { 'en-US': 'Two defaults' },
        labelDefault: 'Two defaults',
        type: 'select',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        options: [
          { value: 'a', labelDefault: 'A', isDefault: true },
          { value: 'b', labelDefault: 'B', isDefault: true },
        ],
      },
      cookies: adminCookie,
    });
    expect([400, 409]).toContain(twoDefaults.statusCode);
    expect(await definitionRow('orch_two_defaults')).toBeUndefined();
    expect(await auditRows('catalog.attribute.create')).toHaveLength(1);
  });

  it('delete removes definition + extension + options in one transaction with one audit row', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attributes/${attributeId}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(204);

    expect(await auditRows('catalog.attribute.delete')).toHaveLength(1);
    expect(await definitionRow('orch_material')).toBeUndefined();
    const conn = h.em().getConnection();
    const exts = (await conn.execute<Array<{ id: string }>>(
      `select "id" from "product_attributes" where "id" = ?`,
      [attributeId],
    )) as Array<{ id: string }>;
    expect(exts).toHaveLength(0);
    const options = (await conn.execute<Array<{ id: string }>>(
      `select "id" from "custom_field_options" where "definition_id" = ?`,
      [definitionId],
    )) as Array<{ id: string }>;
    expect(options).toHaveLength(0);

    // The generic surface no longer lists it (cache invalidated on commit).
    const cf = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=product',
      cookies: adminCookie,
    });
    const keys = (cf.json() as { data: Array<{ key: string }> }).data.map((d) => d.key);
    expect(keys).not.toContain('orch_material');
  });

  // -------------------------------------------------------------------------
  // T026 (feature 061, US1) — delete/option-removal refusals against LIVE
  // product values, including the language-scoped nested shapes
  // `{ "<key>": { "en": "x", "pl": "y" } }` that defeat the generic flat
  // `->>key = value` probe (research §R9 — catalog's own checks stay
  // authoritative).
  // -------------------------------------------------------------------------
  describe('in-use refusals against live product values (T026)', () => {
    let defaultSetId: string;
    let langSelect: { id: string; options: Array<{ id: string; value: string }> };
    let langMulti: { id: string; options: Array<{ id: string; value: string }> };
    let flatSelect: { id: string; options: Array<{ id: string; value: string }> };

    async function createAttribute(payload: Record<string, unknown>): Promise<{
      id: string;
      options: Array<{ id: string; value: string }>;
    }> {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/attributes',
        payload,
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      const opts = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/attributes/${id}/options`,
        cookies: adminCookie,
      });
      expect(opts.statusCode).toBe(200);
      return {
        id,
        options: (opts.json() as { data: { items: Array<{ id: string; value: string }> } }).data
          .items,
      };
    }

    function optionId(
      attr: { options: Array<{ id: string; value: string }> },
      value: string,
    ): string {
      const opt = attr.options.find((o) => o.value === value);
      expect(opt).toBeDefined();
      return opt!.id;
    }

    async function deleteOption(attrId: string, optId: string): Promise<number> {
      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/attributes/${attrId}/options/${optId}`,
        cookies: adminCookie,
      });
      return res.statusCode;
    }

    it('fixture: language-scoped + flat attributes on the Default set with live product values', async () => {
      const sets = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/catalog/attribute-sets',
        cookies: adminCookie,
      });
      const defaultSet = (sets.json() as { data: Array<{ id: string; code: string }> }).data.find(
        (s) => s.code === 'default',
      );
      expect(defaultSet).toBeDefined();
      defaultSetId = defaultSet!.id;

      const base = {
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      };
      langSelect = await createAttribute({
        ...base,
        key: 'orch_lang_material',
        label: { 'en-US': 'Material (lang)' },
        labelDefault: 'Material (lang)',
        type: 'select',
        languageScoped: true,
        options: [
          { value: 'steel', labelDefault: 'Steel' },
          { value: 'stal', labelDefault: 'Stal' },
          { value: 'brass', labelDefault: 'Brass' },
        ],
      });
      langMulti = await createAttribute({
        ...base,
        key: 'orch_lang_tags',
        label: { 'en-US': 'Tags (lang)' },
        labelDefault: 'Tags (lang)',
        type: 'multiselect',
        languageScoped: true,
        enumValues: ['fast', 'eco', 'quiet'],
      });
      flatSelect = await createAttribute({
        ...base,
        key: 'orch_flat_color',
        label: { 'en-US': 'Color (flat)' },
        labelDefault: 'Color (flat)',
        type: 'select',
        options: [
          { value: 'red', labelDefault: 'Red' },
          { value: 'blue', labelDefault: 'Blue' },
        ],
      });

      const assign = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/attribute-sets/${defaultSetId}/attributes`,
        payload: {
          assignments: [
            { attributeId: langSelect.id },
            { attributeId: langMulti.id },
            { attributeId: flatSelect.id },
          ],
        },
        cookies: adminCookie,
      });
      expect(assign.statusCode).toBe(200);

      const product = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/products',
        payload: {
          sku: 'ORCH-IN-USE-001',
          type: 'simple',
          name: { 'en-US': 'In-use probe product' },
          description: { 'en-US': 'desc' },
          categoryIds: [],
          visibility: 'public',
          attributeSetId: defaultSetId,
          attributeValues: {
            // Language-scoped nested shapes (research §R9).
            orch_lang_material: { en: 'steel', pl: 'stal' },
            orch_lang_tags: { en: ['fast'], pl: ['eco'] },
            // Flat legacy shape.
            orch_flat_color: 'red',
          },
        },
        cookies: adminCookie,
      });
      expect(product.statusCode).toBe(201);
    });

    it('option delete is refused for a value carried inside a language-scoped nested shape', async () => {
      // Non-default-language value ('pl') — invisible to the flat ->>key probe.
      expect(await deleteOption(langSelect.id, optionId(langSelect, 'stal'))).toBe(409);
      // Default-language value.
      expect(await deleteOption(langSelect.id, optionId(langSelect, 'steel'))).toBe(409);
      // An option no product carries still deletes fine.
      expect(await deleteOption(langSelect.id, optionId(langSelect, 'brass'))).toBe(204);
    });

    it('option delete is refused for a value inside a language-scoped multiselect array', async () => {
      expect(await deleteOption(langMulti.id, optionId(langMulti, 'eco'))).toBe(409);
      expect(await deleteOption(langMulti.id, optionId(langMulti, 'fast'))).toBe(409);
      expect(await deleteOption(langMulti.id, optionId(langMulti, 'quiet'))).toBe(204);
    });

    it('option delete is refused for a flat in-use value (legacy shape still authoritative)', async () => {
      expect(await deleteOption(flatSelect.id, optionId(flatSelect, 'red'))).toBe(409);
      expect(await deleteOption(flatSelect.id, optionId(flatSelect, 'blue'))).toBe(204);
    });

    it('attribute delete is refused while set-assigned, then while product values exist (incl. nested)', async () => {
      // Set membership blocks first (RESTRICT semantics).
      const whileAssigned = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/attributes/${langSelect.id}`,
        cookies: adminCookie,
      });
      expect(whileAssigned.statusCode).toBe(409);

      // Unassign — the language-scoped nested product value alone must still refuse.
      const unassign = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/attribute-sets/${defaultSetId}/attributes/${langSelect.id}`,
        cookies: adminCookie,
      });
      expect(unassign.statusCode).toBe(204);
      const withValues = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/attributes/${langSelect.id}`,
        cookies: adminCookie,
      });
      expect(withValues.statusCode).toBe(409);

      // No orphaning: the definition is still on the generic surface.
      const cf = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/custom-fields/definitions?entityType=product',
        cookies: adminCookie,
      });
      const keys = (cf.json() as { data: Array<{ key: string }> }).data.map((d) => d.key);
      expect(keys).toContain('orch_lang_material');
    });
  });
});
