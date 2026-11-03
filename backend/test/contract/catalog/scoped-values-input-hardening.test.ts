import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, SCOPED_SAVE_CELLS_MAX, SCOPED_VALUES_BODY_LIMIT } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170, US2 (T150; research R21) — the save's input is bounded and bound to the product:
 * - a subject id of another product and an unknown id answer the **identical**
 *   `subject_not_found`, for gallery items, role targets, attachments and packaging units;
 * - an unknown organisation id in an audience and an attribute outside the product's set are
 *   `invalid`;
 * - unknown keys anywhere in `changes` are 400; a reserved record key is refused, never dropped;
 * - the length caps and the cell cap are 400; a body over the route's `bodyLimit` is 413;
 * - a description over 4 KiB is audited as `{ truncated, length, sha256 }`.
 * Nothing is written by any refusal. (The URL-key side effects in the audit are T039's.)
 */
describe('170 US2 — scoped-values input hardening (T150)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let product: string;
  let other: string;
  let mine: { items: [string, string]; attachment: string; unit: string };
  let theirs: { items: [string, string]; attachment: string; unit: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    await fx.attribute({ key: 'inset', valueType: 'string', scopable: true });
    product = await fx.product({ channels: [channel] });
    other = await fx.product({ channels: [channel] });
    mine = await fx.media(product);
    theirs = await fx.media(other);
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  const C = () => ({ channelId: channel });
  const scopedRowCount = async () => {
    const [row] = await fx.sql<{ n: string }>(
      `select ((select count(*) from product_value_overrides where product_id = ?)
             + (select count(*) from gallery_item_scope_overrides where product_id = ?)
             + (select count(*) from gallery_role_scope_overrides where product_id = ?)
             + (select count(*) from product_attachment_scope_overrides where product_id = ?)
             + (select count(*) from product_packaging_unit_scope_overrides where product_id = ?)
             + (select count(*) from product_channel_scopes where product_id = ?))::text as n`,
      Array(6).fill(product),
    );
    return Number(row!.n);
  };
  const refusal = async (changes: unknown, scope: { channelId?: string } = C()) => {
    const before = await scopedRowCount();
    const res = await fx.put(product, scope, changes);
    expect(await scopedRowCount()).toBe(before);
    return res;
  };
  const reasons = (res: Awaited<ReturnType<ScopedValuesFixture['put']>>) =>
    (res.json() as { error: { code: string; details: { fields: Array<{ field: string; reason: string }> } } }).error;

  it.each([
    ['gallery item', (id: string) => ({ gallery: { items: { [id]: { altText: 'x' } } } }), () => theirs.items[0]],
    ['role target', (id: string) => ({ gallery: { roles: { baseImage: id } } }), () => theirs.items[1]],
    ['attachment', (id: string) => ({ attachments: { [id]: { name: 'x' } } }), () => theirs.attachment],
    ['packaging unit', (id: string) => ({ packagingUnits: { [id]: { name: 'x' } } }), () => theirs.unit],
  ])('%s: another product’s id and an unknown id give the identical subject_not_found', async (_label, body, foreign) => {
    const a = await refusal(body(foreign()));
    const b = await refusal(body(randomUUID()));
    expect(a.statusCode).toBe(422);
    expect(b.statusCode).toBe(422);
    const strip = (r: typeof a) => ({ ...reasons(r), message: undefined, requestId: undefined, details: { fields: reasons(r).details.fields.map((f) => ({ reason: f.reason })) } });
    expect(strip(a)).toEqual(strip(b));
    expect(reasons(a)).toMatchObject({ code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ reason: 'subject_not_found' }] } });
  });

  it('an unknown organisation and an attribute outside the product’s set are invalid', async () => {
    const org = await refusal({ audience: { visibility: 'organization_restricted', allowedOrganizationIds: [randomUUID()] } });
    expect(org.statusCode, org.body).toBe(422);
    expect(reasons(org)).toMatchObject({ code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ field: 'audience', reason: 'invalid' }] } });
    const attr = await refusal({ attributes: { not_in_this_set: 'x' } });
    expect(attr.statusCode).toBe(422);
    expect(reasons(attr)).toMatchObject({ details: { fields: [{ field: 'attribute:not_in_this_set', reason: 'invalid' }] } });
  });

  it.each([
    ['top level', { nam: 'x' }],
    ['gallery item', { gallery: { items: { '00000000-0000-4000-8000-000000000001': { alt: 'x' } } } }],
    ['gallery roles', { gallery: { roles: { hero: null } } }],
    ['attachment', { attachments: { '00000000-0000-4000-8000-000000000001': { title: 'x' } } }],
    ['packaging unit', { packagingUnits: { '00000000-0000-4000-8000-000000000001': { label: 'x' } } }],
    ['product', { product: { colour: 'red' } }],
    ['a malformed inherit marker', { description: { inherit: true, extra: 1 } }],
  ])('an unknown key (%s) is 400', async (_label, changes) => {
    const res = await refusal(changes);
    expect(res.statusCode, res.body).toBe(400);
  });

  it('a reserved record key is refused, never dropped', async () => {
    for (const key of ['constructor', 'prototype']) {
      const res = await refusal({ attributes: { [key]: 'x' } });
      expect(res.statusCode, res.body).toBe(422);
      expect(reasons(res)).toMatchObject({ code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ reason: 'invalid' }] } });
    }
    const { version } = await fx.read(product, C());
    const proto = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${product}/scoped-values`,
      ...ADMIN,
      headers: { 'content-type': 'application/json' },
      payload: `{"scope":{"channelId":"${channel}"},"version":"${version}","changes":{"attributes":{"__proto__":"x"}}}`,
    });
    expect([400, 422]).toContain(proto.statusCode);
  });

  it('length caps and the cell cap are 400; a body over the bodyLimit is 413', async () => {
    expect((await refusal({ name: 'n'.repeat(256) })).statusCode).toBe(400);
    expect((await refusal({ description: 'd'.repeat(20_001) })).statusCode).toBe(400);
    expect((await refusal({ urlKey: 'k'.repeat(161) })).statusCode).toBe(400);
    const cells = Object.fromEntries(Array.from({ length: SCOPED_SAVE_CELLS_MAX + 1 }, (_, i) => [`k_${i}`, 'x']));
    expect((await refusal({ attributes: cells })).statusCode).toBe(400);
    const { version } = await fx.read(product, C());
    const huge = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${product}/scoped-values`,
      ...ADMIN,
      payload: { scope: C(), version, changes: { description: 'x'.repeat(SCOPED_VALUES_BODY_LIMIT + 1) } },
    });
    expect(huge.statusCode).toBe(413);
  });

  it('a description over 4 KiB is audited as { truncated, length, sha256 }', async () => {
    const text = 'ż'.repeat(3000); // 6000 bytes
    await fx.save(product, C(), { description: text });
    const [entry] = await fx.sql<{ state_after: { cells: Record<string, unknown> } }>(
      `select state_after from audit_log_entries
        where action = 'product.scoped_values.save' and object_id = ? order by acted_at desc limit 1`,
      [product],
    );
    expect(entry!.state_after.cells[`description@C:${channel}`]).toEqual({
      truncated: true,
      length: Buffer.byteLength(text, 'utf8'),
      sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    });
    expect(mine.items).toHaveLength(2);
  });
});
