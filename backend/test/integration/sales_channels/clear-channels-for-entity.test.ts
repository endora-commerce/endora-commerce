import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '@endora-commerce/platform/events';
import { AuditLogService, DefaultChannelReconciler } from '@endora-commerce/platform/composition';
import { AuditLogEntry, SalesChannel } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { DeliveryMethod, PaymentMethod, Product } from '../../helpers/package-entities.js';

/**
 * `SalesChannelMembershipService.clearChannelsForEntity` — the one mutation
 * that ends below the at-least-one-channel floor (FR-008), and the declaration
 * that licenses it.
 *
 * The platform holds two conventions for an entity bound to no channel, and
 * since this method they are a stated property of each bridge rather than a
 * habit: for a **product** a row-less entity is published nowhere and the floor
 * is absolute; for a **delivery** or **payment method** the owning module
 * registers its bridge with `emptyMeansEveryChannel`, a membership is a
 * restriction, and "none" is a state an operator may choose.
 *
 * So the same call is refused for one type and performed for the other, and
 * that asymmetry is the subject. The bridges are the modules' own
 * registrations (`setupTestDb()` declares them from each owner's
 * `salesChannelBridges`), which makes this also the test that the two method
 * modules really do declare the flag.
 */
describe('membership: clearing every channel of an entity', () => {
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

  async function twoChannels(): Promise<{ def: SalesChannel; second: SalesChannel }> {
    const em = db.em();
    await new DefaultChannelReconciler(() => em).run();
    const def = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    const second = em.create(SalesChannel, {
      code: 'clear-channels-b',
      name: { en: 'Clear B' },
      defaultLanguage: 'en',
      defaultCurrency: 'EUR',
      languages: ['en'],
      currencies: ['EUR'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush(second);
    return { def, second };
  }

  function service(events: Array<{ op: string; channelId: string }> = []): SalesChannelMembershipService {
    const bus = new EventBus();
    bus.on('sales_channels.membership_changed' as never, ((payload: {
      op: string;
      channelId: string;
    }) => {
      events.push({ op: payload.op, channelId: payload.channelId });
    }) as never);
    return new SalesChannelMembershipService(
      () => db.em(),
      bus,
      new AuditLogService(() => db.em()),
    );
  }

  it.each([
    {
      entityType: 'delivery-method' as const,
      create: async (): Promise<string> => {
        const em = db.em();
        const row = em.create(DeliveryMethod, {
          code: 'clear_delivery',
          name: { 'en-US': 'Clear delivery' },
          cost: '0',
          currency: 'PLN',
          adapter: 'manual_courier',
        });
        await em.persistAndFlush(row);
        return row.id;
      },
    },
    {
      entityType: 'payment-method' as const,
      create: async (): Promise<string> => {
        const em = db.em();
        const row = em.create(PaymentMethod, {
          code: 'clear_payment',
          name: { 'en-US': 'Clear payment' },
          kind: 'bank_transfer',
          adapter: 'bank_transfer',
          statusOnPending: 'new',
          statusOnSuccess: 'paid',
          statusOnFailure: 'cancelled',
        });
        await em.persistAndFlush(row);
        return row.id;
      },
    },
  ])(
    'removes every membership of a $entityType, with one audit row and one event per channel',
    async ({ entityType, create }) => {
      try {
        const { def, second } = await twoChannels();
        const id = await create();
        const events: Array<{ op: string; channelId: string }> = [];
        const svc = service(events);
        await svc.addToChannel(def.id, entityType, id);
        await svc.addToChannel(second.id, entityType, id);
        events.length = 0;

        const result = await svc.clearChannelsForEntity(entityType, id);

        expect(result).toEqual({ changed: true });
        expect(await svc.listChannelsForEntity(entityType, id)).toEqual([]);

        expect(events.map((e) => e.op)).toEqual(['remove', 'remove']);
        expect(events.map((e) => e.channelId).sort()).toEqual([def.id, second.id].sort());

        const audited = (
          await db.em().find(AuditLogEntry, {
            action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED,
          })
        )
          .map((r) => r.stateAfter as { op: string; entityId: string; channelId: string })
          .filter((s) => s.entityId === id && s.op === 'remove');
        expect(audited.map((s) => s.channelId).sort()).toEqual([def.id, second.id].sort());

        // Already bound to nothing: a no-op, and not audited a second time.
        expect(await svc.clearChannelsForEntity(entityType, id)).toEqual({ changed: false });
      } finally {
        await db.rollbackTx();
      }
    },
  );

  it('refuses for a product, whose bridge does not declare that empty means every channel', async () => {
    try {
      const { def } = await twoChannels();
      const em = db.em();
      const product = em.create(Product, {
        sku: 'CLEAR-PRODUCT',
        slug: 'clear-product',
        type: 'simple',
        status: 'draft',
        name: { en: 'Clear product' },
        description: { en: 'fixture' },
        visibility: 'public',
        attributeValues: {},
        allowedOrganizationIds: [],
      });
      await em.persistAndFlush(product);
      const svc = service();
      await svc.addToChannel(def.id, 'product', product.id);

      const error = await svc.clearChannelsForEntity('product', product.id).then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).statusCode).toBe(422);
      expect((error as HttpError).code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
      // Refused before the delete: the product is still published where it was.
      expect((await svc.listChannelsForEntity('product', product.id)).map((c) => c.id)).toEqual([
        def.id,
      ]);
    } finally {
      await db.rollbackTx();
    }
  });

  /**
   * The flag changes what an explicit clear may do and nothing else: removing a
   * method's **last** membership one channel at a time is still refused, so
   * "only this channel" cannot become "every channel" as the side effect of a
   * removal on the sales-channel screen.
   */
  it('still refuses to remove a delivery method’s last membership one channel at a time', async () => {
    try {
      const { second } = await twoChannels();
      const em = db.em();
      const row = em.create(DeliveryMethod, {
        code: 'clear_last_one',
        name: { 'en-US': 'Last one' },
        cost: '0',
        currency: 'PLN',
        adapter: 'manual_courier',
      });
      await em.persistAndFlush(row);
      const svc = service();
      await svc.addToChannel(second.id, 'delivery-method', row.id);

      const error = await svc.removeFromChannel(second.id, 'delivery-method', row.id).then(
        () => null,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
    } finally {
      await db.rollbackTx();
    }
  });
});
