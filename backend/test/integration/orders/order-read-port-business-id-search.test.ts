import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedOrdersForInvoiceTests } from '../../helpers/seed-commerce.js';
import { OrderReadService } from '../../../../packages/modules/orders/dist/backend/services/order-read-port.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * Feature 075, Phase P addendum — `OrderReadPort.findIdsByBusinessIdLike`.
 *
 * `invoices` filters its admin list by `filter[orderNumber]`, and did it with
 * `em.find(Order, { businessId: { $ilike } }, { limit: 500 })` from inside its
 * own module. `orderListPort.list({ q })` is not the same question — it also
 * matches the buying organisation and the placing customer — so the fragment
 * lookup is published in its own right.
 *
 * Additive: no consumer resolves it yet. What is asserted is the contract the
 * `invoices` cut will lean on — case-insensitive substring, the caller's limit
 * applied by the owner, and an empty fragment matching nothing rather than
 * everything.
 */
describe('OrderReadPort.findIdsByBusinessIdLike', () => {
  let h: BackendServerHandle;
  let port: OrderReadService;
  let sample: Order;

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new OrderReadService(h.em);
    await seedOrdersForInvoiceTests(h.em());
    sample = await h.em().findOneOrFail(
      Order,
      { id: '00000000-0000-4000-8000-000000000302' },
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('matches a business id by case-insensitive substring', async () => {
    const fragment = sample.businessId.slice(1, Math.max(2, sample.businessId.length - 1));
    const ids = await port.findIdsByBusinessIdLike(fragment.toLowerCase(), 50);
    expect(ids).toContain(sample.id);
  });

  it('applies the caller’s limit on the owner’s side', async () => {
    const ids = await port.findIdsByBusinessIdLike('', 1);
    // An empty fragment matches nothing at all, which is the point of the next
    // case; the limit is exercised against a fragment that does match.
    expect(ids).toEqual([]);
    const wide = await port.findIdsByBusinessIdLike(sample.businessId, 1);
    expect(wide.length).toBeLessThanOrEqual(1);
  });

  it('returns nothing for an empty fragment rather than every order', async () => {
    expect(await port.findIdsByBusinessIdLike('   ', 100)).toEqual([]);
  });

  it('returns nothing for a fragment no order carries', async () => {
    expect(await port.findIdsByBusinessIdLike('zzz-no-such-order-zzz', 100)).toEqual([]);
  });
});
