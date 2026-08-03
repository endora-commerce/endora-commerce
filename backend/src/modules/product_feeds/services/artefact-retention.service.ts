import type { EntityManager } from '@mikro-orm/postgresql';
import { FeedArtefact, type FeedArtefactKind } from '../entities/feed-artefact.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import type { ArtefactStorageBackend, ArtefactStorePort } from './artefact-store.js';

/**
 * Artefact retention — feature 067 / FR-052, `contracts/admin-runs.md` §6.
 *
 * After a successful publish, artefacts of the same `(feed, kind)` beyond the
 * newest `N` are deleted: storage object first, then the row.
 *
 * This is the one part of the module that destroys data an operator cannot
 * recreate, so it is deliberately timid:
 *
 *  - **the currently published artefact is never a candidate**, whatever `N`
 *    is and whatever its age. It is read fresh from the feed row inside the
 *    sweep rather than passed in, because the caller's copy may predate the
 *    publish that just happened — and the failure mode of getting that wrong is
 *    deleting the file a provider is fetching right now.
 *  - **the run's own artefact is never a candidate** either, for the same
 *    reason one step earlier: a run that produced a file the pointer has not
 *    moved to yet (`empty`, over-threshold) still has a row an operator may
 *    download from the run detail page.
 *  - **`N` is clamped to at least 1.** A misconfigured `0` must not turn the
 *    next successful run into a purge of everything but the live pointer.
 *  - **a missing object is not an error.** The row still goes; a throw here
 *    would fail a generation that had already succeeded.
 *  - **bytes go before rows.** A deleted row with a surviving object leaks
 *    storage silently; a deleted object with a surviving row is visible and
 *    self-corrects on the next sweep.
 *
 * Observability: the sweep returns what it did and logs anything it could not
 * do, so "the disk is filling up" and "retention is not running" are
 * distinguishable without a debugger.
 */

/** Floor on the retention count — see the class comment. */
const MINIMUM_RETAINED = 1;

export interface RetentionResult {
  /** Rows removed together with their storage object. */
  purged: number;
  /** Objects that were already gone; the row was still removed. */
  missingObjects: number;
}

export interface ArtefactRetentionDeps {
  emFactory: () => EntityManager;
  artefactStore: ArtefactStorePort;
  /** Reads `product_feeds.artefact_retention_count`; falls back to the default. */
  retentionCount: () => Promise<number>;
  /** Structured, non-fatal logging. Retention must never throw at its caller. */
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

/** Matches the `artefact_retention_count` default in the module manifest. */
export const DEFAULT_ARTEFACT_RETENTION_COUNT = 3;

export class ArtefactRetentionService {
  constructor(private readonly deps: ArtefactRetentionDeps) {}

  /**
   * One sweep for one `(feed, kind)`. Never throws: the caller is a run that
   * has already produced a file, and losing that outcome to a storage hiccup
   * during cleanup would be strictly worse than leaving an old file behind.
   */
  async enforce(
    feedId: string,
    kind: FeedArtefactKind = 'feed',
    protectedArtefactId: string | null = null,
  ): Promise<RetentionResult> {
    try {
      return await this.sweep(feedId, kind, protectedArtefactId);
    } catch (err) {
      this.deps.logWarn?.('product_feeds: artefact retention sweep failed', {
        productFeedId: feedId,
        kind,
        error: String(err),
      });
      return { purged: 0, missingObjects: 0 };
    }
  }

  private async sweep(
    feedId: string,
    kind: FeedArtefactKind,
    protectedArtefactId: string | null,
  ): Promise<RetentionResult> {
    // command-coverage-ignore: retention bookkeeping (FR-052). It deletes stored
    // bytes and their rows to a settings-configured depth after the publish
    // pointer has already moved; nobody performed it, so there is no actor to
    // attribute it to and nothing about it is undoable.
    const keep = Math.max(MINIMUM_RETAINED, Math.trunc(await this.retentionCount()));
    const em = this.deps.emFactory();
    em.clear();

    // Read the pointer fresh: the publish that triggered this sweep may have
    // moved it since the caller last looked.
    const feed = await em.findOne(ProductFeed, { id: feedId });
    const untouchable = new Set(
      [feed?.publishedArtefactId ?? null, protectedArtefactId].filter(
        (id): id is string => typeof id === 'string',
      ),
    );

    const artefacts = await em.find(
      FeedArtefact,
      { productFeedId: feedId, kind },
      { orderBy: { producedAt: 'desc', id: 'desc' } },
    );

    const candidates: FeedArtefact[] = [];
    let retained = 0;
    for (const artefact of artefacts) {
      if (untouchable.has(artefact.id)) continue;
      if (retained < keep) {
        retained += 1;
        continue;
      }
      candidates.push(artefact);
    }
    if (candidates.length === 0) return { purged: 0, missingObjects: 0 };

    let missingObjects = 0;
    for (const artefact of candidates) {
      if (artefact.storageLocator) {
        try {
          await this.deps.artefactStore.delete({
            backend: artefact.storageBackend as ArtefactStorageBackend,
            locator: artefact.storageLocator,
          });
        } catch (err) {
          // Already gone, or a backend that cannot say. Counted, logged and
          // moved past — the row still goes.
          missingObjects += 1;
          this.deps.logWarn?.('product_feeds: retention could not delete an artefact object', {
            productFeedId: feedId,
            artefactId: artefact.id,
            locator: artefact.storageLocator,
            error: String(err),
          });
        }
      }
      em.remove(artefact);
    }
    await em.flush();

    return { purged: candidates.length, missingObjects };
  }

  private async retentionCount(): Promise<number> {
    try {
      const value = await this.deps.retentionCount();
      return Number.isFinite(value) && value >= 0 ? value : DEFAULT_ARTEFACT_RETENTION_COUNT;
    } catch {
      // An unreadable setting must not stop the sweep, and must not widen it
      // either: the manifest default is the answer.
      return DEFAULT_ARTEFACT_RETENTION_COUNT;
    }
  }
}
