import { isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';

/**
 * `newsletter_confirm` (feature 048 US1, issue #1381, Principle XIII).
 *
 * Activates a double opt-in subscriber from a verified confirmation token.
 * Idempotent: an unknown or malformed id answers `{ ok: false }`, a subscriber
 * that is not `pending` answers `{ ok: true }`, and neither writes or records
 * anything. The one entry holds the new status only.
 */
export function makeConfirmSubscriberCommand(input: { subscriberId: string }): Command<{ ok: boolean }> {
  return {
    action: 'newsletter_confirm',
    objectType: 'newsletter_subscriber',
    objectId: input.subscriberId,
    run: async ({ em }) => {
      if (!isUuidShape(input.subscriberId)) return { result: { ok: false }, skipAudit: true };
      const subscriber = await em.findOne(NewsletterSubscriber, { id: input.subscriberId });
      if (!subscriber) return { result: { ok: false }, skipAudit: true };
      if (subscriber.status !== 'pending') return { result: { ok: true }, skipAudit: true };
      subscriber.status = 'active';
      subscriber.confirmedAt = new Date();
      subscriber.consentAt ??= new Date();
      await em.flush();
      return { result: { ok: true }, after: { status: 'active' } };
    },
  };
}
