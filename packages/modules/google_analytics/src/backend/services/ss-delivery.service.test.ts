import { describe, expect, it, vi } from 'vitest';
import { GOOGLE_ANALYTICS_SETTING_CODES, type GaCollectRequest } from '@endora-commerce/contracts';
import type { Queue } from 'bullmq';
import { makeEnqueuer, makeProcessor } from './ss-delivery.service.js';
import type { GaDeliveryJobData } from './ss-delivery-queue.js';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { Ga4MpClient } from './ga4-mp-client.js';

const C = GOOGLE_ANALYTICS_SETTING_CODES;

const request: GaCollectRequest = {
  clientId: 'c-1',
  consent: { analyticsStorage: 'granted' },
  events: [
    { name: 'page_view', params: {} },
    { name: 'add_to_cart', params: { sku: 'X1' } },
  ],
};

function fakeQueue(): {
  queue: Queue<GaDeliveryJobData>;
  added: Array<{ name: string; data: GaDeliveryJobData; opts: { jobId: string } }>;
} {
  const added: Array<{ name: string; data: GaDeliveryJobData; opts: { jobId: string } }> = [];
  const queue = {
    add: vi.fn(async (name: string, data: GaDeliveryJobData, opts: { jobId: string }) => {
      added.push({ name, data, opts });
      return { id: data.eventId };
    }),
  } as unknown as Queue<GaDeliveryJobData>;
  return { queue, added };
}

/** A channel whose server-side delivery is configured. */
const serverSideOn = async (): Promise<boolean> => true;

describe('makeEnqueuer (producer, Principle X)', () => {
  it('enqueues nothing for a channel whose server-side delivery is not configured', async () => {
    // Any instance with Redis has a queue, so "a queue exists" says nothing
    // about whether this channel delivers. Without this the producer wrote one
    // job per storefront event for the worker to read the same blank
    // Measurement ID and drop it.
    const { queue, added } = fakeQueue();
    const asked: string[] = [];
    const accepted = await makeEnqueuer(queue, async (salesChannelId) => {
      asked.push(salesChannelId);
      return false;
    })('chan-1', request);

    expect(accepted).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
    expect(added).toHaveLength(0);
    // Decided per channel, for the channel the request resolved to.
    expect(asked).toEqual(['chan-1']);
  });

  it('enqueues one job per event, each with a stable eventId as jobId', async () => {
    const { queue, added } = fakeQueue();

    const accepted = await makeEnqueuer(queue, serverSideOn)('chan-1', request);

    expect(accepted).toBe(2);
    expect(added).toHaveLength(2);
    expect(added[0]!.data.eventId).toBeTruthy();
    // eventId is threaded into params for idempotency and used as the jobId.
    expect(added[0]!.data.event.params['ga_event_id']).toBe(added[0]!.data.eventId);
    expect(added[0]!.opts.jobId).toBe(added[0]!.data.eventId);
  });
});

describe('makeProcessor (consumer)', () => {
  const job = (data: Partial<GaDeliveryJobData> = {}) =>
    ({
      data: {
        eventId: 'e-1',
        salesChannelId: 'chan-1',
        clientId: 'c-1',
        event: { name: 'add_to_cart', params: {} },
        consent: { analyticsStorage: 'granted' },
        occurredAt: '2026-07-15T00:00:00.000Z',
        ...data,
      },
    }) as never;

  function fakeSettings(values: Record<string, unknown>): SettingsReadPort {
    return {
      async get(code: string): Promise<unknown> {
        return values[code] ?? '';
      },
    } as unknown as SettingsReadPort;
  }

  it('forwards to the MP client with the resolved per-channel destination', async () => {
    const send = vi.fn(async (_dest: unknown, _ev: unknown) => undefined);
    const client = { send } as unknown as Ga4MpClient;
    const processor = makeProcessor({
      settings: fakeSettings({
        [C.MEASUREMENT_ID]: 'G-ABC',
        [C.SERVER_SIDE_API_SECRET]: 'sekret',
        [C.SERVER_SIDE_ENDPOINT]: '',
      }),
      client,
    });
    await processor(job(), 'tok' as never);
    expect(send).toHaveBeenCalledOnce();
    const [destArg, evArg] = send.mock.calls[0]!;
    expect(destArg).toMatchObject({ measurementId: 'G-ABC', apiSecret: 'sekret' });
    expect(evArg).toMatchObject({ clientId: 'c-1', name: 'add_to_cart' });
  });

  it('skips (does not forward) when the channel has no Measurement ID', async () => {
    const send = vi.fn(async (_dest: unknown, _ev: unknown) => undefined);
    const client = { send } as unknown as Ga4MpClient;
    const processor = makeProcessor({
      settings: fakeSettings({ [C.MEASUREMENT_ID]: '  ' }),
      client,
    });
    await processor(job(), 'tok' as never);
    expect(send).not.toHaveBeenCalled();
  });
});
