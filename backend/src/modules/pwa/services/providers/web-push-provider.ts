import webpush from 'web-push';
import { z } from 'zod';
import {
  PWA_SETTING_CODES,
  type PushPayload,
  type PushProvider,
  type PushSendResult,
  type PushSubscriptionRef,
} from '@b2b/contracts';

export interface WebPushSettingsPort {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

const StringSchema = z.string();

/**
 * Default push provider (FR-019): standard Web-Push signed with VAPID via the
 * `web-push` library. On Chrome/Edge the endpoints are transported by Google's
 * free FCM, so this path is "FCM as backend" while keeping the storefront on
 * standard browser APIs.
 *
 * Stateless and concurrency-safe: VAPID keys are resolved per call from the
 * subscription's channel and passed via `sendNotification`'s `vapidDetails`
 * option (never `setVapidDetails`, which is process-global).
 *
 * Status mapping (research §R1):
 *   2xx        → ok
 *   404 / 410  → gone (caller prunes the subscription, FR-022)
 *   429 / 5xx  → retryable
 *   other 4xx  → non-retryable failure
 */
export class WebPushProvider implements PushProvider {
  readonly key = 'web_push';

  constructor(
    private readonly settings: WebPushSettingsPort,
    private readonly subject: string,
  ) {}

  private async resolveKeys(
    salesChannelId: string,
  ): Promise<{ publicKey: string; privateKey: string } | null> {
    try {
      const [publicKey, privateKey] = await Promise.all([
        this.settings.get(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, salesChannelId, StringSchema),
        this.settings.get(PWA_SETTING_CODES.VAPID_PRIVATE_KEY, salesChannelId, StringSchema),
      ]);
      if (!publicKey || !privateKey) return null;
      return { publicKey, privateKey };
    } catch {
      return null;
    }
  }

  async isConfigured(salesChannelId: string): Promise<boolean> {
    return (await this.resolveKeys(salesChannelId)) !== null;
  }

  async send(sub: PushSubscriptionRef, payload: PushPayload): Promise<PushSendResult> {
    const keys = await this.resolveKeys(sub.salesChannelId);
    if (!keys) {
      return { ok: false, gone: false, error: 'vapid_unconfigured', retryable: false };
    }

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.iconUrl,
      url: payload.url,
      tag: payload.tag,
    });

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        body,
        { vapidDetails: { subject: this.subject, publicKey: keys.publicKey, privateKey: keys.privateKey } },
      );
      return { ok: true };
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? 0;
      if (statusCode === 404 || statusCode === 410) {
        return { ok: false, gone: true };
      }
      const retryable =
        statusCode === 429 || (statusCode >= 500 && statusCode < 600) || statusCode === 0;
      return { ok: false, gone: false, error: `web-push status ${statusCode}`, retryable };
    }
  }
}
