import { isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';

export interface UnsubscribeSubscriberResult {
  readonly ok: boolean;
  /** The subscriber that was unsubscribed by this call; `null` when nothing changed. */
  readonly unsubscribed: { readonly subscriberId: string; readonly email: string } | null;
}

/**
 * `newsletter_unsubscribe` (feature 048 US3/US9, issue #1381, Principle XIII).
 *
 * Unsubscribes with an optional reason and keeps the address unmailable with an
 * `unsubscribe` suppression. Idempotent: an unknown or malformed id answers
 * `{ ok: false }`, an already-unsubscribed subscriber `{ ok: true }`, and
 * neither writes or records anything. The one entry holds the status and
 * whether a reason was given, never its text (#470): that is on the subscriber.
 */
export function makeUnsubscribeSubscriberCommand(input: {
  subscriberId: string;
  reason?: string | undefined;
}): Command<UnsubscribeSubscriberResult> {
  return {
    action: 'newsletter_unsubscribe',
    objectType: 'newsletter_subscriber',
    objectId: input.subscriberId,
    run: async ({ em }) => {
      if (!isUuidShape(input.subscriberId)) return { result: { ok: false, unsubscribed: null }, skipAudit: true };
      const subscriber = await em.findOne(NewsletterSubscriber, { id: input.subscriberId });
      if (!subscriber) return { result: { ok: false, unsubscribed: null }, skipAudit: true };
      if (subscriber.status === 'unsubscribed') return { result: { ok: true, unsubscribed: null }, skipAudit: true };
      subscriber.status = 'unsubscribed';
      subscriber.unsubscribedAt = new Date();
      subscriber.unsubscribeReason = input.reason ?? null;
      const existing = await em.findOne(NewsletterSuppression, { email: subscriber.email });
      if (!existing) {
        em.create(NewsletterSuppression, {
          email: subscriber.email,
          reason: 'unsubscribe',
          detail: input.reason ?? null,
        });
      }
      await em.flush();
      return {
        result: { ok: true, unsubscribed: { subscriberId: subscriber.id, email: subscriber.email } },
        after: { status: 'unsubscribed', hasReason: Boolean(input.reason) },
      };
    },
  };
}
