import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';

/**
 * A host type whose owner module is not present is not a host type
 * (Constitution XVII; `specs/143-crm-sales-opportunities/research.md` R-26).
 *
 * `SupportedEntityMeta.ownerModuleId` is optional. A type that declares one is
 * offered by `GET …/entity-types`, and its definitions may be changed, only
 * while that module is effectively present. The generic layer reads the
 * marker's presence and never which module it names — `opportunity` is the one
 * type that carries it today, and it is used here as the instance, not as a
 * special case. Every type that declares no owner answers exactly as before,
 * in both states, which is the larger half of what this file holds.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const API = '/api/v1/admin/custom-fields';
const UNOWNED = ['category', 'order', 'organization', 'customer', 'quote_request', 'product'];

interface EntityTypeRow {
  entityType: string;
  labelKey: string;
  managedBy?: unknown;
}

describe('custom_fields — a host type follows its owner module', () => {
  let h: BackendServerHandle;
  const created: string[] = [];

  const entityTypes = async (): Promise<EntityTypeRow[]> => {
    const response = await h.app.inject({ method: 'GET', url: `${API}/entity-types`, ...ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: EntityTypeRow[] }).data;
  };

  const define = (entityType: string, key: string) =>
    h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      ...ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
        valueType: 'text',
        required: false,
        sortOrder: 0,
        config: {},
        options: [],
      },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('offers the owned type while its owner is on, labelled from this module’s bundle', async () => {
    const rows = await entityTypes();
    expect(rows.map((row) => row.entityType)).toEqual([...UNOWNED, 'opportunity']);
    expect(rows.find((row) => row.entityType === 'opportunity')).toEqual({
      entityType: 'opportunity',
      labelKey: 'customFields.entity.opportunity',
    });
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'omits the owned type while its owner is %s, and answers every other type exactly as before',
    async (axis) => {
      const before = await entityTypes();
      await withModuleOff('crm', axis, async () => {
        const during = await entityTypes();
        expect(during.map((row) => row.entityType)).toEqual(UNOWNED);
        expect(during).toEqual(before.filter((row) => row.entityType !== 'opportunity'));
      });
      expect(await entityTypes()).toEqual(before);
    },
  );

  it('refuses to create, edit or delete a definition of a type whose owner is off — and nothing changes', async () => {
    const response = await define('opportunity', 'owner_presence_probe');
    expect(response.statusCode, response.body).toBe(201);
    const { id } = (response.json() as { data: { id: string } }).data;
    created.push(id);

    await withModuleOff('crm', 'deactivated', async () => {
      const create = await define('opportunity', 'owner_presence_second');
      expect(create.statusCode, create.body).toBe(409);
      expect((create.json() as { error: { code: string } }).error.code).toBe('CUSTOM_FIELD_HOST_MANAGED');

      const edit = await h.app.inject({
        method: 'PATCH',
        url: `${API}/definitions/${id}`,
        ...ADMIN,
        payload: { labelDefault: 'Renamed while off' },
      });
      expect(edit.statusCode, edit.body).toBe(409);

      const option = await h.app.inject({
        method: 'POST',
        url: `${API}/definitions/${id}/options`,
        ...ADMIN,
        payload: { value: 'a', label: {}, labelDefault: 'a', isDefault: false, sortOrder: 0 },
      });
      expect(option.statusCode, option.body).toBe(409);

      const remove = await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
      expect(remove.statusCode, remove.body).toBe(409);
    });

    // Restored unchanged: off is non-destructive.
    const read = await h.app.inject({ method: 'GET', url: `${API}/definitions/${id}`, ...ADMIN });
    expect(read.statusCode, read.body).toBe(200);
    expect((read.json() as { data: { labelDefault: string } }).data.labelDefault).toBe('owner_presence_probe');
    const edit = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${id}`,
      ...ADMIN,
      payload: { labelDefault: 'Renamed while on' },
    });
    expect(edit.statusCode, edit.body).toBe(200);
  });

  it.each(UNOWNED.filter((type) => type !== 'product'))(
    'still creates, edits and deletes a definition of "%s" while that other module is off',
    async (entityType) => {
      await withModuleOff('crm', 'deactivated', async () => {
        const response = await define(entityType, `owner_presence_${entityType}`);
        expect(response.statusCode, response.body).toBe(201);
        const { id } = (response.json() as { data: { id: string } }).data;
        const edit = await h.app.inject({
          method: 'PATCH',
          url: `${API}/definitions/${id}`,
          ...ADMIN,
          payload: { labelDefault: 'Renamed' },
        });
        expect(edit.statusCode, edit.body).toBe(200);
        const remove = await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
        expect(remove.statusCode, remove.body).toBe(204);
      });
    },
  );

  it('keeps refusing the host-managed type for its own reason, in both states', async () => {
    const refusal = (response: { json(): unknown }) => {
      const { code, message } = (response.json() as { error: { code: string; message: string } }).error;
      return { code, message };
    };
    const on = await define('product', 'owner_presence_product');
    expect(on.statusCode, on.body).toBe(409);
    expect(refusal(on).message).toContain('"catalog"');
    await withModuleOff('crm', 'deactivated', async () => {
      const off = await define('product', 'owner_presence_product');
      expect(off.statusCode).toBe(409);
      expect(refusal(off)).toEqual(refusal(on));
    });
  });
});
