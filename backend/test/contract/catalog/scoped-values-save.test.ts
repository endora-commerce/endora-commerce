import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US7 (T103; FR-072, FR-074, FR-098, SC-008, US7 #3, #5, #6) — one Save is one Command:
 * - one audit entry whose `cells` name every written cell `field@scope` with its before and after,
 *   and `product.updated.v1` with the union of the changed fields;
 * - a warn-mode completeness warning comes back with the 200;
 * - the audit `before.changes` re-applied through the same route restores every field;
 * - a stale version is `409 VERSION_CONFLICT` and writes nothing.
 */
describe('172 US7 — one atomic Save (T103)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let required: string;
  const SETTING = 'catalog.scope_completeness_gate';

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    required = await fx.attribute({ key: 'material', valueType: 'string', scopable: true, isRequired: true });
  });

  afterEach(async () => {
    await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/settings/${SETTING}/values`, ...ADMIN });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  const audits = (productId: string) =>
    fx.sql<{ state_before: Record<string, unknown>; state_after: Record<string, unknown> }>(
      `select state_before, state_after from audit_log_entries
        where action = 'product.scoped_values.save' and object_id = ? order by acted_at`,
      [productId],
    );

  it('one audit entry with every cell before / after, and one event with the union of changed fields', async () => {
    const id = await fx.product({ channels: [channel], attributeValues: { [required]: 'Steel' } });
    const seen: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === id) seen.push(p.changedFields);
    });
    try {
      await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Wiertarka', description: null, attributes: { [required]: 'Stal' } });
    } finally {
      off();
    }
    const entries = await audits(id);
    expect(entries).toHaveLength(1);
    const scope = `CL:${channel}/pl-PL`;
    expect(entries[0]!.state_before['cells']).toEqual({
      [`name@${scope}`]: { inherited: true },
      [`description@${scope}`]: { inherited: true },
      [`attribute:${required}@${scope}`]: { inherited: true },
    });
    expect(entries[0]!.state_after['cells']).toEqual({
      [`name@${scope}`]: 'Wiertarka',
      [`description@${scope}`]: { empty: true },
      [`attribute:${required}@${scope}`]: 'Stal',
    });
    expect(seen).toEqual([expect.arrayContaining(['name', 'description', 'attributeValues'])]);
  });

  it('re-applying the audit before-state restores every field (FR-074, SC-008)', async () => {
    const id = await fx.product({ channels: [channel], attributeValues: { [required]: 'Steel' } });
    const scope = { channelId: channel };
    await fx.save(id, scope, { name: 'Before C', returnable: true, minOrderQuantity: 4 });
    const before = await fx.read(id, scope);
    await fx.save(id, scope, { name: 'After C', returnable: false, minOrderQuantity: { inherit: true }, description: 'New' });
    const [, last] = await audits(id);
    const changes = (last!.state_before as { changes: unknown }).changes;
    await fx.save(id, scope, changes);
    const restored = await fx.read(id, scope);
    expect(restored.fields).toEqual(before.fields);
    expect(restored.attributes).toEqual(before.attributes);
  });

  it('a warn-mode completeness warning comes back with the 200 (FR-098)', async () => {
    const id = await fx.product({ channels: [channel] });
    const scope = { channelId: channel, languageCode: 'pl-PL' };
    await fx.save(id, scope, { status: 'inactive' });
    const res = await fx.put(id, scope, { status: 'active' });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { warnings: unknown[] }).warnings).toEqual([
      expect.objectContaining({ kind: 'completeness', channelId: channel, languageCode: 'pl-PL', missing: [`attribute:${required}`] }),
    ]);
  });

  it('a stale version is 409 VERSION_CONFLICT and writes nothing (US7 #6)', async () => {
    const id = await fx.product({ channels: [channel] });
    const { version } = await fx.read(id);
    await fx.save(id, { channelId: channel }, { name: 'First' });
    const stale = await fx.put(id, { channelId: channel }, { name: 'Second' }, { version });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: ERROR_CODES.VERSION_CONFLICT } });
    expect((await fx.read(id, { channelId: channel })).fields.name.value).toBe('First');
    expect(await audits(id)).toHaveLength(1);
  });

  it('two saves in a row each succeed with the version the previous one answered', async () => {
    const id = await fx.product({ channels: [channel] });
    const first = await fx.put(id, { channelId: channel }, { name: 'One' });
    const next = (first.json() as { data: { version: string } }).data.version;
    const second = await fx.put(id, { channelId: channel }, { name: 'Two' }, { version: next });
    expect(second.statusCode, second.body).toBe(200);
  });
});
