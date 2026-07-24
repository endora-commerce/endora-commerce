import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T025 (feature 061, US1) — the catalog attribute surface is definition-backed:
 * creating an attribute via `POST /api/v1/admin/catalog/attributes` makes the
 * backing definition visible on the generic Custom Fields admin surface
 * (`GET /api/v1/admin/custom-fields/definitions?entityType=product`) with
 * matching key / labels / valueType / options, and the catalog response carries
 * the additive `customFieldDefinitionId` (contracts/attribute-admin-api.md).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CfDefinition {
  id: string;
  entityType: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: string;
  required: boolean;
  options: Array<{
    id: string;
    value: string;
    label: Record<string, string>;
    labelDefault: string;
    isDefault: boolean;
    sortOrder: number;
  }>;
}

describe('attribute definition mirror (feature 061, T025)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function listProductDefinitions(): Promise<CfDefinition[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=product',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: CfDefinition[] }).data;
  }

  it('a select attribute with options is mirrored onto the generic definitions listing', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'mirror_finish',
        label: { 'en-US': 'Finish', 'pl-PL': 'Wykończenie' },
        labelDefault: 'Finish',
        type: 'select',
        isSearchable: false,
        isFilterable: true,
        isVariantAxis: false,
        isRequired: true,
        options: [
          { value: 'matte', labelDefault: 'Matte', label: { 'en-US': 'Matte' }, isDefault: true },
          { value: 'gloss', labelDefault: 'Gloss' },
        ],
      },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);
    const attr = (created.json() as {
      data: { id: string; key: string; customFieldDefinitionId: string };
    }).data;

    // The catalog payload carries the additive backing-definition id.
    expect(attr.customFieldDefinitionId).toMatch(UUID_RE);
    expect(attr.customFieldDefinitionId).not.toBe(attr.id);

    const defs = await listProductDefinitions();
    const def = defs.find((d) => d.key === 'mirror_finish');
    expect(def).toBeDefined();
    expect(def!.id).toBe(attr.customFieldDefinitionId);
    expect(def!.entityType).toBe('product');
    expect(def!.label).toEqual({ 'en-US': 'Finish', 'pl-PL': 'Wykończenie' });
    expect(def!.labelDefault).toBe('Finish');
    // Catalog `select` maps onto the CF `select` value type (research §R7).
    expect(def!.valueType).toBe('select');
    expect(def!.required).toBe(true);
    // Options match by value, labels, and default flag.
    expect(def!.options.map((o) => o.value)).toEqual(['matte', 'gloss']);
    const matte = def!.options.find((o) => o.value === 'matte')!;
    expect(matte.labelDefault).toBe('Matte');
    expect(matte.label).toEqual({ 'en-US': 'Matte' });
    expect(matte.isDefault).toBe(true);
    const gloss = def!.options.find((o) => o.value === 'gloss')!;
    expect(gloss.isDefault).toBe(false);
  });

  it('a plain input attribute is mirrored as a text definition', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: {
        key: 'mirror_engraving',
        label: { 'en-US': 'Engraving' },
        labelDefault: 'Engraving',
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
      },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);
    const attr = (created.json() as {
      data: { id: string; valueType: string; customFieldDefinitionId: string };
    }).data;
    // The legacy API form is unchanged (`string`), while the generic surface
    // exposes the CF value type (`text`) — bijective mapping, research §R7.
    expect(attr.valueType).toBe('string');

    const defs = await listProductDefinitions();
    const def = defs.find((d) => d.key === 'mirror_engraving');
    expect(def).toBeDefined();
    expect(def!.id).toBe(attr.customFieldDefinitionId);
    expect(def!.valueType).toBe('text');
    expect(def!.required).toBe(false);
    expect(def!.options).toEqual([]);
  });

  it('the mirrored definition follows catalog-side edits (labels + options)', async () => {
    const attrsRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes',
      cookies: adminCookie,
    });
    const attrs = (attrsRes.json() as {
      data: Array<{ id: string; key: string; customFieldDefinitionId: string }>;
    }).data;
    const finish = attrs.find((a) => a.key === 'mirror_finish')!;
    expect(finish).toBeDefined();
    // The listing carries customFieldDefinitionId too (additive on every payload).
    expect(finish.customFieldDefinitionId).toMatch(UUID_RE);

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${finish.id}`,
      payload: { labelDefault: 'Surface finish' },
      cookies: adminCookie,
    });
    expect(patched.statusCode).toBe(200);

    const defs = await listProductDefinitions();
    const def = defs.find((d) => d.key === 'mirror_finish');
    expect(def!.labelDefault).toBe('Surface finish');
  });
});
