import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { PWA_SETTING_CODES, type PushSubscriptionRef } from '@endora-commerce/contracts';

// Mock the web-push library so we can script statusCodes.
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotification(...args) },
}));

const { WebPushProvider } = await import(
  '../../../src/modules/pwa/services/providers/web-push-provider.js'
);

function settingsWith(keys: Record<string, string>) {
  return {
    async get<T>(code: string, _channelId: string, schema: z.ZodType<T>): Promise<T> {
      return schema.parse(keys[code] ?? '');
    },
  };
}

const SUB: PushSubscriptionRef = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
  keys: { p256dh: 'p', auth: 'a' },
  provider: 'web_push',
  salesChannelId: 'c1',
};

const CONFIGURED = settingsWith({
  [PWA_SETTING_CODES.VAPID_PUBLIC_KEY]: 'PUB',
  [PWA_SETTING_CODES.VAPID_PRIVATE_KEY]: 'PRIV',
});

describe('WebPushProvider (feature 046)', () => {
  afterEach(() => sendNotification.mockReset());

  it('reports not configured when VAPID keys are missing', async () => {
    const provider = new WebPushProvider(settingsWith({}), 'mailto:x@y.z');
    expect(await provider.isConfigured('c1')).toBe(false);
    const result = await provider.send(SUB, { title: 't', body: 'b' });
    expect(result).toEqual({ ok: false, gone: false, error: 'vapid_unconfigured', retryable: false });
  });

  it('maps a 2xx to ok', async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const provider = new WebPushProvider(CONFIGURED, 'mailto:x@y.z');
    expect(await provider.send(SUB, { title: 't', body: 'b' })).toEqual({ ok: true });
  });

  it('maps 404/410 to gone (prune)', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));
    const provider = new WebPushProvider(CONFIGURED, 'mailto:x@y.z');
    expect(await provider.send(SUB, { title: 't', body: 'b' })).toEqual({ ok: false, gone: true });
  });

  it('maps 429/5xx to retryable', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 503 }));
    const provider = new WebPushProvider(CONFIGURED, 'mailto:x@y.z');
    const result = await provider.send(SUB, { title: 't', body: 'b' });
    expect(result).toMatchObject({ ok: false, gone: false, retryable: true });
  });

  it('maps other 4xx to non-retryable failure', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('bad'), { statusCode: 400 }));
    const provider = new WebPushProvider(CONFIGURED, 'mailto:x@y.z');
    const result = await provider.send(SUB, { title: 't', body: 'b' });
    expect(result).toMatchObject({ ok: false, gone: false, retryable: false });
  });
});
