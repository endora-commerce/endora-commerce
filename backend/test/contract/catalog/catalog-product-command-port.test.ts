import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  type CatalogProductCommandPort,
  type CatalogProductScopeWritePort,
  type CatalogProductWritePort,
  type ProductScopedWriteCell,
} from '@endora-commerce/contracts';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { expectPortParity, observeWrite, type ParityObservation } from '../../helpers/aggregate-port-parity.js';

/**
 * `specs/186-aggregate-ports/` T071 (issue #1825, US6) — `catalogProductCommandPort` runs the
 * Command the admin route for the same operation runs. Each case performs the operation twice,
 * once through the route and once through the port under the same administrator, on two
 * products in the same state, and holds what each wrote to the other (`expectPortParity`): the
 * audit entries, and a side-effect probe — the `product.*` events announced for the product
 * (the search index, the page revalidation and the webhooks react to them) and, for `create`,
 * the default sales channel binding.
 *
 * `applyScopedValues` has no admin route (the editor's save is a different operation, research
 * R-19.1): it is measured against the deprecated `catalogProductScopeWritePort.applyScopes`,
 * which ran the same Command until now. `setCustomFieldValues` is measured against the admin
 * `PATCH` with `attributeValues` only (R-19.2).
 *
 * Then the port's own additions: `source` recorded beside the actor, a malformed `source` and
 * an unclaimed extension refused with nothing written, the editor version `update` honours, and
 * the deprecated write port's entries.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const PRODUCTS = '/api/v1/admin/catalog/products';
const EVENTS = ['product.created.v1', 'product.updated.v1', 'product.archived.v1', 'product.deleted.v1'] as const;

describe('catalogProductCommandPort — the admin routes’ Commands (#1825)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let port: CatalogProductCommandPort;
  let note: string;
  let colour: string;
  let mandatory: string;
  let channel: string;
  const announced: Array<{ name: string; productId: string; changedFields?: string[] }> = [];
  const offs: Array<() => void> = [];
  let seq = 0;
  const sku = (): string => `P186-${fx.run}-${seq++}`;

  const asAdmin = <T>(fn: () => Promise<T>): Promise<T> =>
    withSystemScopeActingFor(TEST_ADMIN_ID, 'test: catalog product command port', fn);

  /**
   * The events announced for one product, in order: what the indexer and the webhooks saw.
   * Command events are dispatched, awaited, before the write returns. The variant writes'
   * `['variants']` announcement is an unscoped `emit` (not awaited, inventory finding 5), which
   * reaches this recorder only after the handlers registered before it — the search indexer
   * among them — have finished. So a probe that expects one names how many events the product
   * must have (`atLeast`) and waits for them (no fixed quiet period, which a slow indexer
   * outlasts); it then settles briefly, so an extra event still fails the parity.
   */
  const eventsOf = async (productId: string, atLeast = 0) => {
    const forProduct = () => announced.filter((event) => event.productId === productId);
    await vi.waitFor(() => expect(forProduct().length).toBeGreaterThanOrEqual(atLeast), { timeout: 15_000, interval: 50 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return forProduct().map(({ name, changedFields }) =>
      changedFields ? { name, changedFields: [...changedFields].sort() } : { name },
    );
  };

  async function route(method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, status = 200) {
    const res = await h.app.inject({ method, url, cookies: ADMIN, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(status);
    return res.body ? (res.json() as { data: Record<string, unknown> }) : null;
  }

  function observe<T>(
    objectType: string,
    objectId: string | ((result: T) => string),
    write: () => Promise<T>,
    probe?: (result: T) => unknown,
  ): Promise<ParityObservation> {
    return observeWrite<T>({ em: () => h.em().fork(), objectType, objectId, ...(probe ? { probe } : {}) }, write).then(
      ({ observation }) => observation,
    );
  }

  /** A product through the admin create, in the fixture's attribute set. */
  const fresh = (input: Parameters<ScopedValuesFixture['product']>[0] = {}) =>
    fx.product({ ...input, attributeValues: { [mandatory]: 'set', ...(input.attributeValues ?? {}) } });

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  const entries = (productId: string) =>
    fx.sql<{ action: string; actor_admin_user_id: string | null; state_after: Record<string, unknown> | null }>(
      `select action, actor_admin_user_id, state_after from audit_log_entries
        where object_type = 'product' and object_id = ? order by acted_at, id`,
      [productId],
    );
  const channelsOf = async (productId: string) =>
    (await fx.sql<{ n: number }>(`select count(*)::int as n from sales_channel_products where product_id = ?`, [productId]))[0]!.n;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    port = h.container.resolve<CatalogProductCommandPort>('catalogProductCommandPort');
    note = await fx.attribute({ key: 'note', valueType: 'string' });
    colour = await fx.attribute({ key: 'colour', valueType: 'select', options: ['red', 'blue'] });
    mandatory = await fx.attribute({ key: 'mandatory', valueType: 'string', isRequired: true });
    channel = await fx.channel(['pl-PL']);
    for (const name of EVENTS) {
      offs.push(
        h.eventBus.on(name, (payload) => {
          const p = payload as unknown as { productId: string; changedFields?: string[] };
          announced.push({ name, productId: p.productId, ...(p.changedFields ? { changedFields: p.changedFields } : {}) });
        }),
      );
    }
  });

  afterAll(async () => {
    for (const off of offs) off();
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('create — product.create, the default channel bound, product.created.v1', async () => {
    const body = () => ({
      sku: sku(),
      type: 'simple' as const,
      name: 'Port drill',
      description: 'Created',
      categoryIds: [],
      attributeValues: {},
      visibility: 'public' as const,
    });
    const probe = async (id: string) => ({ events: await eventsOf(id), channels: await channelsOf(id) });
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          'product',
          (res) => res!.data['id'] as string,
          () => route('POST', PRODUCTS, body(), 201),
          (res) => probe(res!.data['id'] as string),
        ),
      viaPort: () =>
        observe(
          'product',
          (record) => record.id,
          () => asAdmin(() => port.create(body())),
          (record) => probe(record.id),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['product.create']);
    expect(viaPort.sideEffects).toMatchObject({ events: [{ name: 'product.created.v1' }] });
  });

  it('update — product.update, product.updated.v1 naming the changed fields', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe('product', a, () => route('PATCH', `${PRODUCTS}/${a}`, { name: 'Renamed', visibility: 'logged_in_only' }), () =>
          eventsOf(a),
        ),
      viaPort: () =>
        observe('product', b, () => asAdmin(() => port.update(b, { name: 'Renamed', visibility: 'logged_in_only' })), () =>
          eventsOf(b),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['product.update']);
  });

  it('archive and restore — product.archive / product.restore and their announcements', async () => {
    const [a, b] = [await fresh(), await fresh()];
    for (const step of ['archive', 'restore'] as const) {
      const { port: viaPort } = await expectPortParity({
        viaRoute: () => observe('product', a, () => route('POST', `${PRODUCTS}/${a}/${step}`), () => eventsOf(a)),
        viaPort: () => observe('product', b, () => asAdmin(() => port[step](b)), () => eventsOf(b)),
      });
      expect(viaPort.audit.map((e) => e.action)).toEqual([`product.${step}`]);
    }
    // A repeat records nothing on either path.
    const before = (await entries(b)).length;
    await asAdmin(() => port.restore(b));
    expect(await entries(b)).toHaveLength(before);
  });

  it('delete — product.delete, product.deleted.v1', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () => observe('product', a, () => route('DELETE', `${PRODUCTS}/${a}`, undefined, 204), () => eventsOf(a)),
      viaPort: () => observe('product', b, () => asAdmin(() => port.delete(b)), () => eventsOf(b)),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['product.delete']);
    expect(
      await refusal(asAdmin(() => port.delete(b))),
    ).toEqual({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND });
  });

  it('variants — product_variant.create / .update / .delete, each announcing ["variants"]', async () => {
    const [a, b] = [await fresh({ type: 'configurable' }), await fresh({ type: 'configurable' })];
    const variants = (id: string) => `${PRODUCTS}/${id}/variants`;
    const created = await expectPortParity({
      viaRoute: () =>
        observe<{ data: Record<string, unknown> } | null>(
          'product_variant',
          (res) => res!.data['id'] as string,
          () => route('POST', variants(a), { sku: sku(), variantAttributeValues: {} }, 201),
          () => eventsOf(a, 2),
        ),
      viaPort: () =>
        observe(
          'product_variant',
          (record) => record.id,
          () => asAdmin(() => port.createVariant(b, { sku: sku(), variantAttributeValues: {} })),
          () => eventsOf(b, 2),
        ),
    });
    const [va, vb] = [created.route.audit[0]!.objectId!, created.port.audit[0]!.objectId!];
    expect(created.port.audit.map((e) => e.action)).toEqual(['product_variant.create']);

    await expectPortParity({
      viaRoute: () =>
        observe('product_variant', va, () => route('PATCH', `${variants(a)}/${va}`, { stockLevel: 5 }), () => eventsOf(a, 3)),
      viaPort: () =>
        observe('product_variant', vb, () => asAdmin(() => port.updateVariant(b, vb, { stockLevel: 5 })), () => eventsOf(b, 3)),
    });
    await expectPortParity({
      viaRoute: () =>
        observe('product_variant', va, () => route('DELETE', `${variants(a)}/${va}`, undefined, 204), () => eventsOf(a, 4)),
      viaPort: () => observe('product_variant', vb, () => asAdmin(() => port.deleteVariant(b, vb)), () => eventsOf(b, 4)),
    });
  });

  it('setCustomFieldValues — product.update, as the PATCH of attributeValues alone', async () => {
    const [a, b] = [await fresh(), await fresh()];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe('product', a, () => route('PATCH', `${PRODUCTS}/${a}`, { attributeValues: { [note]: 'From the ERP' } }), () =>
          eventsOf(a),
        ),
      viaPort: () =>
        observe(
          'product',
          b,
          () => asAdmin(() => port.setCustomFieldValues(b, async (current) => ({ ...current, [note]: 'From the ERP' }))),
          () => eventsOf(b),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['product.update']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ changedFields: ['attributeValues'], attributeValues: { [note]: 'From the ERP' } });
  });

  it('setCustomFieldValues — a key the merge drops is removed; the owner refuses a key outside the set', async () => {
    const id = await fresh({ attributeValues: { [note]: 'keep me?', [colour]: 'red' } });
    const record = await asAdmin(() =>
      port.setCustomFieldValues(id, async (current) => {
        const { [note]: _dropped, ...rest } = current;
        return rest;
      }),
    );
    expect(record.attributeValues).toEqual({ [colour]: 'red', [mandatory]: 'set' });

    const before = (await entries(id)).length;
    expect(
      await refusal(asAdmin(() => port.setCustomFieldValues(id, async (current) => ({ ...current, not_in_the_set: 1 })))),
    ).toMatchObject({ statusCode: 400 });
    expect(
      await refusal(asAdmin(() => port.setCustomFieldValues(id, async () => Promise.reject(new Error('caller refused'))))),
    ).toMatchObject({ code: 'Error: caller refused' });
    // A merge that changes nothing records nothing.
    await asAdmin(() => port.setCustomFieldValues(id, async (current) => current));
    expect(await entries(id)).toHaveLength(before);
  });

  it('setCustomFieldValues — a merge dropping a required attribute of the set is refused, nothing written', async () => {
    const id = await fresh({ attributeValues: { [note]: 'kept' } });
    const before = (await entries(id)).length;
    const bag = async () =>
      (await fx.sql<{ attribute_values: Record<string, unknown> }>(`select attribute_values from products where id = ?`, [id]))[0]!
        .attribute_values;
    const stored = await bag();
    expect(
      await refusal(
        asAdmin(() =>
          port.setCustomFieldValues(id, async (current) => {
            const { [mandatory]: _dropped, ...rest } = current;
            return rest;
          }),
        ),
      ),
    ).toMatchObject({ statusCode: 400, code: ERROR_CODES.ATTRIBUTE_VALUES_REQUIRED });
    expect(await entries(id)).toHaveLength(before);
    expect(await bag()).toEqual(stored);
  });

  it('applyScopedValues — product.scoped_values.import, as the deprecated applyScopes', async () => {
    const scopePort = h.container.resolve<CatalogProductScopeWritePort>('catalogProductScopeWritePort');
    const [a, b] = [await fresh({ channels: [channel] }), await fresh({ channels: [channel] })];
    const cells = (): ProductScopedWriteCell[] => [
      { scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Drill (PIM)' } },
      { scope: { level: 'channel', channelId: channel }, field: `attribute:${note}`, op: { op: 'set', value: 'Channel' } },
    ];
    const { port: viaPort } = await expectPortParity({
      viaRoute: () =>
        observe('product', a, () => asAdmin(() => scopePort.applyScopes(a, { cells: cells() }, { source: 'pim_connector' })), () =>
          eventsOf(a),
        ),
      viaPort: () =>
        observe('product', b, () => asAdmin(() => port.applyScopedValues(b, { cells: cells() }, { source: 'pim_connector' })), () =>
          eventsOf(b),
        ),
    });
    expect(viaPort.audit.map((e) => e.action)).toEqual(['product.scoped_values.import']);
    expect(viaPort.audit[0]!.stateAfter).toMatchObject({ source: 'pim_connector' });
  });

  it('source — recorded beside the actor; a malformed one and an unclaimed extension write nothing', async () => {
    const id = await fresh();
    await asAdmin(() => port.update(id, { name: 'Sourced' }, { source: 'erp.sync' }));
    const [last] = (await entries(id)).slice(-1);
    expect(last).toMatchObject({ action: 'product.update', actor_admin_user_id: TEST_ADMIN_ID, state_after: { source: 'erp.sync' } });

    const before = (await entries(id)).length;
    expect(await refusal(asAdmin(() => port.update(id, { name: 'Bad' }, { source: 'Not A Code' })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(await refusal(asAdmin(() => port.archive(id, { extensions: { nobody_claims_this: {} } })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
    });
    expect(await entries(id)).toHaveLength(before);
    expect((await fx.sql<{ archived_at: unknown }>(`select archived_at from products where id = ?`, [id]))[0]!.archived_at).toBeNull();
  });

  it('expectedVersion — the editor version: a stale one is refused 409 VERSION_CONFLICT', async () => {
    const id = await fresh();
    const version = async () =>
      Number((await fx.sql<{ v: string }>(`select scope_version::text as v from products where id = ?`, [id]))[0]!.v);
    const current = await version();
    await asAdmin(() => port.update(id, { name: 'Versioned' }, { expectedVersion: current }));
    expect(await refusal(asAdmin(() => port.update(id, { name: 'Stale' }, { expectedVersion: current })))).toEqual({
      statusCode: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
    });
    expect(
      await refusal(asAdmin(() => port.setCustomFieldValues(id, async (c) => ({ ...c, [note]: 'x' }), { expectedVersion: current }))),
    ).toEqual({ statusCode: 409, code: ERROR_CODES.VERSION_CONFLICT });
  });

  it('the deprecated catalogProductWritePort writes the entries the command port writes', async () => {
    const writePort = h.container.resolve<CatalogProductWritePort>('catalogProductWritePort');
    const [a, b] = [await fresh(), await fresh()];
    await expectPortParity({
      viaRoute: () => observe('product', a, () => asAdmin(() => writePort.updateProduct(a, { name: 'Old port' }))),
      viaPort: () => observe('product', b, () => asAdmin(() => port.update(b, { name: 'Old port' }))),
    });
    const created = await asAdmin(() =>
      writePort.createProduct({
        sku: sku(),
        type: 'simple',
        name: 'Old create',
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      }),
    );
    expect((await entries(created.id)).map((e) => e.action)).toEqual(['product.create']);
  });

  it('an unknown product is the route’s 404 on every method', async () => {
    const id = randomUUID();
    for (const write of [
      () => port.update(id, { name: 'x' }),
      () => port.archive(id),
      () => port.restore(id),
      () => port.setCustomFieldValues(id, async (c) => c),
    ]) {
      expect(await refusal(asAdmin(write))).toEqual({ statusCode: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND });
    }
  });
});
