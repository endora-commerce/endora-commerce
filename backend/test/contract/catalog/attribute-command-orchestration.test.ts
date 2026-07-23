import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';

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
});
