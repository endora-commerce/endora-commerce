import type { EntityManager } from '@mikro-orm/postgresql';
import type { FeedRunFailureCode } from '@b2b/contracts';
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

export interface AdminNotificationRecorder {
  record(input: {
    audience: 'all_admins' | 'admin_user';
    kind: string;
    subjectType?: string | null;
    subjectId?: string | null;
    title: string;
    body?: string | null;
    linkPath?: string | null;
  }): Promise<unknown>;
}

export interface FailedRunNotifierDeps {
  emFactory: () => EntityManager;
  notifications: AdminNotificationRecorder;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

/** The `kind` the bell groups these under. */
export const FEED_RUN_FAILED_NOTIFICATION_KIND = 'product_feed.run_failed';

export class FailedRunNotifier {
  constructor(private readonly deps: FailedRunNotifierDeps) {}

  /**
   * Records the notification for a run that has just reached `failed`.
   *
   * Never throws: a notification that cannot be written must not turn a
   * recorded failure into an unrecorded crash.
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

      await this.deps.notifications.record({
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
      return true;
    } catch (err) {
      this.deps.logWarn?.('product_feeds: failed-run notification could not be recorded', {
        productFeedId: input.feedId,
        feedRunId: input.runId,
        error: String(err),
      });
      return false;
    }
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
