import type { EntityManager } from '@mikro-orm/postgresql';
import { WebhookDelivery } from '../entities/webhook-delivery.entity.js';

/**
 * The retention window of `webhook_deliveries` (issue #928).
 *
 * A delivery row keeps the event's payload verbatim — a block event carries the
 * operator's reason, an order event the buyer's details — and the receiver's
 * response body beside it. Scrubbing the rows of one person on anonymisation
 * would mean reading every payload shape of every event type; the payloads are
 * a delivery log, so they get what a log gets instead: a retention window,
 * after which the row is deleted.
 */

/** The setting that holds the window, in whole days. Platform-wide. */
export const WEBHOOK_DELIVERY_RETENTION_SETTING = 'webhooks.delivery_retention_days';

/**
 * The default: 365 days, the default of `customers.deletion_retention_days`.
 * A delivery about an account is written while the account is live, so by the
 * time the customers sweep anonymises it (365 days after its deletion, by
 * default) every delivery written before the deletion is already past this
 * window.
 */
export const WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS = 365;

/** The range a stored value is held to; outside it the default applies. */
export const WEBHOOK_DELIVERY_RETENTION_MIN_DAYS = 1;
export const WEBHOOK_DELIVERY_RETENTION_MAX_DAYS = 3650;

/**
 * The window a stored value means. Anything but a whole number of days inside
 * the range is read as the default, so a mistyped `0` can never empty the
 * delivery history in one tick.
 */
export function retentionDaysFrom(value: unknown): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= WEBHOOK_DELIVERY_RETENTION_MIN_DAYS &&
    value <= WEBHOOK_DELIVERY_RETENTION_MAX_DAYS
  ) {
    return value;
  }
  return WEBHOOK_DELIVERY_RETENTION_DEFAULT_DAYS;
}

/**
 * The statuses a row can be deleted in. A `pending` row is a replay the queue
 * has not taken yet and an `in_flight` one is being delivered; neither is
 * history, so neither is ever deleted however old it is.
 */
export const WEBHOOK_DELIVERY_PURGEABLE_STATUSES = ['succeeded', 'failed', 'dead_lettered'] as const;

/** The instant before which a delivery row is past the window. */
export function deliveryRetentionCutoff(retentionDays: number, now: Date): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export class WebhookDeliveryRetentionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Reads {@link WEBHOOK_DELIVERY_RETENTION_SETTING}; already normalised. */
    private readonly resolveRetentionDays: () => Promise<number>,
  ) {}

  /**
   * Deletes every finished delivery row created before the window, and answers
   * how many it deleted. One statement: the table is `@GlobalEntity()`, so no
   * tenant scope is entered and no probe is needed before it.
   */
  async purge(now: Date = new Date()): Promise<{ retentionDays: number; deleted: number }> {
    const retentionDays = await this.resolveRetentionDays();
    // command-coverage-ignore: the retention window of a delivery log — no
    // domain state, nothing to undo; the subscription writes are audited where
    // they happen.
    const deleted = await this.emFactory().nativeDelete(WebhookDelivery, {
      createdAt: { $lt: deliveryRetentionCutoff(retentionDays, now) },
      status: { $in: [...WEBHOOK_DELIVERY_PURGEABLE_STATUSES] },
    });
    return { retentionDays, deleted };
  }
}
