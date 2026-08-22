import type { EntityManager } from '@mikro-orm/postgresql';
import type { PushSubscriptionInput } from '@endora-commerce/contracts';
import { PushSubscription } from '../entities/push-subscription.entity.js';

export interface RegisterSubscriptionInput extends PushSubscriptionInput {
  salesChannelId: string;
  customerAccountId?: string | null;
}

export interface RegisterSubscriptionResult {
  id: string;
  status: 'active';
  created: boolean;
}

/**
 * Push subscription registry (US4). Upsert on `endpoint` (idempotent re-subscribe,
 * FR-017, multi-device edge case), revoke (FR-018), and prune dead endpoints
 * reported by the provider (FR-022).
 */
export class PushSubscriptionService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async register(input: RegisterSubscriptionInput): Promise<RegisterSubscriptionResult> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();
    const existing = await em.findOne(PushSubscription, { endpoint: input.endpoint });
    if (existing) {
      existing.p256dh = input.keys.p256dh;
      existing.auth = input.keys.auth;
      existing.salesChannelId = input.salesChannelId;
      existing.customerAccountId = input.customerAccountId ?? null;
      existing.status = 'active';
      existing.lastSeenAt = new Date();
      if (input.userAgent !== undefined) existing.userAgent = input.userAgent;
      await em.flush();
      return { id: existing.id, status: 'active', created: false };
    }

    const sub = em.create(PushSubscription, {
      salesChannelId: input.salesChannelId,
      customerAccountId: input.customerAccountId ?? null,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      provider: 'web_push',
      status: 'active',
      userAgent: input.userAgent ?? null,
      lastSeenAt: new Date(),
    });
    await em.persistAndFlush(sub);
    return { id: sub.id, status: 'active', created: true };
  }

  /** Revoke by endpoint. Idempotent — returns false if nothing was deleted. */
  async revoke(endpoint: string): Promise<boolean> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();
    const existing = await em.findOne(PushSubscription, { endpoint });
    if (!existing) return false;
    await em.removeAndFlush(existing);
    return true;
  }

  /** Mark a subscription invalid and delete it (provider reported the endpoint gone). */
  async prune(subscriptionId: string): Promise<void> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    const em = this.emFactory();
    const existing = await em.findOne(PushSubscription, { id: subscriptionId });
    if (!existing) return;
    await em.removeAndFlush(existing);
  }

  /**
   * `null` = the admin asked for a scope this deployment has no channel for, so
   * there is nothing subscribed to count. The column is `NOT NULL`, so the
   * query matches no row and the honest answer is zero — where the `'default'`
   * sentinel used to make PostgreSQL reject the comparison outright.
   */
  async statsForChannel(
    salesChannelId: string | null,
  ): Promise<{ active: number; invalid: number }> {
    const em = this.emFactory();
    const [active, invalid] = await Promise.all([
      em.count(PushSubscription, { salesChannelId, status: 'active' }),
      em.count(PushSubscription, { salesChannelId, status: 'invalid' }),
    ]);
    return { active, invalid };
  }
}
