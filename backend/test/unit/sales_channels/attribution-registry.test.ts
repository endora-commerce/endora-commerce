import { describe, expect, it } from 'vitest';
import type { SalesChannelAttributionDescriptor } from '@endora-commerce/contracts';
import { SalesChannelAttributionRegistry } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channel-attribution-registry.js';

/**
 * The attribution registry's own rules (feature 075, D-87 drain).
 *
 * `SalesChannelsService.delete` used to answer "who still points at this
 * channel?" with one raw statement naming `orders` and `quote_requests` — two
 * other modules' tables, invisible to the import-level boundary check because
 * SQL names no specifier. The question is inverted onto this registry: each
 * owner counts its own rows.
 *
 * What this file pins is the **policy**, over descriptors it controls
 * completely. Whether the two boot hooks actually run is a different question
 * and a composed platform is the only thing that can answer it; that assertion
 * lives in `test/integration/sales_channels/delete-attribution-guard.test.ts`.
 */
describe('SalesChannelAttributionRegistry', () => {
  const CHANNEL = '00000000-0000-4000-8000-00000000c001';

  function descriptor(
    overrides: Partial<SalesChannelAttributionDescriptor> = {},
  ): SalesChannelAttributionDescriptor {
    return {
      ownerModuleId: 'orders',
      consumer: 'orders',
      tableName: 'orders',
      columnName: 'sales_channel_id',
      countForChannel: async () => 0,
      ...overrides,
    };
  }

  it('aggregates every descriptor and reports the owner that refuses', async () => {
    const registry = new SalesChannelAttributionRegistry();
    registry.register(descriptor({ countForChannel: async () => 3 }));
    registry.register(
      descriptor({
        ownerModuleId: 'quote_requests',
        consumer: 'quote_requests',
        tableName: 'quote_requests',
        countForChannel: async () => 7,
      }),
    );

    const found = await registry.countForChannel(CHANNEL);
    expect(found).toEqual([
      {
        ownerModuleId: 'orders',
        consumer: 'orders',
        tableName: 'orders',
        columnName: 'sales_channel_id',
        count: 3,
      },
      {
        ownerModuleId: 'quote_requests',
        consumer: 'quote_requests',
        tableName: 'quote_requests',
        columnName: 'sales_channel_id',
        count: 7,
      },
    ]);
  });

  it('drops a zero count rather than reporting a consumer that points at nothing', async () => {
    const registry = new SalesChannelAttributionRegistry();
    registry.register(descriptor({ countForChannel: async () => 0 }));
    registry.register(
      descriptor({ ownerModuleId: 'quote_requests', countForChannel: async () => 2 }),
    );

    const found = await registry.countForChannel(CHANNEL);
    expect(found.map((a) => a.ownerModuleId)).toEqual(['quote_requests']);
  });

  it('passes the channel id through to every descriptor unchanged', async () => {
    const registry = new SalesChannelAttributionRegistry();
    const asked: string[] = [];
    registry.register(
      descriptor({
        countForChannel: async (id) => {
          asked.push(id);
          return 0;
        },
      }),
    );

    await registry.countForChannel(CHANNEL);
    expect(asked).toEqual([CHANNEL]);
  });

  it('registers a descriptor once, so a re-run boot hook does not double-count', () => {
    const registry = new SalesChannelAttributionRegistry();
    const one = descriptor();
    registry.register(one);
    registry.register(one);
    expect(registry.owners()).toEqual(['orders']);
  });

  /**
   * The enumeration policy, and the reason it is not D-39's default.
   *
   * This registry has no presence predicate **by construction**: honouring an
   * absent contributor is not a branch it takes, it is the absence of one. A
   * test can only pin that by asserting the shape — a registry that grew a
   * `skip` would need a predicate to skip on, and there is nowhere to inject
   * one.
   */
  it('takes no presence predicate, because an absent contributor is honoured', () => {
    expect(SalesChannelAttributionRegistry.length).toBe(0);
  });
});
