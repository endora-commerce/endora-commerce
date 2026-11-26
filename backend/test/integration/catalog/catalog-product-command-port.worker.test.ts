import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  type CatalogAttributeCommandPort,
  type CatalogProductCommandPort,
  type ProductScopedWriteCell,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * `specs/186-aggregate-ports/` T072 (issue #1825, US6 scenario 1) — a PIM-style worker keeps a
 * product in step through `catalogProductCommandPort` with no administrator anywhere: every
 * call runs under `withSystemScope`, so each entry records the `system` actor (no administrator
 * id) and the worker names itself through `source` (D-293.6).
 *
 * The worker creates a configurable product, adds a variant, writes its attribute values, then
 * applies scoped values — a Global name, a channel attribute value and a channel × language
 * name — in one call, and archives it. The scoped apply announces `product.updated.v1` once,
 * as the editor's save does, bumps the editor version and records one
 * `product.scoped_values.import` entry with the source. Then the refusals that must write
 * nothing: a malformed `source`, an unclaimed extension.
 */

const SOURCE = 'pim.akeneo-sync';

describe('catalogProductCommandPort from a worker (186 T072)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let port: CatalogProductCommandPort;
  let attributes: CatalogAttributeCommandPort;
  let channel: string;
  let note: string;
  const asWorker = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('test: PIM product sync', fn);

  const entries = (objectType: string, objectId: string) =>
    fx.sql<{ action: string; actor_admin_user_id: string | null; state_after: Record<string, unknown> | null }>(
      `select action, actor_admin_user_id, state_after from audit_log_entries
        where object_type = ? and object_id = ? order by acted_at, id`,
      [objectType, objectId],
    );
  const version = async (productId: string) =>
    BigInt((await fx.sql<{ v: string }>(`select scope_version::text as v from products where id = ?`, [productId]))[0]!.v);

  async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string }> {
    try {
      await promise;
    } catch (error) {
      const e = error as { statusCode?: number; code?: string };
      return { statusCode: e.statusCode ?? 0, code: e.code ?? String(error) };
    }
    throw new Error('expected a refusal');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    port = h.container.resolve<CatalogProductCommandPort>('catalogProductCommandPort');
    attributes = h.container.resolve<CatalogAttributeCommandPort>('catalogAttributeCommandPort');
    channel = await fx.channel(['pl-PL', 'en-US']);
    note = await fx.attribute({ key: 'note', valueType: 'string', scopable: true });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('creates, varies, values, scopes and archives a product with the system actor, recording its source', async () => {
    const options = { source: SOURCE };
    // The fixture's product (in its attribute set, a member of the channel), then the worker's own writes.
    const id = await fx.product({ channels: [channel], type: 'configurable' });
    const variant = await asWorker(() =>
      port.createVariant(id, { sku: `PIM-${fx.run}-V1`, variantAttributeValues: {} }, options),
    );
    await asWorker(() => port.setCustomFieldValues(id, async (current) => ({ ...current, [note]: 'Global note' }), options));

    const events: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === id) events.push([...p.changedFields].sort());
    });
    const before = await version(id);
    const cells: ProductScopedWriteCell[] = [
      { scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Drill (PIM)' } },
      { scope: { level: 'channel', channelId: channel }, field: `attribute:${note}`, op: { op: 'set', value: 'Channel note' } },
      {
        scope: { level: 'channel_language', channelId: channel, languageCode: 'pl-PL' },
        field: 'name',
        op: { op: 'set', value: 'Wiertarka (PIM)' },
      },
    ];
    const result = await asWorker(() => port.applyScopedValues(id, { cells }, options));
    off();
    expect(result).toEqual({ applied: 3, refused: [], urlKeys: [] });
    expect(events).toEqual([['attributeValues', 'name']]);
    expect(await version(id)).toBe(before + 1n);
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.name).toMatchObject({
      value: 'Wiertarka (PIM)',
      source: 'set',
    });

    await asWorker(() => port.archive(id, options));

    const written = (await entries('product', id)).filter((e) => e.action !== 'product.create');
    expect(written.map((e) => e.action)).toEqual(['product.update', 'product.scoped_values.import', 'product.archive']);
    for (const entry of [...written, ...(await entries('product_variant', variant.id))]) {
      expect(entry.actor_admin_user_id, entry.action).toBeNull();
      expect(entry.state_after, entry.action).toMatchObject({ source: SOURCE });
    }
  });

  it('a call with no source records the system actor alone', async () => {
    const id = await fx.product({ channels: [channel] });
    await asWorker(() =>
      port.applyScopedValues(id, { cells: [{ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Unsourced' } }] }),
    );
    const [entry] = (await entries('product', id)).filter((e) => e.action === 'product.scoped_values.import');
    expect(entry).toMatchObject({ actor_admin_user_id: null, state_after: { source: null } });
  });

  it('manages an attribute definition from the worker', async () => {
    const view = await asWorker(() =>
      attributes.create(
        {
          key: `pim_${fx.run.replace(/-/g, '')}_size`,
          label: { 'en-US': 'Size' },
          labelDefault: 'Size',
          type: 'select',
          options: [{ value: 's', labelDefault: 'S' }],
          isSearchable: false,
          isFilterable: false,
          isVariantAxis: false,
        },
        { source: SOURCE },
      ),
    );
    const option = await asWorker(() => attributes.addOption(view.id, { value: 'xl', labelDefault: 'XL' }, { source: SOURCE }));
    expect(option.value).toBe('xl');
    const [entry] = await entries('product_attribute', view.id);
    expect(entry).toMatchObject({ action: 'catalog.attribute.create', actor_admin_user_id: null, state_after: { source: SOURCE } });
    await asWorker(() => attributes.delete(view.id));
  });

  it('refuses a malformed source and an unclaimed extension before anything is written', async () => {
    const id = await fx.product({ channels: [channel] });
    const recorded = (await entries('product', id)).length;
    const cells: ProductScopedWriteCell[] = [{ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'x' } }];
    expect(await refusal(asWorker(() => port.applyScopedValues(id, { cells }, { source: 'PIM Sync' })))).toEqual({
      statusCode: 422,
      code: ERROR_CODES.VALIDATION_FAILED,
    });
    expect(
      await refusal(asWorker(() => port.applyScopedValues(id, { cells }, { extensions: { nobody_claims_this: {} } }))),
    ).toEqual({ statusCode: 422, code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED });
    expect(await entries('product', id)).toHaveLength(recorded);
  });
});
