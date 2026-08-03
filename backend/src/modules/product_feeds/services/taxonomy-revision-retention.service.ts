import type { EntityManager } from '@mikro-orm/postgresql';
import type { TaxonomyProviderCode } from '@b2b/contracts';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';

/**
 * Bounded revision history — feature 067 / FR-097, data-model §8.
 *
 * Keeps the newest `product_feeds.taxonomy_revision_retention_count` revisions
 * per provider, run at the end of an installing check. Node rows cascade on the
 * revision's delete, so a purge is one statement.
 *
 * Three classes are **never** eligible, whatever the count is set to:
 *
 *  1. the revision in force (`is_current`);
 *  2. the newest revision with `promoted_at is null` — the candidate the
 *     operator has not decided about yet;
 *  3. the newest revision still containing a node that a surviving mapping row
 *     points at.
 *
 * Rule 3 is the one worth explaining. A mapping stores a provider node id and
 * no revision reference — deliberately, because FR-085 makes a mapping survive
 * revision installs. A **stale** mapping therefore points at a node the current
 * revision no longer has, and the only place its human-readable path still
 * exists is the older revision it was chosen from. Purging that revision turns
 * the stale review list into a list of bare numeric ids, at precisely the
 * moment the operator most needs to read a path.
 */

/** A misconfigured `0` must not purge everything, like the artefact sweep. */
const MIN_RETAIN = 1;

export interface RetentionCandidate {
  id: string;
  isCurrent: boolean;
  /** Null ⇒ never in force — the "pending candidate" predicate. */
  promotedAt: Date | null;
  installedAt: Date;
  /** Rule 3: this is the newest revision holding some node a mapping points at. */
  isNewestHolderOfMappedNode: boolean;
}

/**
 * Pure, so the rules above are directly testable and the SQL below only has to
 * be right about *reading* the facts, not about deciding on them.
 */
export function selectPurgeableRevisions(
  rows: readonly RetentionCandidate[],
  retainCount: number,
): string[] {
  const retain = Math.max(MIN_RETAIN, Math.floor(retainCount));
  const newestFirst = [...rows].sort(
    (a, b) => b.installedAt.getTime() - a.installedAt.getTime() || a.id.localeCompare(b.id),
  );

  const protectedIds = new Set<string>();
  for (const row of newestFirst.slice(0, retain)) protectedIds.add(row.id);
  for (const row of newestFirst) {
    if (row.isCurrent) protectedIds.add(row.id);
    if (row.isNewestHolderOfMappedNode) protectedIds.add(row.id);
  }
  const pending = newestFirst.find((row) => row.promotedAt === null);
  if (pending) protectedIds.add(pending.id);

  return newestFirst.filter((row) => !protectedIds.has(row.id)).map((row) => row.id);
}

export interface TaxonomyRevisionRetentionDeps {
  emFactory: () => EntityManager;
  retentionCount: () => Promise<number>;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

export class TaxonomyRevisionRetentionService {
  constructor(private readonly deps: TaxonomyRevisionRetentionDeps) {}

  /**
   * Purges superseded revisions for one provider. Never throws: this runs at
   * the tail of a check that has already succeeded, and a failed sweep must not
   * turn a successful install into a failure.
   */
  async enforce(providerCode: TaxonomyProviderCode): Promise<number> {
    // command-coverage-ignore: bounded history maintenance, like artefact
    // retention. No actor, no request, and nothing an operator could undo —
    // the revision it removes was never in force and is not the pending
    // candidate. The decisions ABOUT a revision (promotion) are Commands.
    try {
      const retain = await this.deps.retentionCount();
      const candidates = await this.loadCandidates(providerCode);
      const purgeable = selectPurgeableRevisions(candidates, retain);
      if (purgeable.length === 0) return 0;

      const em = this.deps.emFactory();
      await em.nativeDelete(FeedTaxonomy, { id: { $in: purgeable } });
      return purgeable.length;
    } catch (err) {
      this.deps.logWarn?.('product_feeds: taxonomy revision retention failed', {
        providerCode,
        error: String(err),
      });
      return 0;
    }
  }

  private async loadCandidates(
    providerCode: TaxonomyProviderCode,
  ): Promise<RetentionCandidate[]> {
    const em = this.deps.emFactory();
    // One statement per fact: the revisions, and the set of revisions that are
    // the newest holder of a node some surviving mapping points at. Reading
    // rule 3 in SQL keeps it O(mappings) rather than O(revisions × nodes).
    const rows = (await em.getConnection().execute(
      `select t."id", t."is_current", t."promoted_at", t."installed_at"
         from "product_feed_taxonomies" t
        where t."provider_code" = ?
        order by t."installed_at" desc`,
      [providerCode],
      'all',
      em.getTransactionContext(),
    )) as Array<{
      id: string;
      is_current: boolean;
      promoted_at: string | Date | null;
      installed_at: string | Date;
    }>;

    const holders = (await em.getConnection().execute(
      `select distinct on (m."node_external_id") t."id"
         from "product_feed_taxonomy_mappings" m
         join "product_feed_taxonomy_nodes" n on n."external_id" = m."node_external_id"
         join "product_feed_taxonomies" t on t."id" = n."taxonomy_id"
        where m."taxonomy_provider_code" = ? and t."provider_code" = ?
        order by m."node_external_id", t."installed_at" desc`,
      [providerCode, providerCode],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;
    const holderIds = new Set(holders.map((row) => row.id));

    return rows.map((row) => ({
      id: row.id,
      isCurrent: Boolean(row.is_current),
      promotedAt: row.promoted_at === null ? null : new Date(row.promoted_at),
      installedAt: new Date(row.installed_at),
      isNewestHolderOfMappedNode: holderIds.has(row.id),
    }));
  }
}
