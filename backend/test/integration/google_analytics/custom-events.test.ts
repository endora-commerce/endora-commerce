import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../../src/db/mikro-orm.config.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { GaCustomEvent } from '../../../src/modules/google_analytics/entities/ga-custom-event.entity.js';
import {
  GaCustomEventsService,
  type GaChannelPort,
} from '../../../src/modules/google_analytics/services/custom-events.service.js';

/**
 * DB-backed integration test for GaCustomEventsService (feature 049, US3).
 * Exercises CRUD against a real Postgres and the storefront `loadForChannel`
 * resolution (channel-scoped OR all-channels, enabled-only).
 */
describe('GaCustomEventsService (integration)', () => {
  let orm: MikroORM;
  let em: () => EntityManager;
  let channelId: string;
  let channelCode: string;
  let service: GaCustomEventsService;
  const created: string[] = [];
  const ctx = { actorAdminUserId: null };

  beforeAll(async () => {
    orm = await MikroORM.init(mikroOrmConfig);
    em = () => orm.em.fork() as EntityManager;
    const channels0 = await em().find(
      SalesChannel,
      { id: { $ne: '00000000-0000-0000-0000-000000000000' } },
      { orderBy: { createdAt: 'asc' }, limit: 1 },
    );
    const channel = channels0[0];
    if (!channel) throw new Error('no sales channel seeded');
    channelId = channel.id;
    channelCode = channel.code;
    const channels: GaChannelPort = {
      idByCode: async (code) => (code === channelCode ? channelId : null),
      codeById: async (id) => (id === channelId ? channelCode : null),
    };
    service = new GaCustomEventsService(em, channels);
  });

  afterAll(async () => {
    const e = em();
    for (const id of created) {
      const row = await e.findOne(GaCustomEvent, { id });
      if (row) await e.removeAndFlush(row);
    }
    await orm.close(true);
  });

  it('creates, reads, updates, and deletes a custom event', async () => {
    const dto = await service.create(
      {
        eventName: 'test_add_cart',
        triggerAction: 'add_to_cart',
        enabled: true,
        fields: [{ fieldKey: 'sku', position: 0 }],
        salesChannelCode: channelCode,
      },
      ctx,
    );
    created.push(dto.id);
    expect(dto.eventName).toBe('test_add_cart');
    expect(dto.salesChannelCode).toBe(channelCode);
    expect(dto.version).toBe(1);

    const fetched = await service.get(dto.id);
    expect(fetched.fields).toHaveLength(1);

    const updated = await service.update(dto.id, { enabled: false, version: dto.version }, ctx);
    expect(updated.enabled).toBe(false);
    expect(updated.version).toBe(2);

    await service.remove(dto.id, ctx);
    await expect(service.get(dto.id)).rejects.toThrow();
    created.splice(created.indexOf(dto.id), 1);
  });

  it('rejects a stale-version update with a 409 conflict', async () => {
    const dto = await service.create(
      { eventName: 'test_conflict', triggerAction: 'add_to_cart', enabled: true, fields: [] },
      ctx,
    );
    created.push(dto.id);
    await expect(
      service.update(dto.id, { enabled: false, version: 999 }, ctx),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('loadForChannel returns enabled channel/all-channel events, excludes disabled', async () => {
    const all = await service.create(
      {
        eventName: 'test_all',
        triggerAction: 'add_to_cart',
        enabled: true,
        fields: [
          { fieldKey: 'sku', position: 0 },
          { fieldKey: 'price', payloadKey: 'unit_price', position: 1 },
        ],
      },
      ctx,
    );
    created.push(all.id);
    const disabled = await service.create(
      { eventName: 'test_off', triggerAction: 'add_to_cart', enabled: false, fields: [] },
      ctx,
    );
    created.push(disabled.id);

    const events = await service.loadForChannel(channelId);
    const names = events.map((e) => e.eventName);
    expect(names).toContain('test_all');
    expect(names).not.toContain('test_off');
    // payloadKey defaults to fieldKey when unset; explicit alias preserved.
    const allEvent = events.find((e) => e.eventName === 'test_all');
    expect(allEvent?.fields).toEqual([
      { fieldKey: 'sku', payloadKey: 'sku' },
      { fieldKey: 'price', payloadKey: 'unit_price' },
    ]);
  });
});
