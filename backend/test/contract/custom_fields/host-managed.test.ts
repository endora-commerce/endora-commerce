import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomFieldDefinition } from '../../../src/modules/custom_fields/entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../../../src/modules/custom_fields/entities/custom-field-option.entity.js';

/**
 * Feature 061 T006 — generic `managedBy` refusal on the Custom Fields admin
 * surface (contracts/attribute-admin-api.md §"Generic Custom Fields admin
 * surface", research §R8) [real DB].
 *
 * Definitions of a host-managed entity type (`product`, managed by catalog)
 * are readable through the generic routes but every mutation is refused with
 * `409 CUSTOM_FIELD_HOST_MANAGED`. Non-managed hosts keep full CRUD.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

const VALID_OPTION = { value: 'steel', label: {}, labelDefault: 'Steel', isDefault: false, sortOrder: 0 };

describe('Custom Fields — host-managed entity types [contract]', () => {
  let h: BackendServerHandle;
  let productDefId: string;
  let productOptionId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Seed a product-host definition directly: the generic routes refuse
    // product mutations by design, and the catalog write surface lands in
    // Phase 2 — direct persistence stands in for the host's apply path.
    const em = h.em();
    const def = em.create(CustomFieldDefinition, {
      entityType: 'product',
      key: 'hm_probe_material',
      label: { en: 'Material' },
      labelDefault: 'Material',
      valueType: 'select',
      required: false,
      sortOrder: 0,
      config: {},
    });
    // Options reference the definition by id (no ORM relation) — flush the
    // definition first so the FK insert order holds.
    await em.flush();
    const opt = em.create(CustomFieldOption, {
      definitionId: def.id,
      value: 'steel',
      label: {},
      labelDefault: 'Steel',
      isDefault: false,
      sortOrder: 0,
    });
    await em.flush();
    productDefId = def.id;
    productOptionId = opt.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function expectHostManaged(res: { statusCode: number; json: () => { error?: { code?: string } } }): void {
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code).toBe(ERROR_CODES.CUSTOM_FIELD_HOST_MANAGED);
  }

  it('GET lists product-host definitions (read surface is additive)', async () => {
    const filtered = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions?entityType=product',
      ...ADMIN,
    });
    expect(filtered.statusCode).toBe(200);
    const keys = (filtered.json().data as { key: string }[]).map((d) => d.key);
    expect(keys).toContain('hm_probe_material');

    const all = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
    });
    expect(all.statusCode).toBe(200);
    const allKeys = (all.json().data as { entityType: string; key: string }[])
      .filter((d) => d.entityType === 'product')
      .map((d) => d.key);
    expect(allKeys).toContain('hm_probe_material');

    const byId = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}`,
      ...ADMIN,
    });
    expect(byId.statusCode).toBe(200);
    expect((byId.json().data as { key: string }).key).toBe('hm_probe_material');
  });

  it('POST a definition for a managedBy host → 409 host_managed', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      payload: {
        entityType: 'product',
        key: 'finish',
        label: {},
        labelDefault: 'Finish',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
      },
      ...ADMIN,
    });
    expectHostManaged(res);
  });

  it('PATCH / DELETE a managedBy-host definition → 409 host_managed, row untouched', async () => {
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}`,
      payload: { labelDefault: 'Materiał' },
      ...ADMIN,
    });
    expectHostManaged(patch);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}`,
      ...ADMIN,
    });
    expectHostManaged(del);

    const still = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}`,
      ...ADMIN,
    });
    expect(still.statusCode).toBe(200);
    expect((still.json().data as { labelDefault: string }).labelDefault).toBe('Material');
  });

  it('option mutations on a managedBy-host definition → 409 host_managed', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}/options`,
      payload: { ...VALID_OPTION, value: 'aluminium', labelDefault: 'Aluminium' },
      ...ADMIN,
    });
    expectHostManaged(create);

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}/options/${productOptionId}`,
      payload: { labelDefault: 'Stainless steel' },
      ...ADMIN,
    });
    expectHostManaged(patch);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${productDefId}/options/${productOptionId}`,
      ...ADMIN,
    });
    expectHostManaged(del);
  });

  it('non-managed hosts keep full CRUD (unaffected)', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      payload: {
        entityType: 'organization',
        key: 'hm_probe_field',
        label: {},
        labelDefault: 'Probe',
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
      },
      ...ADMIN,
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json().data as { id: string }).id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${id}`,
      payload: { labelDefault: 'Probe 2' },
      ...ADMIN,
    });
    expect(patch.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/custom-fields/definitions/${id}`,
      ...ADMIN,
    });
    expect(del.statusCode).toBe(204);
  });
});
