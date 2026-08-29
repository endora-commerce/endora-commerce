import { randomUUID } from 'node:crypto';
import { Organization } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreditLimitPort } from '@endora-commerce/mod-credit-limits/ports';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { CreditLimit, CreditLimitReservation } from '../../helpers/package-entities.js';
import { Order } from '../../helpers/package-entities.js';

/**
 * The co-transactional seam, measured **across a package boundary** (feature
 * 080, T040b; D-169, D-171).
 *
 * `credit_limits` is `@endora-commerce/mod-credit-limits` now, and this is the
 * first module package whose published surface is a **port**: `CreditLimitPort`
 * on the type-only `./ports` subpath, which exists because `reserve` names a
 * MikroORM `EntityManager` and `packages/contracts` is compiled by `admin` and
 * `storefront` and holds none.
 *
 * The type in this file's `import type` is the one the consumer sees. The value
 * is resolved from the composed container under `creditLimitService`, exactly as
 * `orders` resolves it. So the two halves of D-171's claim — *the interface is
 * published, the implementation is reached through the container* — are the two
 * halves of this file, and nothing here type-asserts its way past either: a
 * signature drift in the package's `dist` fails the `import type`, and a
 * registration that stopped being a port fails the resolution.
 *
 * **What is asserted is the guarantee the foreign key exists for**, not that a
 * method can be called. `credit_limit_reservations_order_fk`
 * (`credit_limit_reservations.order_id` -> `orders.id`, `on delete restrict`)
 * and the `PESSIMISTIC_WRITE` `reserve` holds are one mechanism: a placement
 * that rolls back must consume no credit. That property is invisible to a unit
 * test with a stubbed transaction and it is precisely what a package boundary
 * could have broken — a second `EntityManager` on the package's side, a second
 * copy of the entity metadata, a `dist` compiled against a stale contract. It is
 * measured here by rolling a real caller transaction back and reading the
 * database afterwards.
 *
 * The `orders` half is deliberately its own case rather than a full placement:
 * this file's subject is the seam, and driving it directly is what makes a
 * failure name the seam instead of naming whichever of placement's twenty other
 * collaborators moved.
 */
describe('CreditLimitPort across the package boundary (D-169/D-171)', () => {
  let h: BackendServerHandle;
  let organizationId: string;

  /** The port as its **owner** publishes it, resolved as `orders` resolves it. */
  const port = (): CreditLimitPort =>
    (h.container.cradle as unknown as { creditLimitService: CreditLimitPort })
      .creditLimitService;

  const availableFor = async (orgId: string): Promise<number> => {
    const em = h.em();
    const limit = await em.findOne(CreditLimit, { organizationId: orgId });
    if (limit === null) throw new Error('[seam] the fixture limit is gone');
    const reservations = await em.find(CreditLimitReservation, {
      creditLimitId: limit.id,
      status: 'active',
    });
    return (
      Number(limit.grantedAmount) -
      reservations.reduce((sum, row) => sum + Number(row.amount), 0)
    );
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'T040b package seam org',
      taxId: 'PL0840000004',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organizationId = org.id;
    const limit = em.create(CreditLimit, {
      organizationId: org.id,
      grantedAmount: '1000.00',
      currency: 'PLN',
    });
    await em.persistAndFlush(limit);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** An order row the reservation's foreign key can point at. */
  const insertOrder = async (em: EntityManager): Promise<string> => {
    const order = em.create(Order, {
      organizationId,
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      status: 'pending',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'S', street: 's', city: 'c', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'cl', name: 'CL', kind: 'credit_limit' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  };

  it('reserves on the caller`s transaction and reduces available credit when it commits', async () => {
    const before = await availableFor(organizationId);
    const em = h.em().fork();
    const result = await em.transactional(async (tx) => {
      const orderId = await insertOrder(tx as EntityManager);
      return port().reserve({
        organizationId,
        orderId,
        amount: 250,
        currency: 'PLN',
        tx: tx as EntityManager,
      });
    });

    expect(result.ok).toBe(true);
    expect(await availableFor(organizationId)).toBe(before - 250);
  });

  it('consumes no credit when the caller`s transaction rolls back', async () => {
    const before = await availableFor(organizationId);
    const em = h.em().fork();
    const marker = `t040b-rollback-${randomUUID()}`;

    await expect(
      em.transactional(async (tx) => {
        const orderId = await insertOrder(tx as EntityManager);
        const reserved = await port().reserve({
          organizationId,
          orderId,
          amount: 400,
          currency: 'PLN',
          tx: tx as EntityManager,
        });
        // The reservation is real *inside* the transaction — otherwise the
        // assertion below would pass for a call that reserved nothing at all.
        expect(reserved.ok).toBe(true);
        const seen = await (tx as EntityManager).execute(
          `select count(*)::int as n from "credit_limit_reservations" where order_id = ?`,
          [orderId],
        );
        expect((seen as { n: number }[])[0]?.n).toBe(1);
        throw new Error(marker);
      }),
    ).rejects.toThrow(marker);

    expect(await availableFor(organizationId)).toBe(before);
  });

  it('refuses at the port gate while `credit_limits` is off, rather than half-reserving', async () => {
    const before = await availableFor(organizationId);
    await withModuleOff('credit_limits', 'deactivated', async () => {
      const em = h.em().fork();
      await expect(
        em.transactional(async (tx) => {
          const orderId = await insertOrder(tx as EntityManager);
          return port().reserve({
            organizationId,
            orderId,
            amount: 100,
            currency: 'PLN',
            tx: tx as EntityManager,
          });
        }),
      ).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    });
    expect(await availableFor(organizationId)).toBe(before);
  });
});
