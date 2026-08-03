import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { TaxonomyProviderCode } from '@b2b/contracts';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import { FeedTaxonomyMapping } from '../entities/feed-taxonomy-mapping.entity.js';
import { FeedTaxonomyNode } from '../entities/feed-taxonomy-node.entity.js';
import {
  buildTaxonomyNodes,
  parseTaxonomyFile,
  type TaxonomyNodeDraft,
} from './taxonomy-file-parser.js';

/**
 * Taxonomy install / reconcile — feature 067 / FR-077, FR-078, FR-085.
 *
 * Runs from the module's lifecycle hook at boot. For each provider it looks at
 * the revisions bundled **on disk inside the module** and installs any that the
 * database does not have yet, in one transaction, then re-evaluates every
 * existing mapping for staleness.
 *
 * **Nothing here fetches anything.** FR-077 forbids a runtime fetch from Google
 * or Meta: it would make feed output depend on a third party's uptime and break
 * air-gapped installations. Installing a newer revision is a platform upgrade —
 * which is why there is no route that installs, uploads or refreshes one.
 *
 * **It is lazy in the way that matters.** The database is asked first; a file is
 * read only when its revision is missing. After the first boot the ~1.5 MB of
 * bundled text is never opened again, and an installation with no bundled data
 * at all boots perfectly well with an empty taxonomy table — the mapping screen
 * simply reports that no taxonomy is installed.
 *
 * **A failure logs and skips.** Same posture as the `_i18n` bundle reconciler: a
 * malformed data file is an inconvenience, an unbootable API is an outage.
 */

/** Languages loaded per revision. The first is authoritative for the tree. */
const LANGUAGES = ['en', 'pl'] as const;

/** Node rows are inserted in chunks; a 5 600-row single statement is not kind to anyone. */
const INSERT_CHUNK = 500;

const PROVIDERS: readonly TaxonomyProviderCode[] = ['google_merchant', 'meta'];

function defaultDataRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'taxonomies');
}

export interface TaxonomyReconcileResult {
  installed: Array<{ providerCode: TaxonomyProviderCode; revision: string; nodeCount: number }>;
  /** Mappings whose node vanished in the newly installed revision (FR-085). */
  markedStale: number;
  /** Mappings whose node reappeared — a revision can restore a node too. */
  markedLive: number;
  skipped: Array<{ providerCode: TaxonomyProviderCode; reason: string }>;
}

export interface TaxonomyReconcilerOptions {
  emFactory: () => EntityManager;
  /** Overridden by tests so they run against a small fixture, never the shipped files. */
  dataRoot?: string;
  logger?: { warn(obj: object, msg: string): void };
}

export class TaxonomyReconcilerService {
  private readonly dataRoot: string;

  constructor(private readonly options: TaxonomyReconcilerOptions) {
    this.dataRoot = options.dataRoot ?? defaultDataRoot();
  }

