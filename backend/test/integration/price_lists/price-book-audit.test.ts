import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T094, FR-035) — every price-book write is one Command Bus
 * command: exactly one audit entry on `objectType: 'price_list'` with the state
 * before and after, committed with the write; a refused write audits nothing.
 */
describe('price_lists — every price-book write is audited once (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;

  const entries = async (objectId: string) =>
    h.em().fork().find(AuditLogEntry, { objectType: 'price_list', objectId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('create, patch (header, channels, members), rows, activate, draftify, duplicate and delete — one entry each', async () => {
    const created = await api.post<{ data: PriceBook }>('/api/v1/admin/price-books', {
      name: 'Audited',
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [f.channels.CH1.id],
      audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
    });
    expect(created.status, created.raw).toBe(201);
    const id = created.body.data.id;
    let version = created.body.data.version;
    const step = async (label: string, run: () => Promise<{ status: number; raw: string; body: unknown }>, action: string) => {
      const before = (await entries(id)).length;
      const res = await run();
      expect(res.status, `${label}: ${res.raw}`).toBeLessThan(300);
      const after = await entries(id);
      expect(after.length - before, label).toBe(1);
      const entry = after[after.length - 1]!;
      expect(entry.action, label).toBe(action);
      const data = (res.body as { data?: { version?: number } } | null)?.data;
      if (data?.version) version = data.version;
      return entry;
    };
    const header = await step(
      'header',
      () => api.patch(`/api/v1/admin/price-books/${id}`, { name: 'Audited 2', expectedVersion: version }),
      'price_list.update',
    );
    expect(header.stateBefore).toMatchObject({ name: 'Audited' });
    expect(header.stateAfter).toMatchObject({ name: 'Audited 2' });
    const channels = await step(
      'channels',
      () => api.patch(`/api/v1/admin/price-books/${id}`, { channelIds: [f.channels.CH1.id, f.channels.CH2.id], expectedVersion: version }),
      'price_list.update',
    );
    expect(channels.stateAfter).toMatchObject({ channelIds: [f.channels.CH1.id, f.channels.CH2.id].sort() });
    await step(
      'members',
      () => api.patch(`/api/v1/admin/price-books/${id}`, { audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.orgs.Beta.id] }, expectedVersion: version }),
      'price_list.update',
    );
    const rows = await step(
      'rows',
      () =>
        api.put(`/api/v1/admin/price-books/${id}/rows`, {
          expectedVersion: version,
          upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, price: { type: 'fixed', amount: '91' } }],
        }),
      'price_list.rows_replace',
    );
    expect(rows.stateAfter).toMatchObject({ rows: [expect.objectContaining({ productId: f.products.P1.id, amount: '91.0000' })] });
    await step('activate', () => api.post(`/api/v1/admin/price-books/${id}/activate`), 'price_list.activate');
    await step('draftify', () => api.post(`/api/v1/admin/price-books/${id}/draftify`), 'price_list.draftify');
    const before = await h.em().fork().count(AuditLogEntry, { action: 'price_list.duplicate' });
    const copy = await api.post<{ data: PriceBook }>(`/api/v1/admin/price-books/${id}/duplicate`, {
      name: 'Audited copy',
      channelIds: [f.channels.CH1.id],
      currencyCode: 'PLN',
      audience: { kind: 'everyone', memberIds: [] },
    });
    expect(copy.status, copy.raw).toBe(201);
    expect(await h.em().fork().count(AuditLogEntry, { action: 'price_list.duplicate' })).toBe(before + 1);
    expect((await entries(copy.body.data.id)).map((e) => e.action)).toEqual(['price_list.duplicate']);
    const deletes = await h.em().fork().count(AuditLogEntry, { action: 'price_list.delete', objectId: id });
    expect((await api.delete(`/api/v1/admin/price-books/${id}`)).status).toBe(204);
    expect(await h.em().fork().count(AuditLogEntry, { action: 'price_list.delete', objectId: id })).toBe(deletes + 1);
  });

  it('a refused write audits nothing', async () => {
    const created = (
      await api.post<{ data: PriceBook }>('/api/v1/admin/price-books', {
        name: 'Refused',
        type: 'regular',
        currencyCode: 'PLN',
        channelIds: [],
        audience: { kind: 'organizations', memberIds: [] },
      })
    ).body.data;
    const before = (await entries(created.id)).length;
    expect((await api.post(`/api/v1/admin/price-books/${created.id}/activate`)).status).toBe(409);
    expect((await api.patch(`/api/v1/admin/price-books/${created.id}`, { name: 'x', expectedVersion: 99 })).status).toBe(409);
    expect(
      (
        await api.put(`/api/v1/admin/price-books/${created.id}/rows`, {
          expectedVersion: created.version,
          upsert: [{ selection: {}, minQuantity: 1, price: { type: 'fixed', amount: '1' } }],
        })
      ).status,
    ).toBe(400);
    expect((await entries(created.id)).length).toBe(before);
  });

  it('a base-price write is one entry naming the product, across currencies', async () => {
    const before = await h.em().fork().count(AuditLogEntry, { action: 'price_list.base_prices_set' });
    const res = await api.put(`/api/v1/admin/price-books/base-prices/${f.products.P3.id}`, {
      byCurrency: {
        PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '31' }], variants: {} },
        EUR: { product: [{ minQuantity: 1, maxQuantity: null, amount: '7' }], variants: {} },
      },
    });
    expect(res.status, res.raw).toBe(200);
    const all = await h.em().fork().find(AuditLogEntry, { action: 'price_list.base_prices_set' }, { orderBy: { actedAt: 'desc' } });
    expect(all.length).toBe(before + 1);
    expect(all[0]!.stateAfter).toMatchObject({ productId: f.products.P3.id });
    await f.resetBase();
  });
});
