import type { Command } from '@endora-commerce/platform/commands';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';
import { subscriberPlanConflict } from './subscriber-plan.js';

/**
 * Where a suppression's entry is filed, resolved before the write (issue
 * #1381): under the address's subscriber when it has one, otherwise under the
 * suppression row — the address itself is a value and never becomes an
 * `objectId` (#470).
 */
export type SuppressionTarget =
  | { readonly objectType: 'newsletter_subscriber'; readonly objectId: string }
  | {
      readonly objectType: 'newsletter_suppression';
      readonly objectId: string;
      /** Whether the suppression row already exists, or is created with `objectId`. */
      readonly exists: boolean;
    };

/**
 * `newsletter_bounce` / `newsletter_complaint` (feature 048 FR-035, issue
 * #1381, Principle XIII).
 *
 * Suppresses an address on provider feedback: writes or updates its
 * suppression row, so it is excluded from every future send, and deactivates an
 * active subscriber. A bounce or complaint suppression is not lifted by a later
 * re-subscribe. The one entry holds the suppression's reason code, never the
 * address (#470).
 */
export function makeSuppressSubscriberCommand(input: {
  email: string;
  reason: 'bounce' | 'complaint';
  detail?: string | undefined;
  target: SuppressionTarget;
}): Command<void> {
  const { email, reason, detail, target } = input;
  return {
    action: `newsletter_${reason}`,
    objectType: target.objectType,
    objectId: target.objectId,
    run: async ({ em }) => {
      const existing = await em.findOne(NewsletterSuppression, { email });
      const subscriber = await em.findOne(NewsletterSubscriber, { email });
      const planned =
        target.objectType === 'newsletter_subscriber'
          ? subscriber?.id === target.objectId
          : subscriber === null && (target.exists ? existing?.id === target.objectId : existing === null);
      if (!planned) throw subscriberPlanConflict();

      if (existing) {
        existing.reason = reason;
        if (detail) existing.detail = detail;
      } else {
        em.create(NewsletterSuppression, {
          ...(target.objectType === 'newsletter_suppression' ? { id: target.objectId } : {}),
          email,
          reason,
          detail: detail ?? null,
        });
      }
      if (subscriber && subscriber.status === 'active') {
        subscriber.status = 'deactivated';
        subscriber.deactivatedAt = new Date();
      }
      await em.flush();
      return { result: undefined, after: { reason } };
    },
  };
}
