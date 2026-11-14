import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { basePricesDryRunResponseSchema, type ProductBasePrices } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { createSalesRep, priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 180 (FR-021, `specs/180-one-save-zone-editors/contracts/base-prices-dry-run.md`) — the
 * base-price write's pre-check. `PUT …/base-prices/:productId?dryRun=true` runs the real write's
 * gate, scope rule, parse and planning, answers the same refusals, and writes nothing: no row, no
 * Command, no audit entry. The product editor's one Save calls it before anything is written, so
 * a base price the server would refuse stops the whole Save (OQ-1's partial-failure window is
 * narrowed to infrastructure failures and races).
 */
describe('base-price dry run (feature 180)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let rep: Awaited<ReturnType<typeof createSalesRep>>;

  type Envelope<T> = { data: T };
  const url = (productId: string, query = '?dryRun=true'): string =>
    `/api/v1/admin/price-books/base-prices/${productId}${query}`;
  const audits = (): Promise<number> => h.em().count(AuditLogEntry, { action: 'price_list.base_prices_set' });
  const readBase = async (productId: string): Promise<ProductBasePrices> =>
    (await api.get<Envelope<ProductBasePrices>>(`/api/v1/admin/price-books/base-prices?productId=${productId}`)).body.data;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    rep = await createSalesRep(h, { assignedOrganizationIds: [f.orgs.Acme.id], otherOrganizationIds: [f.orgs.Beta.id] });
  }, 5 * 60_000);

  afterAll(async () => {
    rep.release();
    await teardownBackendServer(h);
  });

  it('answers 200 { valid: true } for a write every rule accepts, and stores nothing', async () => {
    const before = await readBase(f.products.P5.id);
    const auditsBefore = await audits();
    const res = await api.put<Envelope<unknown>>(url(f.products.P5.id), {
      byCurrency: {
        PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '99' }], variants: {} },
        EUR: { product: [{ minQuantity: 1, maxQuantity: null, amount: '21' }], variants: {} },
      },
    });
    expect(res.status, res.raw).toBe(200);
    expect(basePricesDryRunResponseSchema.parse(res.body)).toEqual({ data: { valid: true } });
    expect(await audits()).toBe(auditsBefore);
    const after = await readBase(f.products.P5.id);
    expect(after.byCurrency).toEqual(before.byCurrency);
    expect(Object.keys(after.byCurrency)).not.toContain('EUR');
  });

  it('accepts dryRun=1 as the rows endpoint does', async () => {
    const res = await api.put(url(f.products.P1.id, '?dryRun=1'), {
      byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '101' }], variants: {} } },
    });
    expect(res.status, res.raw).toBe(200);
    expect((await readBase(f.products.P1.id)).byCurrency['PLN']!.product[0]!.amount).toBe('100.0000');
  });

  it('refuses what the real write refuses, with the same status and code', async () => {
    const body = {
      byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '1' }], variants: { [f.variants.P5r]: null } } },
    };
    const auditsBefore = await audits();
    const dry = await api.put<{ error: { code: string } }>(url(f.products.P1.id), body);
    const real = await api.put<{ error: { code: string } }>(url(f.products.P1.id, ''), body);
    expect(dry.status, dry.raw).toBe(real.status);
    expect(dry.status).toBeGreaterThanOrEqual(400);
    expect(dry.body.error.code).toBe(real.body.error.code);
    expect(await audits()).toBe(auditsBefore);
  });

  it('refuses a malformed body as the real write does', async () => {
    const dry = await api.put(url(f.products.P1.id), { byCurrency: { PLN: { product: 'nope' } } });
    const real = await api.put(url(f.products.P1.id, ''), { byCurrency: { PLN: { product: 'nope' } } });
    expect(dry.status).toBe(real.status);
    expect(dry.status).toBe(400);
  });

  it('answers 404 for an unknown product', async () => {
    const res = await api.put(url('00000000-0000-4000-8000-0000001800bb'), {
      byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '1' }], variants: {} } },
    });
    expect(res.status).toBe(404);
  });

  it('answers 403 to a representative, whose base prices are read-only', async () => {
    const res = await api.put(
      url(f.products.P1.id),
      { byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '1' }], variants: {} } } },
      rep.cookies,
    );
    expect(res.status).toBe(403);
  });
});
