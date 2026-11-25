import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrder } from '../../helpers/seed-crm.js';

/**
 * The list-filter option of a custom-field definition
 * (`specs/157-custom-fields-list-filters/` FR-001 – FR-004, FR-003a, US3).
 *
 * The option is a definition attribute: settable on the entity types whose
 * registry entry offers it (Order, Quote Request, Opportunity) and refused
 * elsewhere, written by one audited Command, and never touching a host row.
 * Every editor action — the option, labels, `required`, options — is one
 * audited Command of its own.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `cf157_${RUN}_${name}`;
const VALUE_TYPES = ['text', 'number', 'boolean', 'date', 'select', 'multiselect'] as const;
const SELECT_TYPES = new Set(['select', 'multiselect']);

interface DefinitionBody {
  id: string;
  key: string;
  listFilter: boolean;
  options: Array<{ id: string; value: string; labelDefault: string; sortOrder: number }>;
}

interface AuditRow {
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
}

/** The members whose value differs between an audit entry's before and after. */
function changedMembers(entry: AuditRow): string[] {
  const before = entry.stateBefore ?? {};
  const after = entry.stateAfter ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

describe('custom_fields — the list-filter option of a definition', () => {
  let h: BackendServerHandle;
  let reader: { cookies: { b2b_session: string }; undo: () => void };
  let polish: { cookies: { b2b_session: string }; undo: () => void };
  const created: string[] = [];

  const option = (value: string, sortOrder = 0) => ({
    value,
    label: {},
    labelDefault: value.toUpperCase(),
    isDefault: false,
    sortOrder,
  });

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

  const patch = (id: string, payload: Record<string, unknown>, cookies = ADMIN.cookies) =>
    h.app.inject({ method: 'PATCH', url: `${API}/definitions/${id}`, cookies, payload });

  const read = async (id: string): Promise<DefinitionBody> => {
    const response = await h.app.inject({ method: 'GET', url: `${API}/definitions/${id}`, ...ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: DefinitionBody }).data;
  };

  const audit = async (action: string, objectId: string): Promise<AuditRow[]> =>
    (await h.auditLogService.query({ action, objectId })) as unknown as AuditRow[];

  const orderValuesText = async (orderId: string): Promise<string> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values::text as v from "orders" where id = ?`, [orderId])) as Array<{
      v: string;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.v;
  };

  const orderHolding = async (key: string, value: unknown): Promise<string> => {
    const order = await seedCrmOrder(h.em());
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [
        JSON.stringify({ [key]: value }),
        order.id,
      ]);
    return order.id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    reader = await seedCrmAdmin(h.em(), `cf157_reader_${RUN}`, ['custom_fields:read']);
    polish = await seedCrmAdmin(h.em(), `cf157_pl_${RUN}`, ['custom_fields:read', 'custom_fields:write']);
    const language = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: polish.cookies,
      payload: { preferredLanguage: 'pl' },
    });
    expect(language.statusCode, language.body).toBe(200);
  });

  afterAll(async () => {
    reader.undo();
    polish.undo();
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  it.each(VALUE_TYPES)('creates an Order definition of type "%s" as a list filter', async (valueType) => {
    const definition = await defineKept('order', fixtureKey(`type_${valueType}`), {
      valueType,
      listFilter: true,
      options: SELECT_TYPES.has(valueType) ? [option('a')] : [],
    });
    expect(definition.listFilter).toBe(true);
    expect((await read(definition.id)).listFilter).toBe(true);
  });

  it('creates a definition without the member as not a list filter', async () => {
    const definition = await defineKept('order', fixtureKey('absent'));
    expect(definition.listFilter).toBe(false);
  });

  it('turns the option on and off, each by one audited write, leaving the stored values as they were', async () => {
    const definition = await defineKept('order', fixtureKey('toggle'));
    const orderId = await orderHolding(definition.key, 'kept as it is');
    const valuesBefore = await orderValuesText(orderId);

    for (const listFilter of [true, false]) {
      const before = (await audit('custom_fields.definition.updated', definition.id)).length;
      const response = await patch(definition.id, { listFilter });
      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: DefinitionBody }).data.listFilter).toBe(listFilter);
      const entries = await audit('custom_fields.definition.updated', definition.id);
      expect(entries).toHaveLength(before + 1);
      expect(changedMembers(entries[0]!)).toEqual(['listFilter']);
    }

    for (const [payload, member] of [
      [{ label: { en: 'Relabelled', pl: 'Nowa etykieta' } }, 'label'],
      [{ required: true }, 'required'],
    ] as const) {
      const before = (await audit('custom_fields.definition.updated', definition.id)).length;
      const response = await patch(definition.id, payload);
      expect(response.statusCode, response.body).toBe(200);
      const entries = await audit('custom_fields.definition.updated', definition.id);
      expect(entries).toHaveLength(before + 1);
      expect(changedMembers(entries[0]!)).toEqual([member]);
    }

    expect(await orderValuesText(orderId)).toBe(valuesBefore);
  });

  it('audits every option action as its own Command', async () => {
    const definition = await defineKept('order', fixtureKey('options'), {
      valueType: 'select',
      options: [option('a', 0)],
    });

    const added = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions/${definition.id}/options`,
      ...ADMIN,
      payload: option('b', 1),
    });
    expect(added.statusCode, added.body).toBe(201);
    const optionId = (added.json() as { data: { id: string } }).data.id;
    const createdEntries = await h.auditLogService.query({ action: 'custom_fields.option.created' });
    expect(
      (createdEntries as unknown as AuditRow[]).filter((entry) => entry.stateAfter?.['id'] === optionId),
    ).toHaveLength(1);

    const relabel = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${definition.id}/options/${optionId}`,
      ...ADMIN,
      payload: { labelDefault: 'Bee' },
    });
    expect(relabel.statusCode, relabel.body).toBe(200);
    const relabelled = await audit('custom_fields.option.updated', optionId);
    expect(relabelled).toHaveLength(1);
    expect(changedMembers(relabelled[0]!)).toEqual(['labelDefault']);

    const translate = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${definition.id}/options/${optionId}`,
      ...ADMIN,
      payload: { label: { pl: 'Pszczoła' } },
    });
    expect(translate.statusCode, translate.body).toBe(200);
    const translated = await audit('custom_fields.option.updated', optionId);
    expect(translated).toHaveLength(2);
    expect(changedMembers(translated[0]!)).toEqual(['label']);

    const reorder = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${definition.id}/options/${optionId}`,
      ...ADMIN,
      payload: { sortOrder: 5 },
    });
    expect(reorder.statusCode, reorder.body).toBe(200);
    const reordered = await audit('custom_fields.option.updated', optionId);
    expect(reordered).toHaveLength(3);
    expect(changedMembers(reordered[0]!)).toEqual(['sortOrder']);

    const makeDefault = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${definition.id}/options/${optionId}`,
      ...ADMIN,
      payload: { isDefault: true },
    });
    expect(makeDefault.statusCode, makeDefault.body).toBe(200);
    const defaulted = await audit('custom_fields.option.updated', optionId);
    expect(defaulted).toHaveLength(4);
    expect(changedMembers(defaulted[0]!)).toEqual(['isDefault']);

    const remove = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${definition.id}/options/${optionId}`,
      ...ADMIN,
    });
    expect(remove.statusCode, remove.body).toBe(204);
    expect(await audit('custom_fields.option.deleted', optionId)).toHaveLength(1);
  });

  // Issue #1903 — `organization` and `customer` offer the option now; `category` still does not.
  it.each(['category'])(
    'refuses the option on "%s" (422) on create and on edit, and accepts false',
    async (entityType) => {
      const refusedCreate = await define(entityType, fixtureKey(`refused_${entityType}`), { listFilter: true });
      expect(refusedCreate.statusCode, refusedCreate.body).toBe(422);
      expect((refusedCreate.json() as { error: { code: string } }).error.code).toBe(
        'CUSTOM_FIELD_DEFINITION_INVALID',
      );

      const definition = await defineKept(entityType, fixtureKey(`plain_${entityType}`), { listFilter: false });
      expect(definition.listFilter).toBe(false);

      const refusedEdit = await patch(definition.id, { listFilter: true });
      expect(refusedEdit.statusCode, refusedEdit.body).toBe(422);
      expect((refusedEdit.json() as { error: { code: string } }).error.code).toBe(
        'CUSTOM_FIELD_DEFINITION_INVALID',
      );
      expect((await read(definition.id)).listFilter).toBe(false);

      const accepted = await patch(definition.id, { listFilter: false });
      expect(accepted.statusCode, accepted.body).toBe(200);
    },
  );

  it('answers listFilter: true in entity-types for exactly order, organization, customer, quote_request, opportunity, project and task', async () => {
    const response = await h.app.inject({ method: 'GET', url: `${API}/entity-types`, ...ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    const rows = (response.json() as { data: Array<{ entityType: string; listFilter: boolean }> }).data;
    expect(
      rows
        .filter((row) => row.listFilter)
        .map((row) => row.entityType)
        .sort(),
    ).toEqual(['customer', 'opportunity', 'order', 'organization', 'project', 'quote_request', 'task']);
    for (const row of rows) expect(typeof row.listFilter).toBe('boolean');
  });

  it('keeps an option’s stored value when an edit sends one', async () => {
    const definition = await defineKept('order', fixtureKey('option_value'), {
      valueType: 'select',
      options: [option('a')],
    });
    const optionId = definition.options[0]!.id;
    const response = await h.app.inject({
      method: 'PATCH',
      url: `${API}/definitions/${definition.id}/options/${optionId}`,
      ...ADMIN,
      payload: { value: 'renamed', labelDefault: 'Relabelled' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const stored = (await read(definition.id)).options.find((o) => o.id === optionId);
    expect(stored?.value).toBe('a');
    expect(stored?.labelDefault).toBe('Relabelled');
  });

  it('refuses to remove an option an Order holds, naming it, and to change the type while values exist', async () => {
    const definition = await defineKept('order', fixtureKey('in_use'), {
      valueType: 'select',
      options: [option('held'), option('free', 1)],
    });
    await orderHolding(definition.key, 'held');
    const held = definition.options.find((o) => o.value === 'held')!;

    const remove = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${definition.id}/options/${held.id}`,
      ...ADMIN,
    });
    expect(remove.statusCode, remove.body).toBe(409);
    const refused = (remove.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
    expect(refused.code).toBe('CUSTOM_FIELD_OPTION_IN_USE');
    expect(refused.details).toMatchObject({ value: 'held', label: 'HELD' });
    expect(refused.message).toBe(
      'The option “HELD” can\'t be removed because some records still use it. Change their value first.',
    );

    const polishRemove = await h.app.inject({
      method: 'DELETE',
      url: `${API}/definitions/${definition.id}/options/${held.id}`,
      cookies: polish.cookies,
    });
    expect(polishRemove.statusCode, polishRemove.body).toBe(409);
    expect((polishRemove.json() as { error: { message: string } }).error.message).toBe(
      'Nie można usunąć opcji „HELD”, bo używają jej niektóre rekordy. Najpierw zmień ich wartość.',
    );

    const retype = await patch(definition.id, { valueType: 'text', options: [] });
    expect(retype.statusCode, retype.body).toBe(409);
    const locked = (retype.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
    expect(locked.code).toBe('CUSTOM_FIELD_VALUE_TYPE_LOCKED');
    expect(locked.details).toMatchObject({ key: definition.key });
    expect(locked.message).toBe(
      `The type of the field “${definition.key}” can't be changed while records hold values for it. Clear those values first.`,
    );
  });

  it('refuses an edit from an administrator who may only read custom fields', async () => {
    const definition = await defineKept('order', fixtureKey('read_only'));
    const response = await patch(definition.id, { listFilter: true }, reader.cookies);
    expect(response.statusCode, response.body).toBe(403);
    expect((await read(definition.id)).listFilter).toBe(false);
  });
});
