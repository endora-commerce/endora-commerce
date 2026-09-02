import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '../../../src/events/bus.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { DefaultChannelReconciler } from '../../../src/kernel/sales-channels/default-channel-reconciler.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product, type ProductRow } from '../../helpers/package-entities.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * T022 — At-least-one-channel invariant (FR-008) under the membership
 * service. Every channel-scoped entity must always be bound to at
 * least one channel; the service refuses removals that would violate
 * this and offers a `fallbackToDefault` path that automatically rebinds
 * to the system default.
 */
describe('membership invariant: at-least-one-channel (T022)', () => {
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

  async function ensureDefault(): Promise<SalesChannel> {
    const em = db.em();
    const reconciler = new DefaultChannelReconciler(() => em);
    await reconciler.run();
    return em.findOneOrFail(SalesChannel, { systemDefault: true });
  }

  async function ensureSecondaryChannel(): Promise<SalesChannel> {
    const em = db.em();
    const existing = await em.findOne(SalesChannel, { code: 't022-serwis-a' });
    if (existing) return existing;
    const channel = em.create(SalesChannel, {
      code: 't022-serwis-a',
      name: { en: 'Serwis A' },
      defaultLanguage: 'en',
      defaultCurrency: 'EUR',
      languages: ['en'],
      currencies: ['EUR'],
      isPublic: false,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush(channel);
    return channel;
  }

  async function createProduct(suffix: string): Promise<ProductRow> {
    const em = db.em();
    const product = em.create(Product, {
      sku: `T022-${suffix}`,
      slug: `t022-${suffix.toLowerCase()}`,
      type: 'simple',
      status: 'draft',
      name: { en: `T022 ${suffix}` },
      description: { en: 'fixture' },
      visibility: 'public',
      attributeValues: {},
      allowedOrganizationIds: [],
    });
    await em.persistAndFlush(product);
    return product;
  }

  it('removes a membership when the entity has another channel left', async () => {
    try {
      const def = await ensureDefault();
      const serwisA = await ensureSecondaryChannel();
      const product = await createProduct('A');
      const eventBus = new EventBus();
      const svc = new SalesChannelMembershipService(() => db.em(), eventBus);

      await svc.addToChannel(def.id, 'product', product.id);
      await svc.addToChannel(serwisA.id, 'product', product.id);

      const result = await svc.removeFromChannel(serwisA.id, 'product', product.id);
      expect(result.changed).toBe(true);
      expect(result.fallbackAppliedToDefault).toBeUndefined();

      const channels = await svc.listChannelsForEntity('product', product.id);
      expect(channels.map((c) => c.code).sort()).toEqual([def.code].sort());
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses removal that would leave the entity with zero channels', async () => {
    try {
      const def = await ensureDefault();
      const serwisA = await ensureSecondaryChannel();
      const product = await createProduct('B');
      const eventBus = new EventBus();
      const svc = new SalesChannelMembershipService(() => db.em(), eventBus);

      await svc.addToChannel(serwisA.id, 'product', product.id);

      let caught: unknown;
      try {
        await svc.removeFromChannel(serwisA.id, 'product', product.id);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);

      // Membership still present — refusal should not have side effects.
      const channels = await svc.listChannelsForEntity('product', product.id);
      expect(channels.map((c) => c.code)).toEqual([serwisA.code]);
      expect(def.systemDefault).toBe(true);
    } finally {
      await db.rollbackTx();
    }
  });

  it('rebinds to Default when fallbackToDefault=true', async () => {
    try {
      const def = await ensureDefault();
      const serwisA = await ensureSecondaryChannel();
      const product = await createProduct('C');
      const eventBus = new EventBus();
      const svc = new SalesChannelMembershipService(() => db.em(), eventBus);

      await svc.addToChannel(serwisA.id, 'product', product.id);

      const result = await svc.removeFromChannel(
        serwisA.id,
        'product',
        product.id,
        { fallbackToDefault: true },
      );
      expect(result.changed).toBe(true);
      expect(result.fallbackAppliedToDefault).toBe(true);

      const channels = await svc.listChannelsForEntity('product', product.id);
      expect(channels.map((c) => c.id)).toEqual([def.id]);
    } finally {
      await db.rollbackTx();
    }
  });

  it('is idempotent on add (no-op on second add) and remove (no-op when missing)', async () => {
    try {
      const def = await ensureDefault();
      const product = await createProduct('D');
      const eventBus = new EventBus();
      const svc = new SalesChannelMembershipService(() => db.em(), eventBus);

      const r1 = await svc.addToChannel(def.id, 'product', product.id);
      expect(r1.changed).toBe(true);
      const r2 = await svc.addToChannel(def.id, 'product', product.id);
      expect(r2.changed).toBe(false);

      // Removing a membership the entity does not have on a different channel
      // is also idempotent (changed=false), regardless of the FR-008 invariant.
      const otherChannel = await db.em().findOne(SalesChannel, { code: 't022-not-bound' });
      if (otherChannel === null) {
        // create + remove in a way that doesn't touch the FR-008 invariant
        const stranger = db.em().create(SalesChannel, {
          code: 't022-not-bound',
          name: { en: 'Stranger' },
          defaultLanguage: 'en',
          defaultCurrency: 'EUR',
          languages: ['en'],
          currencies: ['EUR'],
          isPublic: false,
          active: true,
          systemDefault: false,
          version: 1,
        });
        await db.em().persistAndFlush(stranger);
        const r3 = await svc.removeFromChannel(stranger.id, 'product', product.id);
        expect(r3.changed).toBe(false);
      }
    } finally {
      await db.rollbackTx();
    }
  });

  it('atomically replaces memberships without retaining the system default', async () => {
    try {
      const def = await ensureDefault();
      const target = await ensureSecondaryChannel();
      const product = await createProduct('E');
      const eventBus = new EventBus();
      const svc = new SalesChannelMembershipService(() => db.em(), eventBus);

      await svc.addToChannel(def.id, 'product', product.id);

      const result = await svc.replaceChannelsForEntity(
        'product',
        product.id,
        [target.id],
      );

      expect(result.changed).toBe(true);
      const channels = await svc.listChannelsForEntity('product', product.id);
      expect(channels.map((channel) => channel.id)).toEqual([target.id]);

      const repeated = await svc.replaceChannelsForEntity(
        'product',
        product.id,
        [target.id],
      );
      expect(repeated.changed).toBe(false);
    } finally {
      await db.rollbackTx();
    }
  });
});
