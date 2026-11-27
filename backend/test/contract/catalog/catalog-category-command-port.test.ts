import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type CatalogCategoryCommandPort,
  type CatalogCategoryReadPort,
  type CatalogCategoryWritePort,
  type CustomFieldValuePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';

/**
 * `specs/186-aggregate-ports/` T083, T085 (issue #1826, US8; research R-20) —
 * `catalogCategoryCommandPort` runs the Command the admin route for the same
 * operation runs. Each case performs the operation twice, once through the
 * route and once through the port under the same administrator, on two
 * categories in the same state, and holds what each wrote to the other
 * (`expectPortParity`): the audit entries, the hooks, the outbox rows, and a
 * side-effect probe — the `category.updated.v1` events, which drive the search
 * re-index and the storefront navigation flush, and the default-channel bind of
 * a create.
 *
 * `setCustomFieldValues` is measured against the admin `PATCH` carrying only
 * custom-field values (R-20.2); `setInventoryThresholds` against `inventory`'s
 * `PATCH …/thresholds`, which now reaches the category through this port and
 * no longer counts it in its own summary (R-20.3 — the no-double-audit case).
 * Then the deprecated `catalogCategoryWritePort`: every method delegates and
 * writes the same entry. Then the port's own additions: `source`, unclaimed
 * extensions, the refusals.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CATEGORIES = '/api/v1/admin/catalog/categories';
const DEFINITIONS = '/api/v1/admin/custom-fields/definitions';

describe('catalogCategoryCommandPort — the admin routes’ Commands (#1826)', () => {
  let h: BackendServerHandle;
  let port: CatalogCategoryCommandPort;
  const stamp = randomUUID().replace(/-/g, '').slice(0, 8);
  let seq = 0;
  const slug = (): string => `p186c-${stamp}-${seq++}`;
  const definitions: string[] = [];
  const updatedEvents: string[] = [];
  let offUpdated: () => void = () => {};

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: catalog category command port', fn);

  async function route(method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: ADMIN, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(status);
    return res.body ? (res.json() as { data: Record<string, unknown> }) : null;
  }

  /** The `category.updated.v1` events for one category — search re-index and navigation flush. */
  const updatedFor = (id: string) => () => updatedEvents.filter((e) => e === id).length;

  function observe<T>(
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>(
      { em: () => h.em().fork(), objectType: 'category', objectId, ...(probe ? { probe } : {}) },
      write,
    ).then(({ observation }) => observation);
  }

  /** A fresh root category, created by the admin route. */
  async function fresh(extra: Record<string, unknown> = {}): Promise<string> {
    const s = slug();
    const res = await route('POST', CATEGORIES, { name: { en: `Port ${s}` }, slug: s, ...extra }, 201);
    return res!.data['id'] as string;
  }

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  const entries = (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'category', objectId }, { orderBy: { actedAt: 'asc' } });

  const channelCount = async (categoryId: string): Promise<number> => {
    const rows = await h
      .em()
      .fork()
      .getConnection()
      .execute<Array<{ n: string }>>(
        'select count(*)::text as n from "sales_channel_categories" where "category_id" = ?',
        [categoryId],
      );
    expect(rows).toHaveLength(1);
    return Number(rows[0]!.n);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    port = h.container.resolve<CatalogCategoryCommandPort>('catalogCategoryCommandPort');
    offUpdated = h.eventBus.on('category.updated.v1' as never, (payload: unknown) => {
      updatedEvents.push((payload as { categoryId: string }).categoryId);
    });
    const res = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS,
      cookies: ADMIN,
      payload: {
        entityType: 'category',
        key: `p186c_note_${stamp}`,
        labelDefault: 'Port note',
        label: {},
        valueType: 'text',
        required: false,
        audience: 'internal',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    definitions.push((res.json().data as { id: string }).id);
  });

  afterAll(async () => {
    offUpdated();
    for (const id of definitions) {
      await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS}/${id}`, cookies: ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('create — category.create, bound to the default channel, as the admin create', async () => {
    const body = () => {
      const s = slug();
      return { name: { en: `Created ${s}` }, slug: s, sortOrder: 3 };
    };
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          (res) => res!.data['id'] as string,
          () => route('POST', CATEGORIES, body(), 201),
          (res) => channelCount(res!.data['id'] as string),
        ),
      viaPort: () =>
        observe(
          (record) => record.id,
          () => asAdmin(() => port.create(body())),
          (record) => channelCount(record.id),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['category.create']);
    expect(viaPort.sideEffects).toBe(1);
  });

  it('update — category.update and the navigation event, as the admin PATCH', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a, () => route('PATCH', `${CATEGORIES}/${a}`, { name: { en: 'Renamed A' }, isActive: false }), updatedFor(a)),
      viaPort: () =>
        observe(b, () => asAdmin(() => port.update(b, { name: { en: 'Renamed B' }, isActive: false })), updatedFor(b)),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['category.update']);
    expect(viaPort.sideEffects).toBe(1);
  });

  it('move — category.update with the parent and sort order, the navigation refreshed, as the admin PATCH', async () => {
    const [parentA, parentB] = [await fresh(), await fresh()];
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a, () => route('PATCH', `${CATEGORIES}/${a}`, { parentCategoryId: parentA, sortOrder: 7 }), updatedFor(a)),
      viaPort: () =>
        observe(b, () => asAdmin(() => port.move(b, { parentId: parentB, position: 7 })), updatedFor(b)),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['category.update']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ parentCategoryId: parentB, sortOrder: 7 });
    expect(viaPort.sideEffects).toBe(1);

    // Back to the root, the sort order left as it is.
    const moved = await asAdmin(() => port.move(b, { parentId: null }));
    expect(moved.parentCategoryId).toBeNull();
    expect(moved.sortOrder).toBe(7);
  });

  it('move — a parent under the category itself is refused 409 CATEGORY_MOVE_CYCLE, nothing written', async () => {
    const parent = await fresh();
    const child = await fresh({ parentCategoryId: parent });
    const before = (await entries(parent)).length;
    expect(await refusal(asAdmin(() => port.move(parent, { parentId: child })))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.CATEGORY_MOVE_CYCLE,
    });
    expect((await entries(parent)).length).toBe(before);
  });

  it('delete — category.delete, as the admin DELETE; live children refused 409 CATEGORY_HAS_CHILDREN', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe(a, () => route('DELETE', `${CATEGORIES}/${a}`, undefined, 204)),
      viaPort: () => observe(b, () => asAdmin(() => port.delete(b))),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['category.delete']);

    const parent = await fresh();
    await fresh({ parentCategoryId: parent });
    expect(await refusal(asAdmin(() => port.delete(parent)))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.CATEGORY_HAS_CHILDREN,
    });
  });

  it('setCustomFieldValues — category.update, as the admin PATCH carrying only values (R-20.2)', async () => {
    const key = `p186c_note_${stamp}`;
    const values = h.container.resolve<CustomFieldValuePort>('customFieldValueService');
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a, () => route('PATCH', `${CATEGORIES}/${a}`, { customFieldValues: { [key]: 'From the admin' } }), updatedFor(a)),
      viaPort: () =>
        observe(
          b,
          () =>
            asAdmin(() =>
              port.setCustomFieldValues(b, (current) =>
                values.validateAndMerge('category', current, { [key]: 'From the port' }),
              ),
            ),
          updatedFor(b),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['category.update']);
    const read = h.container.resolve<CatalogCategoryReadPort>('catalogCategoryReadPort');
    expect((await read.findById(b))!.customFieldValues).toEqual({ [key]: 'From the port' });

    // A refusal the merge throws propagates unchanged and writes nothing.
    const before = (await entries(b)).length;
    const refused = await refusal(
      asAdmin(() =>
        port.setCustomFieldValues(b, async () => {
          throw Object.assign(new Error('refused by the caller'), { statusCode: 422, code: 'CALLER_REFUSED' });
        }),
      ),
    );
    expect(refused).toEqual({ statusCode: 422, code: 'CALLER_REFUSED' });
    expect((await entries(b)).length).toBe(before);
    expect((await read.findById(b))!.customFieldValues).toEqual({ [key]: 'From the port' });
  });

  it('setInventoryThresholds — category.inventory_thresholds.set, once, as inventory’s threshold PATCH (no double audit)', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const summaries = () => h.em().fork().count(AuditLogEntry, { action: 'low_stock_threshold.update' });
    const summariesBefore = await summaries();
    const { route: viaRoute, port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe(a, () =>
          route('PATCH', '/api/v1/admin/inventory/thresholds', {
            perCategory: [{ categoryId: a, high: 50, medium: 10, low: 2 }],
          }),
          updatedFor(a),
        ),
      viaPort: () =>
        observe(b, () => asAdmin(() => port.setInventoryThresholds(b, { high: 50, medium: 10, low: 2 })), updatedFor(b)),
    });
    expect(viaRoute.audit.map((e) => e.action)).toEqual(['category.inventory_thresholds.set']);
    expect(viaPort.audit[0]!.stateAfter).toEqual({
      inventoryThresholdHigh: 50,
      inventoryThresholdMedium: 10,
      inventoryThresholdLow: 2,
    });
    // No search re-index or navigation flush for a threshold patch.
    expect(viaPort.sideEffects).toBe(0);
    // `inventory` audits its own settings only: a categories-only patch adds no summary row.
    expect(await summaries()).toBe(summariesBefore);

    // The same values again change nothing and record nothing.
    const before = (await entries(b)).length;
    await asAdmin(() => port.setInventoryThresholds(b, { high: 50 }));
    expect((await entries(b)).length).toBe(before);
  });

  describe('the deprecated catalogCategoryWritePort delegates (T085)', () => {
    let writePort: CatalogCategoryWritePort;
    beforeAll(() => {
      writePort = h.container.resolve<CatalogCategoryWritePort>('catalogCategoryWritePort');
    });

    it('create and update write the entries the port writes', async () => {
      const body = () => {
        const s = slug();
        return { name: { en: `Deprecated ${s}` }, slug: s };
      };
      await expectPortParity({
        viaRoute: () => observe((r) => r.id, () => asAdmin(() => writePort.create(body()))),
        viaPort: () => observe((r) => r.id, () => asAdmin(() => port.create(body()))),
      });
      const [a, b] = [await fresh(), await fresh()];
      await expectPortParity({
        viaRoute: () => observe(a, () => asAdmin(() => writePort.update(a, { sortOrder: 4 })), updatedFor(a)),
        viaPort: () => observe(b, () => asAdmin(() => port.update(b, { sortOrder: 4 })), updatedFor(b)),
      });
    });

    it('setInventoryThresholds writes the entry the port writes', async () => {
      const [a, b] = [await fresh(), await fresh()];
      await expectPortParity({
        viaRoute: () => observe(a, () => asAdmin(() => writePort.setInventoryThresholds(a, { low: 3 }))),
        viaPort: () => observe(b, () => asAdmin(() => port.setInventoryThresholds(b, { low: 3 }))),
      });
    });

    it('listAll answers the read port’s live tree', async () => {
      const read = h.container.resolve<CatalogCategoryReadPort>('catalogCategoryReadPort');
      const gone = await fresh();
      await asAdmin(() => port.delete(gone));
      const listed = await writePort.listAll();
      expect(listed).toEqual(await read.listAll({ liveOnly: true }));
      expect(listed.some((c) => c.id === gone)).toBe(false);
    });
  });

  describe('the port’s own options and refusals', () => {
    it('records source beside the actor; ignores expectedVersion', async () => {
      const id = await fresh();
      await asAdmin(() => port.move(id, { parentId: null, position: 9 }, { source: 'erp.categories', expectedVersion: 99 }));
      const [last] = (await entries(id)).slice(-1);
      expect(last!.action).toBe('category.update');
      expect(last!.actorAdminUserId).toBe(TEST_ADMIN_ID);
      expect(last!.stateAfter).toMatchObject({ source: 'erp.categories', sortOrder: 9 });
    });

    it('refuses a malformed source 422 VALIDATION_FAILED before anything is written', async () => {
      const id = await fresh();
      const before = (await entries(id)).length;
      expect(await refusal(asAdmin(() => port.update(id, { sortOrder: 1 }, { source: 'Not A Code' })))).toEqual({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect((await entries(id)).length).toBe(before);
    });

    it('refuses an extension key no hook module claims 422 COMMAND_EXTENSION_UNCLAIMED, nothing written', async () => {
      const id = await fresh();
      const before = (await entries(id)).length;
      expect(
        await refusal(asAdmin(() => port.update(id, { sortOrder: 2 }, { extensions: { nobody: { x: 1 } } }))),
      ).toEqual({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
      expect((await entries(id)).length).toBe(before);
    });

    it('answers the admin route’s refusals', async () => {
      expect(await refusal(asAdmin(() => port.update(randomUUID(), { sortOrder: 1 })))).toEqual({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
      expect(await refusal(asAdmin(() => port.update('not-a-uuid', { sortOrder: 1 })))).toEqual({
        statusCode: 404,
        code: ERROR_CODES.NOT_FOUND,
      });
      expect(await refusal(asAdmin(() => port.create({ name: { en: 'Bad' }, slug: 'Not Kebab' })))).toEqual({
        statusCode: 422,
        code: ERROR_CODES.VALIDATION_FAILED,
      });
      expect(
        await refusal(asAdmin(() => port.move(randomUUID(), { parentId: 'not-a-uuid' }))),
      ).toEqual({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
      const taken = slug();
      await asAdmin(() => port.create({ name: { en: 'Taken' }, slug: taken }));
      expect(await refusal(asAdmin(() => port.create({ name: { en: 'Taken again' }, slug: taken })))).toEqual({
        statusCode: 409,
        code: ERROR_CODES.CATEGORY_SLUG_TAKEN,
      });
      expect(
        await refusal(asAdmin(() => port.setInventoryThresholds(randomUUID(), { high: 1.5 } as never))),
      ).toEqual({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
    });
  });
});
