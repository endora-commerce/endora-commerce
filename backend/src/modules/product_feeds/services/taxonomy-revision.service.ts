import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_FEED_ERROR_CODES,
  TAXONOMY_FETCH_LIMITS,
  type FeedTaxonomyCheck as FeedTaxonomyCheckDto,
  type FeedTaxonomyRevision as FeedTaxonomyRevisionDto,
  type CatalogCategoryReadPort,
  type TaxonomyProviderCode,
} from '@endora-commerce/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import { FeedTaxonomyCheck } from '../entities/feed-taxonomy-check.entity.js';
import { FeedTaxonomyMapping } from '../entities/feed-taxonomy-mapping.entity.js';
import { FeedTaxonomyNode } from '../entities/feed-taxonomy-node.entity.js';
import {
  makePromoteTaxonomyRevisionCommand,
  makeStartTaxonomyCheckCommand,
  type PromoteTaxonomyRevisionResult,
} from '../commands/taxonomy-revision.commands.js';
import { localized } from './taxonomy-mapping.service.js';
import type { TaxonomyCategoryNode } from './taxonomy-mapping-resolver.js';
import {
  computeTaxonomyRevisionImpact,
  type TaxonomyRevisionImpact,
} from './taxonomy-revision-impact.js';
import type { TaxonomyReconcilerService } from './taxonomy-reconciler.service.js';
import type { TaxonomyRefreshService } from './taxonomy-refresh.service.js';

/**
 * The revisions surface — feature 067 / FR-078, FR-094 – FR-096.
 *
 * Reads for the revisions list, the impact preview and the check history, plus
 * the two operator writes, which both go through the Command Bus.
 *
 * The impact preview holds **no transaction and performs no writes** (FR-094):
 * it loads the two node sets, the category tree and the mapping rows, and hands
 * them to the pure `computeTaxonomyRevisionImpact`. The promote Command then
 * recomputes the same figure inside its transaction, from the same function, so
 * the acknowledgement cannot be satisfied by a number the preview never showed.
 */

export interface TaxonomyRevisionServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /**
   * Feature 075, Phase C — the category tree a revision's impact is measured
   * against, read over `catalog`'s published port instead of out of its table.
   */
  catalogCategories: CatalogCategoryReadPort;
  reconciler: Pick<
    TaxonomyReconcilerService,
    'reevaluateMappings' | 'linkTemplatesToCurrentTaxonomies'
  >;
  refresh: Pick<TaxonomyRefreshService, 'openCheck' | 'isCheckInFlight'>;
  /** True when `product_feeds.taxonomy_fetch_enabled` is on (FR-087). */
  fetchEnabled: () => Promise<boolean>;
  /**
   * Hands the opened check to the worker. With no queue this is a no-op and the
   * check stays `queued` until a worker process picks the provider up on its
   * next tick — the same shape a producer-only API process has for generation.
   */
  enqueueCheck?: (input: { providerCode: TaxonomyProviderCode; checkId: string }) => Promise<void>;
}

export interface TaxonomyRevisionImpactView extends TaxonomyRevisionImpact {
  providerCode: TaxonomyProviderCode;
  candidateRevision: string;
  currentRevision: string | null;
}

export class TaxonomyRevisionService {
  constructor(private readonly deps: TaxonomyRevisionServiceDeps) {}

  /** Every retained revision of a provider, current and inactive (FR-078). */
  async listRevisions(
    providerCode: TaxonomyProviderCode,
  ): Promise<FeedTaxonomyRevisionDto[]> {
    const rows = await this.deps
      .emFactory()
      .find(
        FeedTaxonomy,
        { providerCode },
        { orderBy: { installedAt: 'desc', id: 'desc' } },
      );
    return rows.map((row) => toRevisionDto(row));
  }

  async listChecks(
    providerCode: TaxonomyProviderCode,
    limit: number = TAXONOMY_FETCH_LIMITS.CHECK_HISTORY_PER_PROVIDER,
  ): Promise<FeedTaxonomyCheckDto[]> {
    const rows = await this.deps.emFactory().find(
      FeedTaxonomyCheck,
      { providerCode },
      {
        orderBy: { startedAt: 'desc', id: 'desc' },
        limit: Math.min(Math.max(limit, 1), TAXONOMY_FETCH_LIMITS.CHECK_HISTORY_PER_PROVIDER),
      },
    );
    return rows.map((row) => toCheckDto(row));
  }

  /** Read-only. Zero writes, no transaction held open beyond its own reads. */
  async impact(taxonomyId: string, language: string): Promise<TaxonomyRevisionImpactView> {
    const em = this.deps.emFactory();
    const candidate = await em.findOne(FeedTaxonomy, { id: taxonomyId });
    if (!candidate) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Taxonomy revision not found.');
    }
    const current = await em.findOne(FeedTaxonomy, {
      providerCode: candidate.providerCode,
      isCurrent: true,
    });

    const impact = computeTaxonomyRevisionImpact(
      await this.impactInput(em, candidate, current, language),
    );

