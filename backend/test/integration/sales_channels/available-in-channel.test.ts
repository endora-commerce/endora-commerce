import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { testChannelBridges } from '../../helpers/channel-bridges.js';
import { EventBus } from '@endora-commerce/platform/events';
import { DefaultChannelReconciler } from '@endora-commerce/platform/composition';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { ChannelBridgeRegistry } from '../../../../packages/platform/dist/kernel/sales-channels/channel-bridge-registry.js';
import { DeliveryMethod, PaymentMethod, Product } from '../../helpers/package-entities.js';

/**
 * `filterEntityIdsAvailableInChannel` — "offered in this channel", answered by
 * the convention the owning module **declared** on its bridge.
 *
 * The rule that a delivery or payment method bound to no channel is offered in
 * every channel has exactly one statement, in the membership service, and it is
 * switched by `emptyMeansEveryChannel` on the bridge registration. The two
 * method modules' catalogues and their `isAvailableInChannel` are built on this
 * one read and add nothing to it.
 *
 * So three things are held here, over a real bridge:
 *
 *   - for the two method types, as their modules register them: bound here ⇒
 *     offered; bound elsewhere only ⇒ not; bound to nothing ⇒ offered;
 *   - for a product, whose module does not declare the flag: bound to nothing
 *     ⇒ **not** offered — the read is `filterEntityIdsInChannel`;
 *   - and the case that makes the declaration the source of the rule rather
 *     than a label beside it: the same delivery-method rows, read through a
 *     registry that registers the bridge **without** the flag, lose the "bound
 *     to nothing" answer. If the rule were written anywhere else — as it was,
 *     in each module — that case could not go red.
 */
describe('membership: which entities are offered in a channel', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  async function twoChannels(): Promise<{ a: SalesChannel; b: SalesChannel }> {
    const em = db.em();
    await new DefaultChannelReconciler(() => em).run();
    const a = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    const b = em.create(SalesChannel, {
      code: 'available-in-b',
      name: { en: 'Available B' },
      defaultLanguage: 'en',
      defaultCurrency: 'EUR',
      languages: ['en'],
      currencies: ['EUR'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush(b);
    return { a, b };
  }

  function service(bridges = testChannelBridges()): SalesChannelMembershipService {
    return new SalesChannelMembershipService(() => db.em(), new EventBus(), undefined, bridges);
  }

  async function deliveryMethod(code: string): Promise<string> {
    const em = db.em();
    const row = em.create(DeliveryMethod, {
      code,
      name: { 'en-US': code },
      cost: '0',
      currency: 'PLN',
      adapter: 'manual_courier',
    });
    await em.persistAndFlush(row);
    return row.id;
  }

  async function paymentMethod(code: string): Promise<string> {
    const em = db.em();
    const row = em.create(PaymentMethod, {
      code,
      name: { 'en-US': code },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(row);
    return row.id;
  }

  it.each([
    { entityType: 'delivery-method' as const, create: deliveryMethod },
    { entityType: 'payment-method' as const, create: paymentMethod },
  ])(
    'offers a $entityType bound to the channel or to none, and not one bound elsewhere only',
    async ({ entityType, create }) => {
      try {
        const { a, b } = await twoChannels();
        const svc = service();
        const onA = await create(`avail_on_a_${entityType}`);
        const onB = await create(`avail_on_b_${entityType}`);
        const onBoth = await create(`avail_on_both_${entityType}`);
        const unbound = await create(`avail_unbound_${entityType}`);
        await svc.addToChannel(a.id, entityType, onA);
        await svc.addToChannel(b.id, entityType, onB);
        await svc.addToChannel(a.id, entityType, onBoth);
        await svc.addToChannel(b.id, entityType, onBoth);
        const all = [onA, onB, onBoth, unbound];

        expect((await svc.filterEntityIdsAvailableInChannel(a.id, entityType, all)).sort()).toEqual(
          [onA, onBoth, unbound].sort(),
        );
        expect((await svc.filterEntityIdsAvailableInChannel(b.id, entityType, all)).sort()).toEqual(
          [onB, onBoth, unbound].sort(),
        );
        // The plain bridge read is unchanged by the declaration: bound, or not.
        expect((await svc.filterEntityIdsInChannel(a.id, entityType, all)).sort()).toEqual(
          [onA, onBoth].sort(),
        );
      } finally {
        await db.rollbackTx();
      }
    },
  );

  it('does not offer a product bound to no channel — its bridge declares no such convention', async () => {
    try {
      const { a } = await twoChannels();
      const em = db.em();
      const bound = em.create(Product, {
        sku: 'AVAIL-BOUND',
        slug: 'avail-bound',
        type: 'simple',
        status: 'draft',
        name: { en: 'Bound' },
        description: { en: 'fixture' },
        visibility: 'public',
        attributeValues: {},
        allowedOrganizationIds: [],
      });
      const unbound = em.create(Product, {
        sku: 'AVAIL-UNBOUND',
        slug: 'avail-unbound',
        type: 'simple',
        status: 'draft',
        name: { en: 'Unbound' },
        description: { en: 'fixture' },
        visibility: 'public',
        attributeValues: {},
        allowedOrganizationIds: [],
      });
      await em.persistAndFlush([bound, unbound]);
      const svc = service();
      await svc.addToChannel(a.id, 'product', bound.id);

      expect(
        await svc.filterEntityIdsAvailableInChannel(a.id, 'product', [bound.id, unbound.id]),
      ).toEqual([bound.id]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('stops offering an unbound delivery method when its bridge is registered without the flag', async () => {
    try {
      const { a } = await twoChannels();
      const unbound = await deliveryMethod('avail_flag_removed');

      // The live registry: the module declares the flag, the method is offered.
      expect(
        await service().filterEntityIdsAvailableInChannel(a.id, 'delivery-method', [unbound]),
      ).toEqual([unbound]);

      // The same table, the same row, the declaration withdrawn.
      const live = testChannelBridges().require('delivery-method');
      expect(live.emptyMeansEveryChannel).toBe(true);
      const withoutFlag = new ChannelBridgeRegistry();
      withoutFlag.register({
        entityType: live.entityType,
        table: live.table,
        entityIdColumn: live.entityIdColumn,
      });

      expect(
        await service(withoutFlag).filterEntityIdsAvailableInChannel(a.id, 'delivery-method', [
          unbound,
        ]),
      ).toEqual([]);
    } finally {
      await db.rollbackTx();
    }
  });
});