  /**
   * Revisions bundled for a provider, newest label last. Revision directories
   * are named with the provider's own published label, which for both providers
   * sorts lexicographically because both are ISO-ish dates.
   */
  listBundledRevisions(providerCode: TaxonomyProviderCode): string[] {
    const providerDir = join(this.dataRoot, providerCode);
    if (!existsSync(providerDir)) return [];
    try {
      return readdirSync(providerDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  private loadRevision(
    providerCode: TaxonomyProviderCode,
    revision: string,
  ): TaxonomyNodeDraft[] {
    const revisionDir = join(this.dataRoot, providerCode, revision);
    const files: Array<{ language: string; lines: ReturnType<typeof parseTaxonomyFile> }> = [];
    for (const language of LANGUAGES) {
      const path = join(revisionDir, `${language}.txt`);
      if (!existsSync(path)) continue;
      files.push({ language, lines: parseTaxonomyFile(readFileSync(path, 'utf8')) });
    }
    if (files.length === 0) {
      throw new Error(`No language files found in ${revisionDir}`);
    }
    return buildTaxonomyNodes(files);
  }

  /**
   * Installs every bundled revision the database is missing and re-evaluates
   * mappings. Idempotent: a second call with the same bundle does nothing.
   */
  async reconcile(): Promise<TaxonomyReconcileResult> {
    const result: TaxonomyReconcileResult = {
      installed: [],
      markedStale: 0,
      markedLive: 0,
      skipped: [],
    };

    for (const providerCode of PROVIDERS) {
      const revisions = this.listBundledRevisions(providerCode);
      if (revisions.length === 0) continue;
      const newest = revisions[revisions.length - 1]!;

      const em = this.options.emFactory();
      const existing = await em.findOne(FeedTaxonomy, { providerCode, revision: newest });
      if (existing) {
        // Already installed. Re-assert staleness anyway: it is one indexed
        // query and it repairs a mapping written while a load was half done.
        const delta = await this.reevaluateMappings(providerCode);
        result.markedStale += delta.markedStale;
        result.markedLive += delta.markedLive;
        continue;
      }

      try {
        const drafts = this.loadRevision(providerCode, newest);
        await this.install(providerCode, newest, drafts);
        result.installed.push({ providerCode, revision: newest, nodeCount: drafts.length });
        const delta = await this.reevaluateMappings(providerCode);
        result.markedStale += delta.markedStale;
        result.markedLive += delta.markedLive;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        result.skipped.push({ providerCode, reason });
        this.options.logger?.warn(
          { module: 'product_feeds', providerCode, revision: newest, error: reason },
          'taxonomy revision could not be installed; skipping',
        );
      }
    }

    return result;
  }

  private async install(
    providerCode: TaxonomyProviderCode,
    revision: string,
    drafts: TaxonomyNodeDraft[],
  ): Promise<void> {
    // command-coverage-ignore: lifecycle install of platform-shipped reference
    // data (FR-077). It loads a bundled taxonomy revision at boot — no actor, no
    // request, and nothing an operator could undo: the revision arrives with a
    // platform upgrade. Operator decisions ABOUT it (the mappings) are Commands.
    const em = this.options.emFactory();
    await em.transactional(async (tx) => {
      // Exactly one current revision per provider — the partial unique index
      // would refuse a second, so the old one is demoted first.
      await tx
        .getConnection()
        .execute(
          `update "product_feed_taxonomies" set "is_current" = false where "provider_code" = ?`,
          [providerCode],
          'run',
          tx.getTransactionContext(),
        );

      const taxonomy = tx.create(FeedTaxonomy, {
        providerCode,
        revision,
        isCurrent: true,
        nodeCount: drafts.length,
      });
      await tx.persistAndFlush(taxonomy);

      for (let offset = 0; offset < drafts.length; offset += INSERT_CHUNK) {
        for (const draft of drafts.slice(offset, offset + INSERT_CHUNK)) {
          tx.persist(
            tx.create(FeedTaxonomyNode, {
              taxonomyId: taxonomy.id,
              externalId: draft.externalId,
              parentExternalId: draft.parentExternalId,
              label: draft.label,
              fullPath: draft.fullPath,
              depth: draft.depth,
            }),
          );
        }
        await tx.flush();
        tx.clear();
      }
    });
  }

  /**
   * FR-085. For every mapping of this provider: node present in the current
   * revision ⇒ live, node absent ⇒ stale. Rows are **never** rewritten to a
   * different node and **never** deleted — the operator's decision survives so
   * they can revisit it, and `GET /stale-mappings` is the review list.
   */
  async reevaluateMappings(
    providerCode: TaxonomyProviderCode,
  ): Promise<{ markedStale: number; markedLive: number }> {
    const em = this.options.emFactory();
    const current = await em.findOne(FeedTaxonomy, { providerCode, isCurrent: true });
    if (!current) return { markedStale: 0, markedLive: 0 };

    const conn = em.getConnection();
    const staleRows = (await conn.execute(
      `update "product_feed_taxonomy_mappings" m
          set "stale" = true, "updated_at" = now()
        where m."taxonomy_provider_code" = ?
          and m."stale" = false
          and not exists (
            select 1 from "product_feed_taxonomy_nodes" n
             where n."taxonomy_id" = ? and n."external_id" = m."node_external_id")
        returning m."id"`,
      [providerCode, current.id],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;

    const liveRows = (await conn.execute(
      `update "product_feed_taxonomy_mappings" m
          set "stale" = false, "updated_at" = now()
        where m."taxonomy_provider_code" = ?
          and m."stale" = true
          and exists (
            select 1 from "product_feed_taxonomy_nodes" n
             where n."taxonomy_id" = ? and n."external_id" = m."node_external_id")
        returning m."id"`,
      [providerCode, current.id],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string }>;

    return { markedStale: staleRows.length, markedLive: liveRows.length };
  }

  /**
   * Points every template of a provider at its current taxonomy, so
   * `provider_category` fields resolve without the operator doing anything.
   * Idempotent and safe to call on every boot.
   */
  async linkTemplatesToCurrentTaxonomies(): Promise<void> {
    const em = this.options.emFactory();
    for (const providerCode of PROVIDERS) {
      const current = await em.findOne(FeedTaxonomy, { providerCode, isCurrent: true });
      if (!current) continue;
      await em
        .getConnection()
        .execute(
          `update "product_feed_templates"
              set "taxonomy_id" = ?
            where "provider_code" = ?
              and ("taxonomy_id" is null or "taxonomy_id" <> ?)`,
          [current.id, providerCode, current.id],
          'run',
          em.getTransactionContext(),
        );
    }
  }

  /** Mapping count per provider — used by the mapping service's coverage summary. */
  async currentTaxonomyFor(
    providerCode: TaxonomyProviderCode,
  ): Promise<FeedTaxonomy | null> {
    return this.options.emFactory().findOne(FeedTaxonomy, { providerCode, isCurrent: true });
  }

  /** Also used by `FeedTaxonomyMapping` writes to refuse an unknown node. */
  async nodeExists(providerCode: TaxonomyProviderCode, externalId: string): Promise<boolean> {
    const em = this.options.emFactory();
    const current = await em.findOne(FeedTaxonomy, { providerCode, isCurrent: true });
    if (!current) return false;
    const node = await em.findOne(FeedTaxonomyNode, {
      taxonomyId: current.id,
      externalId,
    });
    return node !== null;
  }

  /** Mapping rows for a provider, keyed by category id. */
  async mappingsFor(
    providerCode: TaxonomyProviderCode,
  ): Promise<FeedTaxonomyMapping[]> {
    return this.options.emFactory().find(FeedTaxonomyMapping, {
      taxonomyProviderCode: providerCode,
    });
  }
}
