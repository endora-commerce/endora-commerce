import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCartForStubCustomer, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { Cart } from '../../../src/modules/carts/entities/cart.entity.js';

/**
 * Feature 036 (US1) — `POST /api/v1/orders` contract over the real HTTP stack.
 * Verifies the wire response shape promised in `@endora-commerce/contracts`:
 *   - `data.businessId` is the customer-facing identifier (distinct from `id`),
 *   - `data.nextAction` carries the real adapter variant (here:
 *     `awaiting_transfer` because the seeded method uses the bank-transfer
 *     adapter), with the order's `amount`/`currency`,
 *   - the cart transitions to `completed` once placement succeeds, and records
 *     which order consumed it (D-94.1, `carts.completed_order_id`).
 */
describe('POST /api/v1/orders — contract', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCartForStubCustomer(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns businessId + the adapter-driven nextAction and completes the cart', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      cookies: { b2b_session: 'stub-customer-session' },
      headers: { 'content-type': 'application/json' },
      payload: {
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
        deliveryMethodId: '00000000-0000-4000-8000-0000000000e1',
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        id: string;
        businessId: string;
        total: number;
        currency: string;
        nextAction:
          | { kind: 'none' }
          | {
              kind: 'awaiting_transfer';
              accountDetails: {
                accountNumber: string;
                accountHolder: string;
                bankName: string;
                amount: number;
                currency: string;
                reference: string;
              };
            }
          | { kind: 'redirect_to_gateway'; url: string; expiresAt: string };
      };
    };

    // businessId is present, non-empty, and distinct from the UUID id.
    expect(typeof body.data.businessId).toBe('string');
    expect(body.data.businessId.length).toBeGreaterThan(0);
    expect(body.data.businessId).not.toBe(body.data.id);

    // The bank-transfer adapter → awaiting_transfer next-action with the
    // order's monetary fields, not the previously hard-coded stub.
    expect(body.data.nextAction.kind).toBe('awaiting_transfer');
    if (body.data.nextAction.kind === 'awaiting_transfer') {
      expect(body.data.nextAction.accountDetails.amount).toBe(body.data.total);
      expect(body.data.nextAction.accountDetails.currency).toBe(body.data.currency);
      expect(body.data.nextAction.accountDetails.reference).toMatch(/^ORDER-/);
    }

    // Cart consumed — and, since D-94.1, it records **which** order consumed
    // it. Before `carts_completed_order_fk` the platform answered that question
    // by correlating timestamps; `placeOrder` stamps the pointer beside
    // `status = 'completed'`, on the placement transaction, which is the only
    // place it can be stamped because the pointer cannot be written before the
    // order exists.
    const cart = await h.em().findOne(Cart, { customerAccountId: TEST_CUSTOMER_ID });
    expect(cart?.status).toBe('completed');
    expect(cart?.completedOrderId).toBe(body.data.id);
  });
});
