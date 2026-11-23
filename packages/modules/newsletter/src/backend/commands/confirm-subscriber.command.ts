import { isUuidShape, NEWSLETTER_HOOKABLE_ACTIONS, type NewsletterSubscriberHookData } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { subscriberHookData, subscriberOutboxData } from './subscriber-hook-data.js';
import { subscriberPlanConflict } from './subscriber-plan.js';

/**
 * `newsletter.subscriber.confirm` (feature 048 US1, issue #1381, Principle
 * XIII; `newsletter_confirm` before issue #1843).
 *
 * Activates a double opt-in subscriber from a verified confirmation token. The
 * caller runs it only for a subscriber it found `pending`
 * (`NewsletterSubscriberService.confirm`), so an unknown, malformed or already
 * confirmed link is answered there and runs nothing. Inside the transaction the
 * row it was planned against may have gone — deleted in between — which
 * refuses `409` as the subscribe plan does; or may no longer be pending — a
 * second click that won the race — which writes and records nothing, and
 * hands the hooks `previousStatus` equal to `status`. The one entry holds the
 * new status only.
 *
 * Hookable (issue #1843): a `beforeCommit` hook runs on this transaction after
 * the activation is flushed and may veto it; an `afterCommit` handler is
 * delivered through the outbox.
 */
export function makeConfirmSubscriberCommand(input: { subscriberId: string }): Command<NewsletterSubscriberHookData> {
  const ref = NEWSLETTER_HOOKABLE_ACTIONS.confirm;
  return {
    action: ref.action,
    objectType: ref.objectType,
    objectId: input.subscriberId,
    hookData: (result) => result,
    outboxData: subscriberOutboxData,
    run: async ({ em }) => {
      const subscriber = isUuidShape(input.subscriberId)
        ? await em.findOne(NewsletterSubscriber, { id: input.subscriberId })
        : null;
      if (!subscriber) throw subscriberPlanConflict();
      const previousStatus = subscriber.status;
      if (subscriber.status !== 'pending') {
        return { result: await subscriberHookData(em, subscriber, previousStatus), skipAudit: true };
      }
      subscriber.status = 'active';
      subscriber.confirmedAt = new Date();
      subscriber.consentAt ??= new Date();
      await em.flush();
      return { result: await subscriberHookData(em, subscriber, previousStatus), after: { status: 'active' } };
    },
  };
}
