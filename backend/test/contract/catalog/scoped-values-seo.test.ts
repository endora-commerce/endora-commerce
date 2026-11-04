import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US10 (T122, T123; FR-091, SC-007; `contracts/scoped-values-api.md` §3 steps 4, 8
 * and 9) — the product and its SEO fields are one save: `changes.seo` is written through `seo`'s
 * write port inside the `product.scoped_values.save` Command, so
 *
 * - a save of a name and an SEO title at C×L stores both, in one audit entry naming
 *   `seo:<field>@<scope>` cells and the re-applicable `changes.seo` body;
 * - a save with only SEO cells is a real write (version moved, one audit entry);
 * - an SEO refusal (an unsafe image URL) rolls the catalog rows back: nothing written, no audit.
 */
describe('172 US10 — SEO in the scoped save (T122, T123)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  const products: string[] = [];

  const audits = (productId: string) =>
    fx.sql<{ before_state: Record<string, unknown>; after_state: Record<string, unknown> }>(
      `select state_before as before_state, state_after as after_state from audit_log_entries where action = 'product.scoped_values.save' and object_id = ? order by id`,
      [productId],
    );
  const product = async () => {
    const id = await fx.product({ channels: [channel] });
    products.push(id);
    return id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
  });

  afterAll(async () => {
    if (h) {
      for (const id of products) await fx.sql(`delete from seo_meta_overrides where entity_id = ?`, [id]);
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('saves a name and an SEO title at Channel × language as one audited write', async () => {
    const id = await product();
    const scope = { channelId: channel, languageCode: 'pl-PL' };
    const data = await fx.save(id, scope, { name: 'Wiertarka', seo: { title: 'Wiertarka SEO', description: null } });
    expect(data.fields.name).toMatchObject({ value: 'Wiertarka', source: 'set' });
    expect(data.seo!.title).toMatchObject({ value: 'Wiertarka SEO', source: 'set' });
    expect(data.seo!.description).toMatchObject({ value: null, source: 'set_empty' });

    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    const key = `CL:${channel}/pl-PL`;
    expect(rows[0]!.before_state).toMatchObject({
      cells: { [`name@${key}`]: { inherited: true }, [`seo:title@${key}`]: { inherited: true } },
      changes: { seo: { title: { inherit: true }, description: { inherit: true } } },
    });
    expect(rows[0]!.after_state).toMatchObject({
      cells: { [`seo:title@${key}`]: 'Wiertarka SEO', [`seo:description@${key}`]: { empty: true } },
      changes: { name: 'Wiertarka', seo: { title: 'Wiertarka SEO', description: null } },
      changedFields: expect.arrayContaining(['name', 'seo']),
    });
  });

  it('a save with only SEO cells writes, moves the version and audits once', async () => {
    const id = await product();
    const before = (await fx.read(id, { channelId: channel })).version;
    const data = await fx.save(id, { channelId: channel }, { seo: { ogTitle: 'Kanał OG' } });
    expect(data.seo!.ogTitle).toMatchObject({ value: 'Kanał OG', source: 'set' });
    expect(data.version).not.toBe(before);
    expect(await audits(id)).toHaveLength(1);
  });

  it('an SEO refusal rolls the catalog rows back: nothing written, no audit entry (SC-007)', async () => {
    const id = await product();
    const scope = { channelId: channel, languageCode: 'pl-PL' };
    const before = await fx.read(id, scope);
    const res = await fx.put(id, scope, { name: 'Nowa nazwa', seo: { ogImageUrl: 'javascript:alert(1)' } });
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json()).toMatchObject({ error: { code: expect.stringMatching(new RegExp(`^(${ERROR_CODES.SCOPED_VALUE_INVALID}|${ERROR_CODES.VALIDATION_FAILED})$`)) } });
    const after = await fx.read(id, scope);
    expect(after.fields.name).toEqual(before.fields.name);
    expect(after.version).toBe(before.version);
    expect(await fx.sql(`select 1 from product_value_overrides where product_id = ?`, [id])).toEqual([]);
    expect(await audits(id)).toEqual([]);
  });

  it("a refusal raised by seo's port itself rolls the catalog rows back too", async () => {
    const id = await product();
    // `inherit` at Global passes the body schema; the port refuses it (`inherit_at_global`).
    const before = await fx.read(id);
    const res = await fx.put(id, {}, { name: 'Nowa nazwa', seo: { title: { inherit: true } } });
    expect(res.statusCode, res.body).toBe(422);
    const after = await fx.read(id);
    expect(after.fields.name).toEqual(before.fields.name);
    expect(after.version).toBe(before.version);
    expect(await audits(id)).toEqual([]);
  });
});
