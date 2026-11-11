import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  customFieldDefinitionSchema,
  customFieldEntityTypeInfoSchema,
} from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/175-buyer-input-custom-fields/` (FR-001 – FR-006, FR-009; research
 * R-1, R-4) — the buyer-input and admin-access attributes over the admin
 * definition API: they round-trip, the four invariants answer 422
 * `CUSTOM_FIELD_DEFINITION_INVALID` naming their reason, a row written before
 * the columns existed reads `[]` / `edit`, and the entity-types listing says
 * which types offer a surface [real DB].
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const URL = '/api/v1/admin/custom-fields/definitions';
const OPEN = ['organization.register'];

function body(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    entityType: 'organization',
    label: {},
    labelDefault: 'Field',
    valueType: 'text',
    required: false,
    audience: 'customer',
    sortOrder: 0,
    config: {},
    carryTo: [],
    options: [],
    ...overrides,
  };
}

describe('Custom Fields — buyer input and admin access on definitions [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function setPreferredLanguage(language: 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      ...ADMIN,
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function create(overrides: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url: URL, ...ADMIN, payload: body(overrides) });
  }

  it('creates with both attributes and reads them back', async () => {
    const res = await create({ entityType: 'customer', key: 'cf175_phone', customerInput: OPEN, adminAccess: 'read' });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json().data as { id: string }).id;
    const read = await h.app.inject({ method: 'GET', url: `${URL}/${id}`, ...ADMIN });
    const definition = customFieldDefinitionSchema.parse(read.json().data);
    expect(definition.customerInput).toEqual(OPEN);
    expect(definition.adminAccess).toBe('read');
  });

  it('defaults both attributes on a create naming neither', async () => {
    const res = await create({ key: 'cf175_defaults' });
    expect(res.statusCode, res.body).toBe(201);
    const definition = customFieldDefinitionSchema.parse(res.json().data);
    expect(definition.customerInput).toEqual([]);
    expect(definition.adminAccess).toBe('edit');
  });

  it('updates each attribute, and a patch naming neither leaves both', async () => {
    const created = await create({ key: 'cf175_update' });
    const id = (created.json().data as { id: string }).id;
    const opened = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${id}`,
      ...ADMIN,
      payload: { customerInput: OPEN, adminAccess: 'hidden' },
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(opened.json().data).toMatchObject({ customerInput: OPEN, adminAccess: 'hidden' });
    const relabelled = await h.app.inject({
      method: 'PATCH',
      url: `${URL}/${id}`,
      ...ADMIN,
      payload: { labelDefault: 'Renamed' },
    });
    expect(relabelled.json().data).toMatchObject({ customerInput: OPEN, adminAccess: 'hidden', labelDefault: 'Renamed' });
  });

  describe('the four refusals', () => {
    async function expectRefusal(
      res: Awaited<ReturnType<typeof create>>,
      reason: string,
      key: string,
    ): Promise<void> {
      expect(res.statusCode, res.body).toBe(422);
      const error = res.json().error as { code: string; details: Record<string, unknown> };
      expect(error.code).toBe('CUSTOM_FIELD_DEFINITION_INVALID');
      expect(error.details).toMatchObject({ reason, key });
    }

    it('customer_input_unsupported — a surface the entity type does not offer', async () => {
      await expectRefusal(
        await create({ entityType: 'order', key: 'cf175_order_open', customerInput: OPEN }),
        'customer_input_unsupported',
        'cf175_order_open',
      );
    });

    it('customer_input_audience — opening an internal field, and making an open field internal', async () => {
      await expectRefusal(
        await create({ key: 'cf175_internal_open', audience: 'internal', customerInput: OPEN }),
        'customer_input_audience',
        'cf175_internal_open',
      );
      const open = await create({ key: 'cf175_open_then_internal', customerInput: OPEN });
      const id = (open.json().data as { id: string }).id;
      const patched = await h.app.inject({
        method: 'PATCH',
        url: `${URL}/${id}`,
        ...ADMIN,
        payload: { audience: 'internal' },
      });
      await expectRefusal(patched, 'customer_input_audience', 'cf175_open_then_internal');
      const read = await h.app.inject({ method: 'GET', url: `${URL}/${id}`, ...ADMIN });
      expect(read.json().data).toMatchObject({ audience: 'customer', customerInput: OPEN });
    });

    it('customer_input_value_type — an open Page Builder field', async () => {
      await expectRefusal(
        await create({ key: 'cf175_pb_open', valueType: 'page_builder', customerInput: OPEN }),
        'customer_input_value_type',
        'cf175_pb_open',
      );
    });

    it('admin_access_required — required and not editable, from either side', async () => {
      await expectRefusal(
        await create({ key: 'cf175_required_read', required: true, adminAccess: 'read' }),
        'admin_access_required',
        'cf175_required_read',
      );
      const hidden = await create({ key: 'cf175_hidden_then_required', adminAccess: 'hidden' });
      const id = (hidden.json().data as { id: string }).id;
      const patched = await h.app.inject({
        method: 'PATCH',
        url: `${URL}/${id}`,
        ...ADMIN,
        payload: { required: true },
      });
      await expectRefusal(patched, 'admin_access_required', 'cf175_hidden_then_required');
    });

    it("answers the refusal's sentence in the administrator's language", async () => {
      const refuse = () => create({ key: 'cf175_language', required: true, adminAccess: 'hidden' });
      const english = await refuse();
      expect(english.json().error.message).toBe('A required field must stay editable in the admin.');
      // An admin's language is their preference, not the request header.
      await setPreferredLanguage('pl');
      try {
        const polish = await refuse();
        expect(polish.statusCode).toBe(422);
        expect(polish.json().error.message).toBe('Pole wymagane musi pozostać edytowalne w panelu administracyjnym.');
      } finally {
        await setPreferredLanguage(null);
      }
    });
  });

  it('reads a row written before the columns existed as [] and edit', async () => {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into "custom_field_definitions"
           ("id", "entity_type", "key", "label", "label_default", "value_type", "required", "sort_order", "config", "created_at", "updated_at")
         values (?, 'organization', 'cf175_legacy', '{}', 'Legacy', 'text', false, 0, '{}', now(), now())`,
        [id],
      );
    const read = await h.app.inject({ method: 'GET', url: `${URL}/${id}`, ...ADMIN });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().data).toMatchObject({ customerInput: [], adminAccess: 'edit' });
  });

  it('lists the input surfaces each entity type offers', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/custom-fields/entity-types', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const infos = (res.json().data as unknown[]).map((info) => customFieldEntityTypeInfoSchema.parse(info));
    const byType = new Map(infos.map((info) => [info.entityType, info.customerInputSurfaces]));
    expect(byType.get('organization')).toEqual(OPEN);
    expect(byType.get('customer')).toEqual(OPEN);
    expect(byType.get('order')).toEqual([]);
    expect(byType.get('category')).toEqual([]);
    // The raw answer carries the member, not only the schema default.
    expect((res.json().data as Array<Record<string, unknown>>).every((info) => 'customerInputSurfaces' in info)).toBe(
      true,
    );
  });
});
