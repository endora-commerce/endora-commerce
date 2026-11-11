import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { createCrmOpportunity, submitCrmQuoteRequest } from '../../helpers/seed-crm.js';

/**
 * A host type whose owner module is not present is not a host type
 * (Constitution XVII; `specs/143-crm-sales-opportunities/research.md` R-26;
 * `specs/157-custom-fields-list-filters/` FR-005, FR-005a, SC-006).
 *
 * `SupportedEntityMeta.ownerModuleId` is optional. A type that declares one is
 * offered by `GET …/entity-types`, and its definitions are served and may be
 * changed, only while that module is effectively present. The generic layer
 * reads the marker's presence and never which module it names — each owned
 * type below is an instance, not a special case. Every type that declares no
 * owner answers exactly as before, in both states, which is the larger half of
 * what this file holds.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const API = '/api/v1/admin/custom-fields';
const UNOWNED = ['category', 'order', 'organization', 'customer', 'product'];
const AXES: OffStateAxis[] = ['deactivated', 'platform-unavailable'];

/**
 * The owned types, their owner module, the host table their values live on, and
 * — for the carry options of `specs/162-custom-fields-value-carry/` — the other
 * owned type that carries values to it (`source`, offered `order` too) and a
 * type whose only other target is it (`carrier`).
 */
const OWNED = [
  { entityType: 'opportunity', owner: 'crm', table: 'crm_opportunities', source: 'quote_request', carrier: 'order' },
  { entityType: 'quote_request', owner: 'quote_requests', table: 'quote_requests', source: 'opportunity', carrier: 'opportunity' },
] as const;
type Owned = (typeof OWNED)[number];

