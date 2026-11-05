import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 172 (`specs/172-product-content-attributes/`, US1, research R-6) —
 * defining a Page Builder content attribute through the admin API.
 *
 * - FR-001 / FR-004: `type: 'page_builder'` is created with every capability
 *   off, and reads back as `page_builder` in both the API and the legacy
 *   vocabulary.
 * - FR-003: create and PATCH refuse each locked capability by name
 *   (`details[].path`), and store nothing.
 * - FR-004 under feature 174 (`specs/174-product-editor-scope-switcher/`,
 *   FR-012): the channel and language scope flags became one `scopable` flag.
 *   A content attribute's languages are its document envelope's, never scoped
 *   values, so `scopable` is one of the locked capabilities (it carries FR-040)
 *   and there is no language flag left to switch off.
 * - FR-005: the type never changes to or from `page_builder` (409).
 * - FR-006: the attribute joins a set and keeps its position like any member.
 */

const LOCKED_FLAGS = [
  'isSearchable',
  'isFilterable',
  'isVariantAxis',
  'displayAsSlider',
  'isComparable',
  'quickSearchable',
  'isPromoRule',
  'isPriceRule',
  'massEditable',
  'isRequired',
  'isVisibleOnProductPage',
  'scopable',
] as const;

const adminCookie = { b2b_session: 'stub-admin-session' };

interface ErrorBody {
  error: { code: string; message: string; details?: Array<{ path: string; issue: string }> };
}

describe('Content attribute definition (feature 172, US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function base(key: string): Record<string, unknown> {
    return {
      key,
      label: { 'en-US': 'Buying guide', 'pl-PL': 'Poradnik zakupowy' },
      labelDefault: 'Buying guide',
      type: 'page_builder',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
    };
  }

  async function create(payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload,
      cookies: adminCookie,
    });
  }

  async function read(key: string) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attributes/${key}`,
      cookies: adminCookie,
    });
  }

  it('creates a page_builder attribute with every capability off, scopable among them (FR-001, FR-004)', async () => {
    const res = await create(base('pb_guide_172'));
    expect(res.statusCode, res.body).toBe(201);
    const back = await read('pb_guide_172');
    expect(back.statusCode).toBe(200);
    const data = (back.json() as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ type: 'page_builder', valueType: 'page_builder', scopable: false });
    expect(data).not.toHaveProperty('languageScoped');
    for (const flag of LOCKED_FLAGS) expect(data[flag], flag).toBe(false);
  });

  for (const flag of LOCKED_FLAGS) {
    it(`refuses ${flag} on create and on PATCH, naming it, storing nothing (FR-003)`, async () => {
      const key = `pb_flag_${flag.toLowerCase()}`;
      const refused = await create({ ...base(key), [flag]: true });
      expect(refused.statusCode, refused.body).toBe(400);
      const body = refused.json() as ErrorBody;
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.map((detail) => detail.path)).toContain(flag);
      expect((await read(key)).statusCode).toBe(404);

      expect((await create(base(key))).statusCode).toBe(201);
      const patched = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/attributes/${key}`,
        payload: { [flag]: true },
        cookies: adminCookie,
      });
      expect(patched.statusCode, patched.body).toBe(400);
      expect((patched.json() as ErrorBody).error.details?.map((detail) => detail.path)).toContain(flag);
      const after = (await read(key)).json() as { data: Record<string, unknown> };
      expect(after.data[flag]).toBe(false);
    });
  }

  it('refuses the retired languageScoped flag on PATCH, storing nothing (FR-004, feature 174)', async () => {
    expect((await create(base('pb_lang_patch'))).statusCode).toBe(201);
    const patched = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/pb_lang_patch',
      payload: { languageScoped: false },
      cookies: adminCookie,
    });
    expect(patched.statusCode, patched.body).toBe(400);
    expect(((await read('pb_lang_patch')).json() as { data: { scopable: boolean } }).data.scopable).toBe(false);
  });

  it('refuses options on a page_builder attribute', async () => {
    const res = await create({
      ...base('pb_options'),
      options: [{ value: 'a', labelDefault: 'A' }],
    });
    expect(res.statusCode).toBe(400);
    expect((await read('pb_options')).statusCode).toBe(404);
  });

  it('refuses a type change to or from page_builder with 409 (FR-005)', async () => {
    expect((await create(base('pb_type_from'))).statusCode).toBe(201);
    const fromContent = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/pb_type_from',
      payload: { type: 'input' },
      cookies: adminCookie,
    });
    expect(fromContent.statusCode, fromContent.body).toBe(409);
    expect((fromContent.json() as ErrorBody).error.message).toBe(
      'The value type of a Page Builder content attribute cannot be changed.',
    );

    const plain = await create({
      key: 'pb_type_to',
      label: { 'en-US': 'Plain' },
      type: 'input',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
    });
    expect(plain.statusCode).toBe(201);
    const toContent = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/pb_type_to',
      payload: { type: 'page_builder' },
      cookies: adminCookie,
    });
    expect(toContent.statusCode, toContent.body).toBe(409);
    expect(((await read('pb_type_to')).json() as { data: { type: string } }).data.type).toBe('input');
    expect(((await read('pb_type_from')).json() as { data: { type: string } }).data.type).toBe('page_builder');
  });

  it('joins an attribute set and keeps its position when the set is reordered (FR-006)', async () => {
    const created = await create(base('pb_in_set'));
    expect(created.statusCode).toBe(201);
    const attributeId = (created.json() as { data: { id: string } }).data.id;
    const other = await create({
      key: 'pb_set_neighbour',
      label: { 'en-US': 'Neighbour' },
      type: 'input',
      isSearchable: false,
      isFilterable: false,
      isVariantAxis: false,
    });
    const otherId = (other.json() as { data: { id: string } }).data.id;

    const set = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attribute-sets',
      payload: { code: 'pb_power_tools', name: { 'en-US': 'Power tools' } },
      cookies: adminCookie,
    });
    expect(set.statusCode, set.body).toBe(201);
    const setId = (set.json() as { data: { id: string } }).data.id;

    const assign = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
      payload: {
        assignments: [
          { attributeId: otherId, position: 0 },
          { attributeId, position: 1 },
        ],
      },
      cookies: adminCookie,
    });
    expect(assign.statusCode, assign.body).toBe(200);

    const reorder = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
      payload: {
        assignments: [
          { attributeId, position: 0 },
          { attributeId: otherId, position: 1 },
        ],
      },
      cookies: adminCookie,
    });
    expect(reorder.statusCode, reorder.body).toBe(200);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/attribute-sets/${setId}`,
      cookies: adminCookie,
    });
    const attributes = (detail.json() as {
      data: { attributes: Array<{ id: string; key: string; valueType: string; position: number }> };
    }).data.attributes;
    expect(attributes.map((attribute) => attribute.key)).toEqual(['pb_in_set', 'pb_set_neighbour']);
    expect(attributes[0]).toMatchObject({ id: attributeId, valueType: 'page_builder', position: 0 });
  });
});
