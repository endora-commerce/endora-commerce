import type { EntityManager } from '@mikro-orm/postgresql';
import type { Command } from '@endora-commerce/platform/commands';
import { NewsletterCustomField } from '../entities/newsletter-custom-field.entity.js';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import {
  mergeTypedCustomFields,
  ownerColumns,
  type CustomFieldValue,
  type ResolvedSubscriberOwner,
} from '../services/subscriber-fields.js';
import { subscriberPlanConflict } from './subscriber-plan.js';

/**
 * What the service resolved before the write (issue #1381): everything that
 * reads another module or the settings, and whether the address already has a
 * subscriber — which decides the action and the `objectId` the entry carries.
 */
export interface SubscribeSubscriberPlan {
  /** The existing subscriber's id, or the id a new one is created with. */
  readonly subscriberId: string;
  readonly isNew: boolean;
  /** Trimmed and lower-cased. */
  readonly email: string;
  readonly salesChannelId: string | null;
  readonly mode: 'single' | 'double';
  readonly owner: ResolvedSubscriberOwner;
  readonly source: string | null;
  readonly tags?: readonly string[] | undefined;
  readonly customFields?: Readonly<Record<string, CustomFieldValue>> | undefined;
}

export interface SubscribeSubscriberResult {
  readonly subscriberId: string;
  readonly status: NewsletterSubscriber['status'];
}

/**
 * `newsletter_subscribe` / `newsletter_resubscribe` (feature 048 US1, issue
 * #1381, Principle XIII).
 *
 * Creates or updates the subscriber for an address, lifts a self-unsubscribe
 * suppression on an explicit re-subscribe that ends active, merges the typed
 * custom fields and the known tags, and stamps the owner (D-187). The bus
 * records the one entry in the write's transaction. It names the subscriber by
 * id and holds the status and the source only, never the address (#470,
 * D-288). The confirmation e-mail and the observability event are the
 * caller's, after the commit.
 */
export function makeSubscribeSubscriberCommand(
  plan: SubscribeSubscriberPlan,
): Command<SubscribeSubscriberResult> {
  return {
    action: plan.isNew ? 'newsletter_subscribe' : 'newsletter_resubscribe',
    objectType: 'newsletter_subscriber',
    objectId: plan.subscriberId,
    run: async ({ em }) => {
      const suppressed = await em.findOne(NewsletterSuppression, { email: plan.email });
      let subscriber = await em.findOne(NewsletterSubscriber, { email: plan.email });
      if (plan.isNew ? subscriber !== null : subscriber?.id !== plan.subscriberId) {
        throw subscriberPlanConflict();
      }
      if (!subscriber) {
        subscriber = em.create(NewsletterSubscriber, {
          id: plan.subscriberId,
          email: plan.email,
          status: 'pending',
          source: plan.source,
          salesChannelId: plan.salesChannelId,
          // D-187 — the only place a subscriber is inserted, and the
          // organisation goes in with the account. `ownerColumns` takes a
          // *resolved* owner, so the customer branch has no shape in which the
          // organisation could be omitted; the anonymous branch has none to
          // carry (FR-011).
          ...ownerColumns(plan.owner),
        });
      }
      if (plan.owner.kind === 'customer' && !subscriber.customerAccountId) {
        // The adoption: a subscriber who signed up anonymously and has now
        // signed in. D-187 — the account and the organisation move together.
        em.assign(subscriber, ownerColumns(plan.owner));
      }

      // Activation policy: single opt-in (or already confirmed) → active now;
      // double opt-in → pending until the email link is followed.
      const wasActive = subscriber.status === 'active';
      if (plan.mode === 'single' || subscriber.confirmedAt) {
        subscriber.status = 'active';
        subscriber.consentAt ??= new Date();
        if (plan.mode === 'single') subscriber.confirmedAt ??= new Date();
      } else if (!wasActive) {
        subscriber.status = 'pending';
        subscriber.consentAt ??= new Date();
      }
      // An explicit re-subscribe lifts a prior self-unsubscribe suppression; a
      // bounce or complaint suppression stays.
      if (suppressed && subscriber.status === 'active' && suppressed.reason === 'unsubscribe') {
        em.remove(suppressed);
      }

      await mergeCustomFields(em, subscriber, plan.customFields);
      // The subscriber first: the tag bridge references it by a plain column,
      // so the unit of work has no relation to order the two inserts by.
      await em.flush();
      await mergeTags(em, subscriber.id, plan.tags);

      return {
        result: { subscriberId: subscriber.id, status: subscriber.status },
        // No address (#470, D-288): the subscriber is the customer's, and the
        // audit log is read without that reach. The entry names it by id.
        after: { status: subscriber.status, source: plan.source },
      };
    },
  };
}

async function mergeCustomFields(
  em: EntityManager,
  subscriber: NewsletterSubscriber,
  incoming: Readonly<Record<string, CustomFieldValue>> | undefined,
): Promise<void> {
  if (!incoming || Object.keys(incoming).length === 0) return;
  const defined = await em.find(NewsletterCustomField, {});
  subscriber.customFields = mergeTypedCustomFields(defined, subscriber.customFields, incoming);
}

async function mergeTags(em: EntityManager, subscriberId: string, codes: readonly string[] | undefined): Promise<void> {
  if (!codes || codes.length === 0) return;
  const tags = await em.find(NewsletterTag, { code: { $in: [...codes] } });
  for (const tag of tags) {
    const existing = await em.findOne(NewsletterSubscriberTag, { subscriberId, tagId: tag.id });
    if (!existing) em.create(NewsletterSubscriberTag, { subscriberId, tagId: tag.id });
  }
  await em.flush();
}
