import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';

/**
 * `newsletter_deactivate` (feature 048 US3, issue #1381, Principle XIII).
 *
 * An operator deactivates a subscriber, version-checked: `404` for an unknown
 * or malformed id, `409 VERSION_CONFLICT` for a stale version, and neither
 * records anything. The one entry holds the new status only.
 */
export function makeDeactivateSubscriberCommand(input: {
  subscriberId: string;
  expectedVersion: number;
}): Command<NewsletterSubscriber> {
  return {
    action: 'newsletter_deactivate',
    objectType: 'newsletter_subscriber',
    objectId: input.subscriberId,
    run: async ({ em }) => {
      if (!isUuidShape(input.subscriberId)) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
      }
      const subscriber = await em.findOne(NewsletterSubscriber, { id: input.subscriberId });
      if (!subscriber) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Subscriber not found.');
      if (subscriber.version !== input.expectedVersion) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Subscriber was modified.');
      }
      subscriber.status = 'deactivated';
      subscriber.deactivatedAt = new Date();
      subscriber.version += 1;
      await em.flush();
      return { result: subscriber, after: { status: 'deactivated' } };
    },
  };
}
