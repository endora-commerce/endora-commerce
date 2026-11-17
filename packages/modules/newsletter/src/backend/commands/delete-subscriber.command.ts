import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';

/**
 * `newsletter_delete` (feature 048 US3, issue #1381, Principle XIII).
 *
 * An operator deletes a subscriber; its tag and campaign bridges cascade by
 * foreign key. A suppression keyed by the address is kept, so it stays
 * unmailable (R6). `404` for an unknown or malformed id, recording nothing.
 * The one entry's `stateBefore` holds the status, never the address (#470,
 * D-288); `stateAfter` is `null`.
 */
export function makeDeleteSubscriberCommand(input: { subscriberId: string }): Command<void> {
  return {
    action: 'newsletter_delete',
    objectType: 'newsletter_subscriber',
    objectId: input.subscriberId,
    run: async ({ em }) => {
      if (!isUuidShape(input.subscriberId)) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
      }
      const subscriber = await em.findOne(NewsletterSubscriber, { id: input.subscriberId });
      if (!subscriber) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
      const before = { status: subscriber.status };
      const existing = await em.findOne(NewsletterSuppression, { email: subscriber.email });
      if (!existing) {
        em.create(NewsletterSuppression, { email: subscriber.email, reason: 'unsubscribe', detail: 'deleted' });
      }
      em.remove(subscriber);
      await em.flush();
      return { result: undefined, before, after: null };
    },
  };
}
