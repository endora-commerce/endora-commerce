import type { EntityManager } from '@mikro-orm/postgresql';
import type { FeedRunFailureCode } from '@b2b/contracts';
import { effectiveState } from '../../../kernel/lifecycle/effective-state.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { FeedRun } from '../entities/feed-run.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';

/**
 * Failed-run notification — feature 067 / FR-056,
 * `contracts/admin-runs.md` §5.
 *
 * A feed that stops working is invisible: the storefront is fine, the admin is
 * fine, and the only symptom is a provider quietly disapproving products a week
 * later. So a run reaching `failed` records an entry on the platform's own
 * admin notification surface, carrying the feed name, the failure code and a
 * deep link to the run.
 *
 * ## Why this is not one notification per failed run
 *
 * A feed on `*​/15 * * * *` whose channel was deleted fails ninety-six times a
 * day, forever. Ninety-six identical notifications is not ninety-six times the
 * information — it is a bell nobody looks at any more, which costs the operator
 * every *other* notification too.
 *
 * So the rule is **notify on the transition, not on the state**: an entry is
 * written only when the previous terminal run of the same feed was not already
 * failed with the same code. A feed that recovers and breaks again notifies
 * again; a feed that breaks in a *new* way notifies again, because that is new
 * information. A feed that keeps breaking the same way says so once.
 *
 * Deliberately not audited (contract §5): the run row is the record, and there
 * is no acting administrator to attribute a machine transition to.
 */

/** One entry on the platform's admin notification surface. */
export interface AdminNotificationInput {
  audience: 'all_admins' | 'admin_user';
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

/**
 * `admin_notifications`' port, as this module reaches it.
 *
 * Resolving it asks a gate, so it either records or throws — it has no way of
 * answering "the operator switched the bell off", which is why the degrade
 * cannot live here (D-61's rejected alternative).
 */
export interface AdminNotificationPort {
  record(input: AdminNotificationInput): Promise<unknown>;
}

/**
 * What this module actually holds — the degrade in the return type (D-60).
 *
 * `not-present` is the operator having switched `admin_notifications` off, and
 * it is an **answer**: composed by {@link presenceAwareRecorder} before the port
 * is reached, so no caller has to catch a presence question. It exists because
 * the three notifiers in this tree used to report `false` for both "the bell is
 * off" and "the write failed", and an operator reading a run that says
 * "not notified" cannot tell those apart — the first is their own choice and
 * the second is a defect.
 */
export type AdminNotificationOutcome = 'recorded' | 'not-present';

export interface AdminNotificationRecorder {
  record(input: AdminNotificationInput): Promise<AdminNotificationOutcome>;
}

/**
 * Wraps the gated port in the presence decision, so absence is *decided* rather
 * than caught (D-60; Constitution XVII).
 *
 * A function rather than an object literal at the composition site on purpose:
 * `check-port-catches.ts` follows the port **through the value**, and an object
 * literal is where that trail deliberately stops. Written this way the gate
 * stays visible to the check, so a `catch` further down still has to say what
 * it does with `ModuleDisabledError`.
 */
export function presenceAwareRecorder(
  adminNotifications: AdminNotificationPort,
): AdminNotificationRecorder {
  return {
    async record(input: AdminNotificationInput): Promise<AdminNotificationOutcome> {
      // First, and outside any `try`: a closed gate throws rather than
      // answering, so asking after the call is asking too late.
      if (!effectiveState.isPresent('admin_notifications')) return 'not-present';
      await adminNotifications.record(input);
      return 'recorded';
    },
  };
}

export interface FailedRunNotifierDeps {
  emFactory: () => EntityManager;
  notifications: AdminNotificationRecorder;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

/** The `kind` the bell groups these under. */
export const FEED_RUN_FAILED_NOTIFICATION_KIND = 'product_feed.run_failed';

/**
 * FR-093 — the one taxonomy-check failure that cannot self-heal: the provider
 * moved the file, so every future check will fail identically until somebody
 * edits the source URL.
 */
export const TAXONOMY_NOT_FOUND_NOTIFICATION_KIND = 'product_feed.taxonomy_not_found';

/** Feature 070 / AS-3 — a delivery that used up its attempts and stopped. */
export const FEED_DELIVERY_EXHAUSTED_NOTIFICATION_KIND = 'product_feed.delivery_exhausted';

export class FailedRunNotifier {
  constructor(private readonly deps: FailedRunNotifierDeps) {}