const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cf157_${RUN}_${name}`;

interface EntityTypeRow {
  entityType: string;
  labelKey: string;
  listFilter: boolean;
  carryTargets: string[];
  managedBy?: unknown;
}

/** The rows as they read once `absent` is no longer a carry target of any type (feature 162). */
const withoutCarryTarget = (rows: EntityTypeRow[], absent: string): EntityTypeRow[] =>
  rows.map((row) => ({ ...row, carryTargets: row.carryTargets.filter((target) => target !== absent) }));

interface DefinitionBody {
  id: string;
  key: string;
  labelDefault: string;
  listFilter: boolean;
  options: Array<{ id: string; value: string }>;
}

describe('custom_fields — a host type follows its owner module', () => {
  let h: BackendServerHandle;
  const created: string[] = [];

  const entityTypes = async (): Promise<EntityTypeRow[]> => {
    const response = await h.app.inject({ method: 'GET', url: `${API}/entity-types`, ...ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: EntityTypeRow[] }).data;
  };

  const define = (entityType: string, key: string, extra: Record<string, unknown> = {}) =>
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
        ...extra,
      },
    });

  const defineKept = async (
    entityType: string,
    key: string,
    extra: Record<string, unknown> = {},
  ): Promise<DefinitionBody> => {
    const response = await define(entityType, key, extra);
    expect(response.statusCode, response.body).toBe(201);
    const body = (response.json() as { data: DefinitionBody }).data;
    created.push(body.id);
    return body;
  };

  const readDefinition = (id: string) =>
    h.app.inject({ method: 'GET', url: `${API}/definitions/${id}`, ...ADMIN });

  const hostRecord = async (owned: Owned): Promise<string> =>
    owned.entityType === 'opportunity'
      ? (await createCrmOpportunity(h, { title: fixtureKey('owner_presence') })).id
      : (await submitCrmQuoteRequest(h)).id;

  const storedValues = async (owned: Owned, id: string): Promise<unknown> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "${owned.table}" where id = ?`, [id])) as Array<{
      custom_field_values: unknown;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.custom_field_values;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('offers every owned type while its owner is on, labelled from this module’s bundle', async () => {
    const rows = await entityTypes();
    // `project` (feature 163) and `task` (feature 165) are owned by `projects`
    // and `tasks` and carry nothing, so neither is a row of the carry-shaped
    // table above; their absence while the owner is off is proven in
    // `integration/projects/custom-fields.test.ts` and, for `task`, in
    // `integration/tasks/custom-fields-host.test.ts`.
    expect(rows.map((row) => row.entityType).sort()).toEqual(
      [...UNOWNED, ...OWNED.map((owned) => owned.entityType), 'project', 'task'].sort(),
    );
    expect(rows.find((row) => row.entityType === 'task')).toEqual({
      entityType: 'task',
      labelKey: 'customFields.entity.task',
      listFilter: true,
      carryTargets: [],
      customerInputSurfaces: [],
    });
    expect(rows.find((row) => row.entityType === 'project')).toEqual({
      entityType: 'project',
      labelKey: 'customFields.entity.project',
      listFilter: true,
      carryTargets: [],
      customerInputSurfaces: [],
    });
    expect(rows.find((row) => row.entityType === 'opportunity')).toEqual({
      entityType: 'opportunity',
      labelKey: 'customFields.entity.opportunity',
      listFilter: true,
      carryTargets: ['quote_request', 'order'],
      customerInputSurfaces: [],
    });
    expect(rows.find((row) => row.entityType === 'quote_request')).toEqual({
      entityType: 'quote_request',
      labelKey: 'customFields.entity.quoteRequest',
      listFilter: true,
      carryTargets: ['order', 'opportunity'],
      customerInputSurfaces: [],
    });
  });

  describe.each(OWNED)('$entityType, owned by $owner', (owned) => {
    it.each(AXES)(
      'omits the owned type while its owner is %s — as a type and as a carry target — and answers every other type exactly as before',
      async (axis) => {
        const before = await entityTypes();
        await withModuleOff(owned.owner, axis, async () => {
          const during = await entityTypes();
          expect(during.map((row) => row.entityType)).not.toContain(owned.entityType);
          expect(during.flatMap((row) => row.carryTargets)).not.toContain(owned.entityType);
          expect(during).toEqual(
            withoutCarryTarget(before.filter((row) => row.entityType !== owned.entityType), owned.entityType),
          );
        });
        expect(await entityTypes()).toEqual(before);
      },
    );

    it.each(AXES)(
      'refuses every definition and option write while its owner is %s — and nothing changes, values included',
      async (axis) => {
        const tag = `${owned.entityType}_${axis.replace(/-/g, '_')}`;
        const definition = await defineKept(owned.entityType, fixtureKey(`writes_${tag}`), {
          valueType: 'select',
          listFilter: true,
          options: [
            { value: 'a', label: {}, labelDefault: 'A', isDefault: false, sortOrder: 0 },
            { value: 'b', label: {}, labelDefault: 'B', isDefault: false, sortOrder: 1 },
          ],
        });
        const beforeRead = await readDefinition(definition.id);
        expect(beforeRead.statusCode, beforeRead.body).toBe(200);
        const before = beforeRead.json() as { data: DefinitionBody };
        expect(before.data.listFilter).toBe(true);
        const first = before.data.options[0];
        expect(first).toBeDefined();

        const recordId = await hostRecord(owned);
        await h
          .em()
          .getConnection()
          .execute(
            `update "${owned.table}" set custom_field_values = coalesce(custom_field_values, '{}'::jsonb) || ?::jsonb where id = ?`,
            [JSON.stringify({ [definition.key]: 'a' }), recordId],
          );
        const valuesBefore = await storedValues(owned, recordId);
        expect(valuesBefore).toMatchObject({ [definition.key]: 'a' });

        await withModuleOff(owned.owner, axis, async () => {
          const refusals = [
            await define(owned.entityType, fixtureKey(`second_${tag}`)),
            await h.app.inject({
              method: 'PATCH',
              url: `${API}/definitions/${definition.id}`,
              ...ADMIN,
              payload: { labelDefault: 'Renamed while off', listFilter: false },
            }),
            await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${definition.id}`, ...ADMIN }),
            await h.app.inject({
              method: 'POST',
              url: `${API}/definitions/${definition.id}/options`,
              ...ADMIN,
              payload: { value: 'c', label: {}, labelDefault: 'C', isDefault: false, sortOrder: 2 },
            }),
            await h.app.inject({
              method: 'PATCH',
              url: `${API}/definitions/${definition.id}/options/${first!.id}`,
              ...ADMIN,
              payload: { labelDefault: 'Renamed while off' },
            }),
            await h.app.inject({
              method: 'DELETE',
              url: `${API}/definitions/${definition.id}/options/${first!.id}`,
              ...ADMIN,
            }),
          ];
          for (const refusal of refusals) {
            expect(refusal.statusCode, refusal.body).toBe(409);
            expect((refusal.json() as { error: { code: string } }).error.code).toBe('CUSTOM_FIELD_HOST_MANAGED');
          }
        });

        // Off is non-destructive: the definition, its options and the stored value read back unchanged.
        const after = await readDefinition(definition.id);
        expect(after.statusCode, after.body).toBe(200);
        expect(after.json()).toEqual(before);
        expect(await storedValues(owned, recordId)).toEqual(valuesBefore);
      },
    );

    it.each(AXES)(
      'serves no definition of the owned type while its owner is %s — not in the list, not by type, not by id — and all of them again afterwards',
      async (axis) => {
        const tag = `${owned.entityType}_${axis.replace(/-/g, '_')}`;
        const ownedId = (await defineKept(owned.entityType, fixtureKey(`read_${tag}`))).id;
        const otherId = (await defineKept('organization', fixtureKey(`kept_${tag}`))).id;

        const list = async (query = '') => {
          const response = await h.app.inject({ method: 'GET', url: `${API}/definitions${query}`, ...ADMIN });
          expect(response.statusCode, response.body).toBe(200);
          return (response.json() as { data: Array<{ id: string; entityType: string }> }).data;
        };
        const before = await list();
        expect(before.map((row) => row.id)).toEqual(expect.arrayContaining([ownedId, otherId]));

        await withModuleOff(owned.owner, axis, async () => {
          // Everything of the other types, in the order it had; nothing of this one.
          expect(await list()).toEqual(before.filter((row) => row.entityType !== owned.entityType));
          expect(await list(`?entityType=${owned.entityType}`)).toEqual([]);
          expect((await list('?entityType=organization')).map((row) => row.id)).toContain(otherId);

          const byId = await readDefinition(ownedId);
          expect(byId.statusCode, byId.body).toBe(404);
          expect((byId.json() as { error: { code: string } }).error.code).toBe('CUSTOM_FIELD_NOT_FOUND');
          const kept = await readDefinition(otherId);
          expect(kept.statusCode, kept.body).toBe(200);
        });

        // Off is non-destructive: the same list, and the same definition by id.
        expect(await list()).toEqual(before);
        const restored = await readDefinition(ownedId);
        expect(restored.statusCode, restored.body).toBe(200);
      },
    );

    it.each(UNOWNED.filter((type) => type !== 'product'))(
      'still creates, edits and deletes a definition of "%s" while that owner is off',
      async (entityType) => {
        await withModuleOff(owned.owner, 'deactivated', async () => {
          const response = await define(entityType, fixtureKey(`unowned_${owned.entityType}_${entityType}`));
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
      const key = fixtureKey(`product_${owned.entityType}`);
      const on = await define('product', key);
      expect(on.statusCode, on.body).toBe(409);
      expect(refusal(on).message).toContain('"catalog"');
      await withModuleOff(owned.owner, 'deactivated', async () => {
        const off = await define('product', key);
        expect(off.statusCode).toBe(409);
        expect(refusal(off)).toEqual(refusal(on));
      });
    });
  });

  // `specs/162-custom-fields-value-carry/` FR-005, research R-12 — a carry to a
  // type whose owner is off is hidden and inert, never dropped, and offered
  // again with the owner.
  describe.each(OWNED)('carry options naming $entityType, owned by $owner', (owned) => {
    const storedCarryTo = async (id: string): Promise<string[]> => {
      const rows = (await h
        .em()
        .getConnection()
        .execute(`select carry_to from "custom_field_definitions" where id = ?`, [id])) as Array<{
        carry_to: string[];
      }>;
      expect(rows).toHaveLength(1);
      return [...rows[0]!.carry_to].sort();
    };

    it.each(AXES)(
      'hides the carry while the owner is %s, keeps it through a save, refuses a new one, and serves it again afterwards',
      async (axis) => {
        const tag = `${owned.entityType}_${axis.replace(/-/g, '_')}`;
        const key = fixtureKey(`carry_${tag}`);
        await defineKept('order', key);
        await defineKept(owned.entityType, key);
        const source = await defineKept(owned.source, key, { carryTo: ['order', owned.entityType] });
        const both = ['order', owned.entityType].sort();
        expect(await storedCarryTo(source.id)).toEqual(both);

        const carrierKey = fixtureKey(`carrier_${tag}`);
        await defineKept(owned.entityType, carrierKey);
        const carrier = await defineKept(owned.carrier, carrierKey);

        await withModuleOff(owned.owner, axis, async () => {
          const served = await readDefinition(source.id);
          expect(served.statusCode, served.body).toBe(200);
          expect((served.json() as { data: { carryTo: string[] } }).data.carryTo).toEqual(['order']);

          const save = await h.app.inject({
            method: 'PATCH',
            url: `${API}/definitions/${source.id}`,
            ...ADMIN,
            payload: { labelDefault: 'Saved while off', carryTo: ['order'] },
          });
          expect(save.statusCode, save.body).toBe(200);
          expect((save.json() as { data: { carryTo: string[] } }).data.carryTo).toEqual(['order']);
          expect(await storedCarryTo(source.id)).toEqual(both);

          const turnOn = await h.app.inject({
            method: 'PATCH',
            url: `${API}/definitions/${carrier.id}`,
            ...ADMIN,
            payload: { carryTo: [owned.entityType] },
          });
          expect(turnOn.statusCode, turnOn.body).toBe(422);
          const error = (turnOn.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
          expect(error.code).toBe('CUSTOM_FIELD_CARRY_INCOMPATIBLE');
          expect(error.details).toMatchObject({ code: 'target_unavailable', targetEntityType: owned.entityType });
          expect(await storedCarryTo(carrier.id)).toEqual([]);
        });

        const restored = await readDefinition(source.id);
        expect(restored.statusCode, restored.body).toBe(200);
        expect([...(restored.json() as { data: { carryTo: string[] } }).data.carryTo].sort()).toEqual(both);
      },
    );
  });
});
