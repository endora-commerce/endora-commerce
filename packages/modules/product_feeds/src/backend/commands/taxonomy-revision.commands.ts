import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  PRODUCT_FEED_ERROR_CODES,
  type FeedTaxonomyCheckTrigger,
  type TaxonomyProviderCode,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import type { TaxonomyReconcilerService } from '../services/taxonomy-reconciler.service.js';

/**
 * Taxonomy revision Commands — feature 067 / FR-095, FR-096, research §R26.
 *
 * Two writes, and only two, are the operator's rather than the machine's:
 *
 *  - **`product_feeds.taxonomy_revision.promote`** — the single write in this
 *    whole feature that changes what a feed emits. Everything else in the
 *    refresh path installs inactive by construction, which is why the automated
 *    check carries a `command-coverage-ignore` and this does not.
 *  - **`product_feeds.taxonomy_check.start`** — a manual check. It records *who
 *    asked for outbound traffic*, mirroring `product_feeds.run.start` exactly:
 *    the auditable part is the request, while the work is enqueued.
 *
 * Promotion is atomic: demote the current revision, activate the candidate,
 * re-evaluate every mapping for staleness and re-link templates, in **one**
 * transaction. Staleness is a property of the revision in force, so calling
 * `reevaluateMappings` here rather than at install time is also what makes
 * rollback work — promoting the previous revision restores the flags it had, by
 * the same route and with the same audit shape.
 */

function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

export interface PromoteTaxonomyRevisionResult {
  taxonomyId: string;
  providerCode: TaxonomyProviderCode;
  revision: string;
  previousRevision: string | null;
  markedStale: number;
  markedLive: number;
}

/** `409` — the operator's preview no longer matches reality (FR-095). */
export function impactChanged(expected: number, actual: number): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.PRODUCT_FEED_TAXONOMY_CONFLICT,
    'The impact of this revision changed while it was being reviewed.',
    {
      reason: PRODUCT_FEED_ERROR_CODES.IMPACT_CHANGED,
      expectedStaleMappingCount: expected,
      actualStaleMappingCount: actual,
    },
  );
}

/** `409` — somebody promoted it while the drawer was open. */
export function alreadyCurrent(revision: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.PRODUCT_FEED_TAXONOMY_CONFLICT,
    `Revision ${revision} is already in use.`,
    {
      reason: PRODUCT_FEED_ERROR_CODES.TAXONOMY_REVISION_ALREADY_CURRENT,
    },
  );
}

export function makePromoteTaxonomyRevisionCommand(args: {
  taxonomyId: string;
  expectedStaleMappingCount: number;
  /** Recomputed inside the transaction, so the acknowledgement is checked against reality. */
  countStaleAfter: (input: {
    providerCode: TaxonomyProviderCode;
    candidateTaxonomyId: string;
  }) => Promise<number>;
  reconciler: Pick<
    TaxonomyReconcilerService,
    'reevaluateMappings' | 'linkTemplatesToCurrentTaxonomies'
  >;
}): Command<PromoteTaxonomyRevisionResult> {
  return {
    action: 'product_feeds.taxonomy_revision.promote',
    objectType: 'product_feed_taxonomy',
    objectId: args.taxonomyId,

    capture: async ({ em }) => {
      const candidate = await em.findOne(FeedTaxonomy, { id: args.taxonomyId });
      if (!candidate) return null;
      const current = await em.findOne(FeedTaxonomy, {
        providerCode: candidate.providerCode,
        isCurrent: true,
      });
      return {
        providerCode: candidate.providerCode,
        revision: current?.revision ?? null,
        taxonomyId: current?.id ?? null,
        isCurrent: false,
      };
    },

    run: async ({ em }) => {
      const candidate = await em.findOne(FeedTaxonomy, { id: args.taxonomyId });
      if (!candidate) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Taxonomy revision not found.');
      }
      if (candidate.isCurrent) throw alreadyCurrent(candidate.revision);

      // The acknowledgement, recomputed server-side inside the transaction:
      // this is what makes "the operator saw the impact" a server-side fact
      // rather than a UI convention, and it catches the real case — a colleague
      // edited mappings while the preview sat open.
      const actualStale = await args.countStaleAfter({
        providerCode: candidate.providerCode,
        candidateTaxonomyId: candidate.id,
      });
      if (actualStale !== args.expectedStaleMappingCount) {
        throw impactChanged(args.expectedStaleMappingCount, actualStale);
      }

      const previous = await em.findOne(FeedTaxonomy, {
        providerCode: candidate.providerCode,
        isCurrent: true,
      });
      // Demote and activate are two statements on purpose. Batched into one
      // `UPDATE … CASE` MikroORM would let Postgres evaluate the partial unique
      // index `(provider_code) where is_current` against a transient state in
      // which both rows are current, and the promotion would fail on a
      // constraint that is doing exactly its job.
      if (previous) {
        previous.isCurrent = false;
        previous.supersededAt = new Date();
        await em.flush();
      }
      candidate.isCurrent = true;
      candidate.promotedAt = new Date();
      candidate.supersededAt = null;
      await em.flush();

      // Both on the transactional manager: demote, activate, re-evaluate and
      // re-link are one atomic step, or none of them (FR-095).
      const delta = await args.reconciler.reevaluateMappings(candidate.providerCode, em);
      await args.reconciler.linkTemplatesToCurrentTaxonomies(em);

      const result: PromoteTaxonomyRevisionResult = {
        taxonomyId: candidate.id,
        providerCode: candidate.providerCode,
        revision: candidate.revision,
        previousRevision: previous?.revision ?? null,
        markedStale: delta.markedStale,
        markedLive: delta.markedLive,
      };
      return {
        result,
        after: {
          providerCode: result.providerCode,
          revision: result.revision,
          taxonomyId: result.taxonomyId,
          isCurrent: true,
          // "What did that promotion cost", answerable without a database
          // session.
          markedStale: result.markedStale,
          markedLive: result.markedLive,
        },
      };
    },

    event: (result) => ({
      eventName: 'product_feeds.taxonomy_revision_promoted',
      payload: {
        ...envelope(),
        providerCode: result.providerCode,
        taxonomyId: result.taxonomyId,
        revision: result.revision,
      },
    }),
  };
}

export interface StartTaxonomyCheckResult {
  checkId: string;
  providerCode: TaxonomyProviderCode;
  trigger: FeedTaxonomyCheckTrigger;
}

/**
 * The manual trigger. The Command records the request; the check itself runs on
 * the worker (or inline where there is no queue), exactly as
 * `product_feeds.run.start` enqueues a generation rather than performing one.
 */
export function makeStartTaxonomyCheckCommand(args: {
  providerCode: TaxonomyProviderCode;
  /** Pre-generated so the audit row is addressable by the check it created. */
  checkId: string;
  /** Named for the call it makes: a bare `open` is too generic for a
   * port-carrying closure, and `check:port-catches` read every `.open(` in
   * this module as a call through it. */
  openCheck: () => Promise<{ id: string }>;
}): Command<StartTaxonomyCheckResult> {
  return {
    action: 'product_feeds.taxonomy_check.start',
    objectType: 'product_feed_taxonomy_check',
    objectId: args.checkId,
    run: async () => {
      const check = await args.openCheck();
      return {
        result: {
          checkId: check.id,
          providerCode: args.providerCode,
          trigger: 'manual' as const,
        },
        after: { providerCode: args.providerCode, trigger: 'manual', checkId: check.id },
      };
    },
  };
}
