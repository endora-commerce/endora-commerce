import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookResolvedLine } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T095, FR-020, FR-038) — `POST /api/v1/admin/price-books/resolve`,
 * the explanation the admin's "why this price" panel renders: per line the
 * price and its source, and the tier, cell, book, row, reference, precedence
 * version and ranked runner-ups; scoped like the old probe it replaces.
 */
describe('admin price explanation (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;
  let orgBook: string;
  let groupBook: string;

  type Answer = { data: PriceBookResolvedLine[] };
  const resolve = (body: Record<string, unknown>, cookies?: Record<string, string>) =>
    api.post<Answer>('/api/v1/admin/price-books/resolve', { salesChannelId: f.channels.CH1.id, ...body }, cookies);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.Acme.id], otherOrganizationIds: [f.orgs.Beta.id] });
    orgBook = (await f.book({ name: 'Acme terms', audience: { organizations: [f.orgs.Acme] }, rows: [{ category: f.categories.screws, percent: '-5' }] })).id;
    groupBook = (await f.book({ name: 'VIP terms', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, fixed: '92' }] })).id;
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  it('explains a buyer price: tier, cell, book, row, reference, precedence version, runner-ups', async () => {
    const res = await resolve({ buyer: { organizationId: f.orgs.Acme.id }, lines: [{ key: 'a', productId: f.products.P1.id, quantity: 1 }] });
    expect(res.status, res.raw).toBe(200);
    const [line] = res.body.data;
    // HY: org.category ranks before group.product, so Acme's −5 % (95) decides.
    expect(line).toMatchObject({
      key: 'a',
      price: { amount: '95.0000', currency: 'PLN', source: 'buyer' },
      explanation: { tier: 'buyer', cell: 'org.category', bookId: orgBook, bookName: 'Acme terms', reference: '100.0000', precedenceVersion: 1 },
    });
    expect(line!.explanation.rowId).toEqual(expect.any(String));
    expect(line!.explanation.candidates).toEqual([
      expect.objectContaining({ cell: 'org.category', bookId: orgBook, amount: '95.0000' }),
      expect.objectContaining({ cell: 'group.product', bookId: groupBook, amount: '92.0000' }),
    ]);
  });

  it('explains a guest price as the base tier, and an unpriced line as nothing', async () => {
    const res = await resolve({
      lines: [
        { key: 'base', productId: f.products.P2.id },
        { key: 'none', productId: f.products.P4.id },
      ],
    });
    expect(res.status, res.raw).toBe(200);
    const [base, none] = res.body.data;
    expect(base).toMatchObject({ price: { amount: '50.0000', source: 'base' }, explanation: { tier: 'base', precedenceVersion: 1 } });
    expect(none).toMatchObject({ price: null, explanation: { tier: null, precedenceVersion: 1 } });
  });

  it('answers an out-of-scope organization exactly as an unknown one (FR-034)', async () => {
    const hidden = await resolve({ buyer: { organizationId: f.orgs.Beta.id }, lines: [{ key: 'a', productId: f.products.P1.id }] }, rep.cookies);
    const unknown = await resolve(
      { buyer: { organizationId: '00000000-0000-4000-8000-0000001600dd' }, lines: [{ key: 'a', productId: f.products.P1.id }] },
      rep.cookies,
    );
    expect(hidden.status).toBe(404);
    expect(unknown.status).toBe(404);
    const strip = (body: unknown) => {
      const { requestId: _r, ...rest } = (body as { error: Record<string, unknown> }).error;
      return rest;
    };
    expect(strip(hidden.body)).toEqual(strip(unknown.body));
    const own = await resolve({ buyer: { organizationId: f.orgs.Acme.id }, lines: [{ key: 'a', productId: f.products.P1.id }] }, rep.cookies);
    expect(own.status, own.raw).toBe(200);
  });

  it('refuses more than 200 lines and an unknown channel', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ key: String(i), productId: f.products.P1.id }));
    expect((await resolve({ lines: many })).status).toBe(400);
    expect((await resolve({ salesChannelId: '00000000-0000-4000-8000-0000001600ee', lines: [{ key: 'a', productId: f.products.P1.id }] })).status).toBe(400);
  });
});
