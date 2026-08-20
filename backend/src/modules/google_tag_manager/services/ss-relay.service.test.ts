import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { GOOGLE_TAG_MANAGER_SETTING_CODES, type GtmCollectRequest } from '@b2b/contracts';
import { makeEnqueuer, makeProcessor } from './ss-relay.service.js';
import type { GtmRelayJobData } from './ss-relay-queue.js';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';
import type { SgtmClient } from './sgtm-client.js';

const C = GOOGLE_TAG_MANAGER_SETTING_CODES;

const request: GtmCollectRequest = {
  clientId: '1234567890.1754006400',
  consent: { analyticsStorage: 'granted' },
  page: { location: 'https://shop.example.com/p/widget-9', title: 'Widget 9' },
  events: [
    { name: 'view_item', params: { currency: 'PLN', value: 249 } },
    { name: 'add_to_cart', params: { currency: 'PLN', value: 1245 } },
  ],
};

function fakeQueue(): {
  queue: Queue<GtmRelayJobData>;
  added: Array<{ name: string; data: GtmRelayJobData; opts: { jobId: string } }>;
} {
  const added: Array<{ name: string; data: GtmRelayJobData; opts: { jobId: string } }> = [];
  const queue = {
    add: vi.fn(async (name: string, data: GtmRelayJobData, opts: { jobId: string }) => {
      added.push({ name, data, opts });
      return { id: data.eventId };
    }),
  } as unknown as Queue<GtmRelayJobData>;
  return { queue, added };
}

describe('makeEnqueuer (producer, Principle X)', () => {
  it('enqueues one job per event, each keyed by its own uuid eventId', async () => {
    const { queue, added } = fakeQueue();
    const accepted = await makeEnqueuer(queue)('chan-1', request, {});

    expect(accepted).toBe(2);
    expect(added).toHaveLength(2);
    const ids = added.map((a) => a.data.eventId);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    // jobId === eventId, so a duplicate enqueue is collapsed by BullMQ (FR-028).
    expect(added.map((a) => a.opts.jobId)).toEqual(ids);
  });

  it('threads the event id into the params as gtm_event_id for destination dedupe', async () => {
    const { queue, added } = fakeQueue();
    await makeEnqueuer(queue)('chan-1', request, {});
    for (const entry of added) {
      expect(entry.data.event.params['gtm_event_id']).toBe(entry.data.eventId);
    }
    // The caller's own params survive alongside it.
    expect(added[0]!.data.event.params['currency']).toBe('PLN');
  });

  it('carries the channel, client, consent, page context and one shared occurredAt', async () => {
    const { queue, added } = fakeQueue();
    await makeEnqueuer(queue)('chan-1', request, {});
    expect(added[0]!.data).toMatchObject({
      salesChannelId: 'chan-1',
      clientId: '1234567890.1754006400',
      consent: { analyticsStorage: 'granted' },
      page: { location: 'https://shop.example.com/p/widget-9', title: 'Widget 9' },
    });
    // Stamped once by the producer so retry latency does not distort timing.
    expect(added[0]!.data.occurredAt).toBe(added[1]!.data.occurredAt);
    expect(Number.isNaN(Date.parse(added[0]!.data.occurredAt))).toBe(false);
  });

  it('records the server-observed ip and user agent on the job', async () => {
    const { queue, added } = fakeQueue();
    await makeEnqueuer(queue)('chan-1', request, {
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
    expect(added[0]!.data.ip).toBe('203.0.113.7');
    expect(added[0]!.data.userAgent).toBe('Mozilla/5.0');
  });
});

describe('makeProcessor (consumer)', () => {
  const job = (data: Partial<GtmRelayJobData> = {}): never =>
    ({
      data: {
        eventId: 'e-1',
        salesChannelId: 'chan-1',
        clientId: 'c-1',
        event: { name: 'add_to_cart', params: { gtm_event_id: 'e-1' } },
        consent: { analyticsStorage: 'granted' as const },
        page: { location: 'https://shop.example.com/' },
        occurredAt: '2026-08-01T00:00:00.000Z',
        ...data,
      },
    }) as never;

  function fakeSettings(values: Record<string, unknown>): SettingsService {
    return {
      async get(code: string): Promise<unknown> {
        return values[code] ?? '';
      },
    } as unknown as SettingsService;
  }

  const configured = {
    [C.SERVER_CONTAINER_URL]: 'https://sgtm.example.com',
    [C.SERVER_INGEST_PATH]: '/data',
  };

  it('resolves the destination from the job channel and forwards the event', async () => {
    const send = vi.fn(async () => undefined);
    const processor = makeProcessor({
      settings: fakeSettings(configured),
      client: { send } as unknown as SgtmClient,
    });
    await processor(job({ ip: '203.0.113.7', userAgent: 'Mozilla/5.0' }), 'tok' as never);

    expect(send).toHaveBeenCalledOnce();
    const [destArg, evArg] = send.mock.calls[0]! as unknown as [unknown, unknown];
    expect(destArg).toEqual({ baseUrl: 'https://sgtm.example.com', ingestPath: '/data' });
    expect(evArg).toMatchObject({
      eventId: 'e-1',
      clientId: 'c-1',
      name: 'add_to_cart',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('returns without throwing when the server URL was cleared after enqueue', async () => {
    // A permanent no-op must not burn eight retries.
    const send = vi.fn(async () => undefined);
    const processor = makeProcessor({
      settings: fakeSettings({ [C.SERVER_CONTAINER_URL]: '   ' }),
      client: { send } as unknown as SgtmClient,
    });
    await expect(processor(job(), 'tok' as never)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('strips the ip and user agent when consent is denied (FR-030)', async () => {
    const send = vi.fn(async () => undefined);
    const processor = makeProcessor({
      settings: fakeSettings(configured),
      client: { send } as unknown as SgtmClient,
    });
    await processor(
      job({
        consent: { analyticsStorage: 'denied' },
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
      }),
      'tok' as never,
    );
    const [, evArg] = send.mock.calls[0]! as unknown as [unknown, Record<string, unknown>];
    expect(evArg['consent']).toEqual({ analyticsStorage: 'denied' });
    expect('ip' in evArg).toBe(false);
    expect('userAgent' in evArg).toBe(false);
  });

  it('propagates a client error so BullMQ retries', async () => {
    const send = vi.fn(async () => {
      throw new Error('sGTM delivery failed with status 500');
    });
    const processor = makeProcessor({
      settings: fakeSettings(configured),
      client: { send } as unknown as SgtmClient,
    });
    await expect(processor(job(), 'tok' as never)).rejects.toThrow(/500/);
  });
});
