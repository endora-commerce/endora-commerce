import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  customFieldDefinitionListResponseSchema,
  customFieldDefinitionSchema,
  customFieldEntityTypeListResponseSchema,
  type CustomFieldDefinitionDto,
} from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/**
 * Issue #447 — the admin's create form sends a whole definition in **one**
 * request: labels per language, and options carrying their own labels per
 * language, the default flag and their order. This holds that the create route
 * keeps every one of those members, so the form has no reason to fall back to
 * the option sub-routes after a create [real DB].
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

const OPTIONS = [
  { value: 'north', label: { en: 'North', pl: 'Północ' }, labelDefault: 'North', isDefault: false, sortOrder: 0 },
  { value: 'east', label: { en: 'East' }, labelDefault: 'East', isDefault: false, sortOrder: 1 },
  { value: 'south', label: { pl: 'Południe' }, labelDefault: 'South', isDefault: true, sortOrder: 2 },
];

describe('Custom Fields — creating a definition with full options [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('round-trips the labels, the options with their labels, the default and the order', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: {
        entityType: 'order',
        key: 'cf447_region',
        label: { en: 'Region', pl: 'Region PL' },
        labelDefault: 'Region',
        valueType: 'select',
        required: false,
        audience: 'customer',
        sortOrder: 0,
        config: {},
        carryTo: [],
        // Sent out of order on purpose: the order is `sortOrder`, not the array's.
        options: [OPTIONS[2], OPTIONS[0], OPTIONS[1]],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json().data as { id: string }).id;

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/custom-fields/definitions/${id}`, ...ADMIN });
    expect(read.statusCode).toBe(200);
    const definition: CustomFieldDefinitionDto = customFieldDefinitionSchema.parse(read.json().data);
    expect(definition).toMatchObject({
      key: 'cf447_region',
      label: { en: 'Region', pl: 'Region PL' },
      labelDefault: 'Region',
      valueType: 'select',
      audience: 'customer',
    });
    const options = [...definition.options]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ value, label, labelDefault, isDefault, sortOrder }) => ({ value, label, labelDefault, isDefault, sortOrder }));
    expect(options).toEqual(OPTIONS);
  });

  it('keeps several default options on a multiple-choice field', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: {
        entityType: 'order',
        key: 'cf447_tags',
        label: {},
        labelDefault: 'Tags',
        valueType: 'multiselect',
        required: false,
        sortOrder: 1,
        config: {},
        options: [
          { value: 'a', label: {}, labelDefault: 'A', isDefault: true, sortOrder: 0 },
          { value: 'b', label: {}, labelDefault: 'B', isDefault: true, sortOrder: 1 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json().data as { id: string }).id;
    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/custom-fields/definitions/${id}`, ...ADMIN });
    const definition = customFieldDefinitionSchema.parse(read.json().data);
    expect(definition.options.map((option) => option.isDefault)).toEqual([true, true]);
  });

  it('answers every definition reply, and the entity types, in the published shape and nothing beside it', async () => {
    // Issue #599 §6 — strict copies: a key a reply carries that the contract does not declare fails.
    const strictDefinition = deepStrict(customFieldDefinitionSchema);
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/custom-fields/definitions',
      ...ADMIN,
      payload: {
        entityType: 'order',
        key: 'cf599_strict',
        label: { en: 'Strict' },
        labelDefault: 'Strict',
        valueType: 'select',
        required: false,
        audience: 'customer',
        sortOrder: 2,
        config: {},
        carryTo: [],
        options: [OPTIONS[0]],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(disagreements(strictDefinition, created.json().data)).toEqual([]);
    const id = (created.json().data as { id: string }).id;

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/custom-fields/definitions/${id}`, ...ADMIN });
    expect(read.statusCode, read.body).toBe(200);
    expect(disagreements(strictDefinition, read.json().data)).toEqual([]);

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/custom-fields/definitions/${id}`,
      ...ADMIN,
      payload: { labelDefault: 'Strict, renamed' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(disagreements(strictDefinition, patched.json().data)).toEqual([]);

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/definitions?entityType=order', ...ADMIN });
    expect(list.statusCode, list.body).toBe(200);
    expect((list.json().data as Array<{ id: string }>).map((d) => d.id)).toContain(id);
    expect(disagreements(deepStrict(customFieldDefinitionListResponseSchema), list.json())).toEqual([]);

    const types = await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/entity-types', ...ADMIN });
    expect(types.statusCode, types.body).toBe(200);
    expect((types.json().data as unknown[]).length).toBeGreaterThan(0);
    expect(disagreements(deepStrict(customFieldEntityTypeListResponseSchema), types.json())).toEqual([]);
  });
});