  /**
   * Records the notification for a run that has just reached `failed`.
   *
   * Never throws: a notification that cannot be written must not turn a
   * recorded failure into an unrecorded crash. Returns whether an entry was
   * written — and since D-60 that `false` no longer hides an operator's choice:
   * `admin_notifications` being off is answered by the recorder's return type,
   * before the port is reached, so the only thing left for the `catch` is a
   * genuine failure.
   */
  async notify(input: {
    feedId: string;
    runId: string;
    failureCode: FeedRunFailureCode | null;
    failureDetail: string | null;
  }): Promise<boolean> {
    try {
      const em = this.deps.emFactory();
      const feed = await em.findOne(ProductFeed, { id: input.feedId });
      if (!feed) return false;

      if (await this.alreadyReported(em, input)) return false;

      const outcome = await this.deps.notifications.record({
        audience: 'all_admins',
        kind: FEED_RUN_FAILED_NOTIFICATION_KIND,
        subjectType: 'product_feed',
        subjectId: input.feedId,
        title: `Product feed "${feed.name}" failed to generate`,
        body: input.failureDetail
          ? `${input.failureCode ?? 'internal_error'}: ${input.failureDetail}`
          : (input.failureCode ?? 'internal_error'),
        // A deep link to the run, not to the feed: the operator needs the
        // counters and the reason, which only the run detail carries.
        linkPath: `/product-feeds/${input.feedId}/runs/${input.runId}`,
      });
      return outcome === 'recorded';
    } catch (err) {
      // Narrow, and correct: what stays here is a failed write of the entry —
      // a broken database connection, not a switched-off module, which the
      // recorder answered before the call.
      rethrowIfModuleDisabled(err);
      this.deps.logWarn?.('product_feeds: failed-run notification could not be recorded', {
        productFeedId: input.feedId,
        feedRunId: input.runId,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Feature 070 / AS-3 — a delivery that exhausted its bounded attempts.
   *
   * Reuses this class's transition discipline for the same reason the taxonomy
   * notification does: a feed on a fifteen-minute schedule whose partner
   * decommissioned their SFTP host would otherwise ring the bell ninety-six
   * times a day about a fact that has not changed. An entry is written only when
   * the previous *non-test* attempt was not already a failure — a delivery that
   * recovers and breaks again notifies again, because that is new information.
   *
   * The body says the published file is unaffected, because it is: the pull URL
   * kept serving throughout, and an operator who reads "delivery failed" without
   * that sentence will treat a partner integration problem as an outage.
   */
  async notifyDeliveryExhausted(input: {
    feedId: string;
    runId: string | null;
    failureReason: string | null;
    failureDetail: string | null;
  }): Promise<boolean> {
    try {
      const em = this.deps.emFactory();
      const feed = await em.findOne(ProductFeed, { id: input.feedId });
      if (!feed) return false;
      if (await this.deliveryAlreadyReported(em, input.feedId)) return false;

      const outcome = await this.deps.notifications.record({
        audience: 'all_admins',
        kind: FEED_DELIVERY_EXHAUSTED_NOTIFICATION_KIND,
        subjectType: 'product_feed',
        subjectId: input.feedId,
        title: `Product feed "${feed.name}" could not be delivered`,
        body: `${input.failureDetail ?? input.failureReason ?? 'The delivery failed.'} The generated file is published and its link keeps working; only the push to the configured server failed.`,
        linkPath: `/product-feeds/${input.feedId}`,
      });
      return outcome === 'recorded';
    } catch (err) {
      // See `notify` above: presence is decided by the recorder, so this is a
      // failed write and nothing else.
      rethrowIfModuleDisabled(err);
      this.deps.logWarn?.('product_feeds: delivery notification could not be recorded', {
        productFeedId: input.feedId,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * True when the delivery attempt before the one that just exhausted had
   * already failed — the same "notify on the transition" rule, read off the
   * attempt history. Test attempts are excluded: an operator pressing "Test
   * Connection" is not evidence about whether scheduled delivery works.
   */
  private async deliveryAlreadyReported(em: EntityManager, feedId: string): Promise<boolean> {
    const rows = (await em.getConnection().execute(
      `select "status" from "product_feed_delivery_attempts"
        where "product_feed_id" = ? and "is_test" = false
        order by "started_at" desc, "id" desc
        limit 2`,
      [feedId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ status: string }>;
    // rows[0] is the attempt that just failed; rows[1] is the state before it.
    return rows[1]?.status === 'failed';
  }

  /**
   * FR-093 — a taxonomy check that failed `not_found`.
   *
   * Reuses this class's transition discipline rather than adding a second
   * notifier, because it is the same problem: a weekly check against a moved
   * URL fails forever, and one notification a week about a fact that has not
   * changed is a bell nobody looks at any more.
   *
   * **Only `not_found` notifies.** A transport failure on an installation whose
   * egress was closed after the switch was turned on is not something the
   * operator can act on from the notification itself, and the checks list
   * already shows it. `not_found` is different: it names a setting somebody has
   * to edit, and no amount of waiting fixes it.
   */
  async notifyTaxonomyNotFound(input: {
    providerCode: string;
    checkId: string;
    detail: string;
  }): Promise<boolean> {
    try {
      const em = this.deps.emFactory();
      if (await this.taxonomyAlreadyReported(em, input)) return false;

      const outcome = await this.deps.notifications.record({
        audience: 'all_admins',
        kind: TAXONOMY_NOT_FOUND_NOTIFICATION_KIND,
        subjectType: 'product_feed_taxonomy',
        subjectId: input.providerCode,
        title: `The ${input.providerCode} category list is no longer published at the configured address`,
        // The operator needs to know two things: which setting to change, and
        // that their feeds are fine. Both are in the line.
        body: `${input.detail} Your feeds are unaffected and keep using the category list already installed. Update the source address in Settings → Taxonomy updates.`,
        linkPath: '/product-feeds/taxonomy-revisions',
      });
      return outcome === 'recorded';
    } catch (err) {
      // See `notify` above: presence is decided by the recorder, so this is a
      // failed write and nothing else.
      rethrowIfModuleDisabled(err);
      this.deps.logWarn?.('product_feeds: taxonomy not-found notification could not be recorded', {
        providerCode: input.providerCode,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * True when the previous finished check for this provider already failed
   * `not_found` — the same "notify on the transition" rule, read off the check
   * history rather than off a counter that could disagree with it.
   */
  private async taxonomyAlreadyReported(
    em: EntityManager,
    input: { providerCode: string; checkId: string },
  ): Promise<boolean> {
    const rows = (await em.getConnection().execute(
      `select "reason" from "product_feed_taxonomy_checks"
        where "provider_code" = ? and "id" <> ? and "finished_at" is not null
        order by "started_at" desc, "id" desc
        limit 1`,
      [input.providerCode, input.checkId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ reason: string | null }>;
    return rows[0]?.reason === 'not_found';
  }

  /**
   * True when the previous terminal run of this feed already failed the same
   * way — the "notify on the transition" rule.
   *
   * `skipped` runs are excluded from the comparison on purpose: a tick that
   * collided with a running generation is not evidence about whether the feed
   * works, so a failure either side of one is still the same failure.
   */
  private async alreadyReported(
    em: EntityManager,
    input: { feedId: string; runId: string; failureCode: FeedRunFailureCode | null },
  ): Promise<boolean> {
    const previous = await em.find(
      FeedRun,
      {
        productFeedId: input.feedId,
        id: { $ne: input.runId },
        status: { $in: ['completed', 'completed_with_warnings', 'empty', 'failed'] },
      },
      { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 1 },
    );
    const last = previous[0];
    if (!last) return false;
    return last.status === 'failed' && (last.failureCode ?? null) === (input.failureCode ?? null);
  }
}