    return {
      ...impact,
      providerCode: candidate.providerCode,
      candidateRevision: candidate.revision,
      // A revision that is already the one in force compares against itself,
      // which is what makes the read-only "this is what your feeds use now"
      // drawer render the same numbers as any other row.
      currentRevision: current && current.id !== candidate.id ? current.revision : null,
    };
  }

  /**
   * FR-095. Atomic, audited, and refused when the acknowledgement no longer
   * matches the recomputed impact.
   */
  async promote(input: {
    taxonomyId: string;
    expectedStaleMappingCount: number;
  }): Promise<PromoteTaxonomyRevisionResult> {
    return this.deps.commandBus.run(
      makePromoteTaxonomyRevisionCommand({
        taxonomyId: input.taxonomyId,
        expectedStaleMappingCount: input.expectedStaleMappingCount,
        reconciler: this.deps.reconciler,
        countStaleAfter: async ({ candidateTaxonomyId }) => {
          const em = this.deps.emFactory();
          const candidate = await em.findOne(FeedTaxonomy, { id: candidateTaxonomyId });
          if (!candidate) return 0;
          const current = await em.findOne(FeedTaxonomy, {
            providerCode: candidate.providerCode,
            isCurrent: true,
          });
          // The same pure function the preview used: the acknowledgement is
          // checked against the figure the operator was actually shown, not
          // against a second implementation of "roughly that".
          return computeTaxonomyRevisionImpact(
            await this.impactInput(em, candidate, current, 'en'),
          ).mappings.wouldBecomeStale;
        },
      }),
    );
  }

  /**
   * FR-096. Refused while the mechanism is off — an air-gapped installation's
   * guarantee is "no outbound request from this module", and a manual escape
   * hatch would void it — and while a check for that provider is in flight.
   */
  async startCheck(providerCode: TaxonomyProviderCode): Promise<FeedTaxonomyCheckDto> {
    if (!(await this.deps.fetchEnabled())) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_FEED_TAXONOMY_CONFLICT,
        'Automatic taxonomy checks are switched off, so no request will be made. Turn on "Check for new taxonomy revisions" in Settings first.',
        { reason: PRODUCT_FEED_ERROR_CODES.TAXONOMY_FETCH_DISABLED },
      );
    }
    if (await this.deps.refresh.isCheckInFlight(providerCode)) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_FEED_TAXONOMY_CONFLICT,
        `A taxonomy check for ${providerCode} is already running.`,
        { reason: PRODUCT_FEED_ERROR_CODES.TAXONOMY_CHECK_IN_PROGRESS },
      );
    }

    // Pre-generated so the audit entry is addressable by the check it created —
    // the fix Phase 8 note 4 recorded for the import Command, applied here from
    // the start.
    const checkId = randomUUID();
    const started = await this.deps.commandBus.run(
      makeStartTaxonomyCheckCommand({
        providerCode,
        checkId,
        open: () => this.deps.refresh.openCheck({ providerCode, trigger: 'manual', id: checkId }),
      }),
    );
    await this.deps.enqueueCheck?.({ providerCode, checkId: started.checkId });

    const row = await this.deps.emFactory().findOne(FeedTaxonomyCheck, { id: started.checkId });
    if (!row) {
      throw new HttpError(500, ERROR_CODES.INTERNAL, 'The check could not be started.');
    }
    return toCheckDto(row);
  }

  /** Loads exactly what the pure impact function needs, and nothing else. */
  private async impactInput(
    em: EntityManager,
    candidate: FeedTaxonomy,
    current: FeedTaxonomy | null,
    language: string,
  ): Promise<Parameters<typeof computeTaxonomyRevisionImpact>[0]> {
    const [categories, mappings, candidateNodes, currentNodes] = await Promise.all([
      this.deps.catalogCategories.listAll({ liveOnly: true }),
      em.find(FeedTaxonomyMapping, { taxonomyProviderCode: candidate.providerCode }),
      em.find(FeedTaxonomyNode, { taxonomyId: candidate.id }),
      current ? em.find(FeedTaxonomyNode, { taxonomyId: current.id }) : Promise.resolve([]),
    ]);

    const categoriesById = new Map<string, TaxonomyCategoryNode>(
      categories.map((category) => [
        category.id,
        {
          id: category.id,
          parentCategoryId: category.parentCategoryId ?? null,
          sortOrder: category.sortOrder,
        },
      ]),
    );

    return {
      categoriesById,
      categoryNames: new Map(
        categories.map((category) => [
          category.id,
          localized(category.name as Record<string, string>, language),
        ]),
      ),
      mappings: mappings.map((mapping) => ({
        categoryId: mapping.categoryId,
        nodeExternalId: mapping.nodeExternalId,
      })),
      currentNodeIds: new Set(currentNodes.map((node) => node.externalId)),
      candidateNodeIds: new Set(candidateNodes.map((node) => node.externalId)),
      nodePathsInCurrent: new Map(
        currentNodes.map((node) => [node.externalId, localized(node.fullPath, language)]),
      ),
    };
  }
}

export function toRevisionDto(row: FeedTaxonomy): FeedTaxonomyRevisionDto {
  return {
    id: row.id,
    providerCode: row.providerCode,
    revision: row.revision,
    isCurrent: row.isCurrent,
    nodeCount: row.nodeCount,
    source: row.source ?? 'bundled',
    sourceUrls: row.sourceUrls ?? {},
    installedAt: row.installedAt.toISOString(),
    fetchedAt: row.fetchedAt ? row.fetchedAt.toISOString() : null,
    promotedAt: row.promotedAt ? row.promotedAt.toISOString() : null,
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
    flags: row.flags ?? [],
  };
}

export function toCheckDto(row: FeedTaxonomyCheck): FeedTaxonomyCheckDto {
  return {
    id: row.id,
    providerCode: row.providerCode,
    trigger: row.trigger,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    // MikroORM leaves a null column's property unset on a hydrated entity, so
    // every nullable field is normalised here rather than shipped as
    // `undefined` — which a Zod `.nullable()` refuses, and which JSON drops.
    outcome: row.outcome ?? null,
    reason: row.reason ?? null,
    detail: row.detail ?? null,
    httpStatus: row.httpStatus ?? null,
    bytesRead: row.bytesRead ?? null,
    contentHash: row.contentHash ?? null,
    installedTaxonomyId: row.installedTaxonomyId ?? null,
  };
}
