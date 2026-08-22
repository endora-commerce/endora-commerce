import { describe, expect, it, vi } from 'vitest';
import { GOOGLE_ANALYTICS_SETTING_CODES } from '@b2b/contracts';
import type { Queue } from 'bullmq';
import { makeEnqueuer, makeProcessor } from './ss-delivery.service.js';
import type { GaDeliveryJobData } from './ss-delivery-queue.js';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';
import type { Ga4MpClient } from './ga4-mp-client.js';

const C = GOOGLE_ANALYTICS_SETTING_CODES;

describe('makeEnqueuer (producer, Principle X)', () => {
  it('enqueues one job per event, each with a stable eventId as jobId', async () => {
    const added: Array<{ name: string; data: GaDeliveryJobData; opts: unknown }> = [];
    const queue = {
      add: vi.fn(async (name: string, data: GaDeliveryJobData, opts: unknown) => {
        added.push({ name, data, opts });
        return { id: data.eventId };
      }),
    } as unknown as Queue<GaDeliveryJobData>;

    const accepted = await makeEnqueuer(queue)('chan-1', {
      clientId: 'c-1',
      consent: { analyticsStorage: 'granted' },
      events: [
        { name: 'page_view', params: {} },
        { name: 'add_to_cart', params: { sku: 'X1' } },
      ],
    });

    expect(accepted).toBe(2);
    expect(added).toHaveLength(2);
    expect(added[0]!.data.eventId).toBeTruthy();
    // eventId is threaded into params for idempotency and used as the jobId.
    expect(added[0]!.data.event.params['ga_event_id']).toBe(added[0]!.data.eventId);
    expect((added[0]!.opts as { jobId: string }).jobId).toBe(added[0]!.data.eventId);
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
