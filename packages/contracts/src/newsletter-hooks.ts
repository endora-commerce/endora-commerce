// `newsletter`'s hookable actions — issue #1843, on the mechanism of
// `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md`).
//
// The subscriber writes a deployment may take part in through a command hook:
// a new address subscribing, a known address subscribing again, and a double
// opt-in confirmation. The action strings, the phases and the data types are a
// public contract: changing one is a changeset on `@endora-commerce/contracts`.

import { hookableAction } from './command-hooks.js';
import type { SubscriberStatus } from './newsletter.js';

/**
 * What a `beforeCommit` hook on a subscriber write is handed. **Ids and codes
 * only** (`specs/conventions/audit-state.md` list 1): never the e-mail address,
 * a confirmation or unsubscribe token, the source text or a custom-field value.
 * A hook that needs more re-reads the subscriber on `ctx.em`, where it sees the
 * **uncommitted** row.
 */
export interface NewsletterSubscriberHookData {
  readonly subscriberId: string;
  /** The status after the write. */
  readonly status: SubscriberStatus;
  /**
   * The status before the write; `null` for a new subscriber. Equal to
   * `status` when the write changed no status — a resubmitted sign-up of an
   * active subscriber, or a confirmation that found the subscriber no longer
   * pending.
   */
  readonly previousStatus: SubscriberStatus | null;
  readonly salesChannelId: string | null;
  /** The owning customer account, `null` for an anonymous subscriber. */
  readonly customerAccountId: string | null;
  /** The owning organisation, `null` exactly when `customerAccountId` is. */
  readonly organizationId: string | null;
  /** The subscriber's tag ids after the write, sorted. */
  readonly tagIds: readonly string[];
}

/** `afterCommit` data: the same ids and codes, stored in `command_outbox`. */
export type NewsletterSubscriberOutbox = {
  readonly subscriberId: string;
  readonly status: string;
  readonly previousStatus: string | null;
  readonly salesChannelId: string | null;
  readonly customerAccountId: string | null;
  /** Pins the handler's tenant context to the owning organisation; `null` for an anonymous subscriber. */
  readonly organizationId: string | null;
  readonly tagIds: readonly string[];
};

/**
 * The refs a hook author registers against
 * (`ctx.commandHooks([{ on: NEWSLETTER_HOOKABLE_ACTIONS.confirm, … }])`) and the
 * `newsletter` manifest lists. All three offer both phases; `afterCommit` is
 * delivered through the transactional outbox.
 *
 * - `subscribe` — an address with no subscriber signs up (storefront, Page
 *   Builder block, account page, or an operator adding one). Ends `active`
 *   under single opt-in, `pending` under double opt-in.
 * - `resubscribe` — an address that already has a subscriber signs up again;
 *   the same entry points.
 * - `confirm` — a `pending` subscriber follows the double opt-in link and
 *   becomes `active`.
 */
export const NEWSLETTER_HOOKABLE_ACTIONS = {
  subscribe: hookableAction<NewsletterSubscriberHookData, NewsletterSubscriberOutbox>(
    'newsletter.subscriber.subscribe',
    'newsletter_subscriber',
    ['beforeCommit', 'afterCommit'],
  ),
  resubscribe: hookableAction<NewsletterSubscriberHookData, NewsletterSubscriberOutbox>(
    'newsletter.subscriber.resubscribe',
    'newsletter_subscriber',
    ['beforeCommit', 'afterCommit'],
  ),
  confirm: hookableAction<NewsletterSubscriberHookData, NewsletterSubscriberOutbox>(
    'newsletter.subscriber.confirm',
    'newsletter_subscriber',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;
