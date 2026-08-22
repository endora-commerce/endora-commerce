import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type {
  FeedTaxonomyRevisionFlag,
  FeedTaxonomyRevisionSource,
  TaxonomyProviderCode,
} from '@endora-commerce/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedTaxonomy — feature 067 / data-model.md §8.
 *
 * One provider taxonomy at one revision. A revision reaches this table by
 * exactly two routes, and both produce the same kind of row (FR-078):
 *
 *  - **bundled** — files that ship inside the module
 *    (`data/taxonomies/<provider>/<revision>/{en,pl}.txt`), loaded by the
 *    lifecycle reconciler at boot;
 *  - **fetched** — an optional, off-by-default periodic check downloads the
 *    provider's published files (`services/taxonomy-refresh.service.ts`).
 *
 * **`isCurrent` is the single selector of the revision in force, and the fetch
 * path never writes it `true`** (FR-086). A fetched revision lands inactive: it
 * changes no feed's output, no mapping's stale flag and no template link until
 * an operator promotes it through `product_feeds.taxonomy_revision.promote`.
 * That is what keeps FR-077's guarantee intact — generation reads this table
 * and contacts nobody, so a provider that is down, slow or serving nonsense
 * produces a failed *check*, never a failed or altered *run*.
 *
 * Tenancy: `@GlobalEntity()` — reference data, no tenant dimension.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_taxonomies' })
export class FeedTaxonomy {
  [OptionalProps]?:
    | 'id'
    | 'isCurrent'
    | 'nodeCount'
    | 'installedAt'
    | 'createdAt'
    | 'source'
    | 'sourceUrls'
    | 'sourceContentHash'
    | 'sourceEtag'
    | 'fetchedAt'
    | 'promotedAt'
    | 'supersededAt'
    | 'flags';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'varchar', length: 32, fieldName: 'provider_code' })
  @Index()
  providerCode!: TaxonomyProviderCode;

  /**
   * The provider's own published revision label where there is one (Google
   * stamps `# Google_Product_Taxonomy_Version:` in the file); otherwise a
   * derived `YYYY-MM-DD-<hash8>` label (Meta publishes none) — FR-088.
   */
  @Property({ type: 'varchar', length: 32, fieldName: 'revision' })
  revision!: string;

  /** Exactly one per `providerCode`, enforced by a partial unique index. */
  @Property({ type: 'boolean', fieldName: 'is_current' })
  isCurrent: boolean = false;

  @Property({ type: 'integer', fieldName: 'node_count' })
  nodeCount: number = 0;

  /** Shown in the admin so an operator can see which revision they are mapping against (FR-078). */
  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'installed_at' })
  installedAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  /** Where the row came from (FR-078). Existing rows were backfilled `bundled`. */
  @Property({ type: 'varchar', length: 16, fieldName: 'source' })
  source: FeedTaxonomyRevisionSource = 'bundled';

  /** Per-language source URL map; empty for a bundled revision (FR-098 provenance). */
  @Property({ type: 'json', fieldName: 'source_urls' })
  sourceUrls: Record<string, string> = {};

  /**
   * `sha256("<en-hash>:<pl-hash>")` over BOM/newline-normalised bytes — the
   * cheap "same file again" gate (FR-088). Partially unique per provider, so
   * "we already have these bytes" is a database fact rather than a race.
   */
  @Property({ type: 'varchar', length: 64, nullable: true, fieldName: 'source_content_hash' })
  sourceContentHash: string | null = null;

  /**
   * The last `ETag` seen, replayed as `If-None-Match`. A bandwidth optimisation
   * only: a CDN owns this header, so identity is never allowed to rest on it.
   */
  @Property({ type: 'varchar', length: 255, nullable: true, fieldName: 'source_etag' })
  sourceEtag: string | null = null;

  /** When the bytes were retrieved; null for a bundled revision. */
  @Property({ type: 'datetime', nullable: true, fieldName: 'fetched_at' })
  fetchedAt: Date | null = null;

  /**
   * When an operator made it current. Null ⇒ never in force, which is also the
   * "pending candidate" predicate retention refuses to purge (FR-097).
   */
  @Property({ type: 'datetime', nullable: true, fieldName: 'promoted_at' })
  promotedAt: Date | null = null;

  /** When it stopped being current. */
  @Property({ type: 'datetime', nullable: true, fieldName: 'superseded_at' })
  supersededAt: Date | null = null;

  /**
   * Advisory markers rendered on the revisions list, e.g. `["shrink"]` when the
   * node count collapsed against the revision in force. Advisory, never a
   * blocker: a smaller taxonomy is the provider's decision to make, and the
   * impact preview is where it becomes a judgement (research §R22).
   */
  @Property({ type: 'json', fieldName: 'flags' })
  flags: FeedTaxonomyRevisionFlag[] = [];
}
