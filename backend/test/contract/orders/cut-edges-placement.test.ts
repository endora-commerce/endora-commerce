import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * Feature 075, Phase C — the placement engine's cut edges (the fourth seam of
 * the `orders` cut).
 *
 * `OrderService` read six neighbouring modules' entity classes through its own
 * `EntityManager`: the organisation, the buyer, the two addresses, the two
 * method catalogues and the products. Each read now goes through the owner's
 * published port, which means it runs on the owner's manager — so its tenant
 * filter applies — and refuses when the owner is absent rather than answering
 * from a table deactivation leaves in place.
 *
 * Two probes, chosen for the two different answers the cut produces:
 *
 *  - **`catalog` off** — a *fail-closed* edge (`catalog` is in `dependencies`).
 *    Pricing a line for a product the platform will not read is worse than
 *    refusing the line, which is what `CatalogProductReadPort` says in its own
 *    doc comment.
 *  - **`delivery_methods` off** — the *declared degrade*. The module is
 *    deactivatable and this module is not, so the edge is `degrades-without`
 *    and the accessor answers `null`; the placement then refuses with the
 *    method-not-active 400 it already gives for a retired method, which is the
 *    truth: there is no active catalogue to choose from.
 *
 * Each has its positive control, so a flip that goes inert (issue #141) cannot
 * read as a pass. No server is booted for the off state.
 */

const customerCookie = { b2b_session: 'stub-customer-session' };
const previewPayload = {
  deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
  billingAddressId: '00000000-0000-4000-8000-0000000000d2',
};

describe('orders — the placement engine reads its neighbours over ports (feature 075)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const preview = () =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/orders/preview-total',
      payload: previewPayload,
      cookies: customerCookie,
    });

  it('prices the preview while every neighbour is present (the positive control)', async () => {
    const res = await preview();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { total: number } }).data.total).toBeGreaterThan(0);
  });

  it('refuses rather than pricing from a catalogue it may not read, with `catalog` off', async () => {
    await withModuleOff('catalog', 'platform-unavailable', async () => {
      const res = await preview();
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
    });
  });

  it('degrades to "method is not active" with `delivery_methods` off', async () => {
    await withModuleOff('delivery_methods', 'platform-unavailable', async () => {
      const res = await preview();
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
    });
  });

  it('restores both when the modules come back', async () => {
    const res = await preview();
    expect(res.statusCode).toBe(200);
  });
});
