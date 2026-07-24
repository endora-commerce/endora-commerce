import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AttributeSetDetail } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';

/**
 * T027 (feature 061, US2) — Attribute Sets over definitions:
 *
 *   - set create/assign/unassign/detail round-trip attribute (extension) ids
 *     through the unchanged API while the bridge persists DEFINITION ids;
 *   - attribute (definition) delete is refused while set-assigned (RESTRICT);
 *   - set mutations run as Commands with today's audit action names
 *     (`attribute_set.*`): exactly ONE audit row per operator action
 *     (Principle XIII — the hand audit in routes.admin.ts is replaced, no
 *     double-audit), with command-written state snapshots.
 */
describe('attribute sets persist definition ids behind the extension-id API (feature 061, T027)', () => {
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

  async function bridgeRows(setId: string): Promise<Array<{ custom_field_definition_id: string }>> {
    return (await h
      .em()
      .getConnection()
      .execute<Array<{ custom_field_definition_id: string }>>(
        `select "custom_field_definition_id" from "attribute_set_attributes" where "attribute_set_id" = ?`,
        [setId],
      )) as Array<{ custom_field_definition_id: string }>;
  }

  let attrA: { id: string; customFieldDefinitionId: string };
  let attrB: { id: string; customFieldDefinitionId: string };
  let setId: string;

  it('fixture: two catalog attributes', async () => {
    const mk = async (key: string, type: string): Promise<{ id: string; customFieldDefinitionId: string }> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/attributes',
        payload: {
          key,
          label: { 'en-US': key },
          labelDefault: key,
          type,
          isSearchable: false,
          isFilterable: false,
          isVariantAxis: false,
          ...(type === 'select'
            ? { options: [{ value: 'alpha', labelDefault: 'Alpha' }] }
            : {}),
        },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { data: { id: string; customFieldDefinitionId: string } }).data;
    };
    attrA = await mk('defkeys_grade', 'select');
    attrB = await mk('defkeys_note', 'input');
    expect(attrA.customFieldDefinitionId).not.toBe(attrA.id);
  });

  it('POST /attribute-sets with attributeIds persists definition ids and returns extension ids', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      payload: {
        code: 'defkeys_set',
        name: { 'en-US': 'Definition keys set' },
        attributeIds: [attrA.id],
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const detail = (res.json() as { data: AttributeSetDetail }).data;
    setId = detail.id;

    // API round-trips the attribute (extension) id...
    expect(detail.attributes.map((a) => a.id)).toEqual([attrA.id]);
    // ...while the bridge row persists the DEFINITION id.
    const rows = await bridgeRows(setId);
    expect(rows.map((r) => r.custom_field_definition_id)).toEqual([
      attrA.customFieldDefinitionId,
    ]);

    // Exactly one audit row for the create (command-written, no route double-audit).
    expect(await auditRows('attribute_set.create')).toHaveLength(1);
  });

  it('PATCH /attribute-sets/:id audits exactly once', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}`,
      payload: { name: { 'en-US': 'Definition keys set (renamed)' } },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(await auditRows('attribute_set.update')).toHaveLength(1);
  });

  it('POST /:id/attributes assigns by extension id, persists the definition id, audits once via the Command', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
      payload: { assignments: [{ attributeId: attrB.id, position: 5 }] },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: AttributeSetDetail }).data;
    expect(detail.attributes.map((a) => a.id).sort()).toEqual([attrA.id, attrB.id].sort());

    const rows = await bridgeRows(setId);
    expect(rows.map((r) => r.custom_field_definition_id).sort()).toEqual(
      [attrA.customFieldDefinitionId, attrB.customFieldDefinitionId].sort(),
    );

    const audits = await auditRows('attribute_set.assign_attributes');
    expect(audits).toHaveLength(1);
    // Command-written audit carries the after-state snapshot (the hand-audited
    // route helper never did) and targets the set.
    expect(audits[0]!.objectType).toBe('attribute_set');
    expect(audits[0]!.objectId).toBe(setId);
    expect(audits[0]!.stateAfter).toBeTruthy();
  });

  it('DELETE /api/v1/admin/catalog/attributes/:id is refused while set-assigned (RESTRICT)', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attributes/${attrB.id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(409);
    // The definition + extension survive.
    const defs = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `select "id" from "custom_field_definitions" where "id" = ?`,
        [attrB.customFieldDefinitionId],
      )) as Array<{ id: string }>;
    expect(defs).toHaveLength(1);
  });

  it('DELETE /:id/attributes/:attributeId unassigns by extension id and audits once via the Command', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes/${attrB.id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(204);
    const rows = await bridgeRows(setId);
    expect(rows.map((r) => r.custom_field_definition_id)).toEqual([
      attrA.customFieldDefinitionId,
    ]);

    const audits = await auditRows('attribute_set.unassign_attribute');
    expect(audits).toHaveLength(1);
    expect(audits[0]!.objectId).toBe(setId);
    expect(audits[0]!.stateBefore).toBeTruthy();
  });

  it('once unassigned everywhere, the attribute delete succeeds and removes the definition', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attributes/${attrB.id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(204);
    const defs = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `select "id" from "custom_field_definitions" where "id" = ?`,
        [attrB.customFieldDefinitionId],
      )) as Array<{ id: string }>;
    expect(defs).toHaveLength(0);
  });

  it('DELETE /attribute-sets/:id audits exactly once', async () => {
    // Unassign the remaining attribute first, then delete the (unused) set.
    await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes/${attrA.id}`,
      cookies: adminCookie,
    });
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(204);
    expect(await auditRows('attribute_set.delete')).toHaveLength(1);
  });
});
