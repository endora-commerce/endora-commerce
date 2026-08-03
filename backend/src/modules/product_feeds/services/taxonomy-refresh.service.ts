import type { EntityManager } from '@mikro-orm/postgresql';
import {
  TAXONOMY_FETCH_LIMITS,
  type FeedTaxonomyCheckOutcome,
  type FeedTaxonomyCheckReason,
  type FeedTaxonomyCheckTrigger,
  type FeedTaxonomyRevisionFlag,
  type TaxonomyProviderCode,
} from '@b2b/contracts';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import { FeedTaxonomyCheck } from '../entities/feed-taxonomy-check.entity.js';
import { FeedTaxonomyNode } from '../entities/feed-taxonomy-node.entity.js';
import {
  buildTaxonomyNodes,
  parseTaxonomyFile,
  parseTaxonomyHeader,
  type TaxonomyNodeDraft,
} from './taxonomy-file-parser.js';
import {
  combineContentHashes,
  compareToInstalledNodeSet,
  deriveRevisionLabel,
  taxonomyContentHash,
  withCollisionSuffix,
} from './taxonomy-revision-identity.js';
import type { TaxonomySourceFetcherPort } from './taxonomy-source-fetcher.interface.js';
import type { TaxonomyReconcilerService } from './taxonomy-reconciler.service.js';
import type { TaxonomyRevisionRetentionService } from './taxonomy-revision-retention.service.js';

/**
 * One check for a newer provider revision — feature 067 / FR-086, FR-092,
 * FR-093, FR-098, research §§R20, R22, R25.
 *
 * **The invariant this whole file serves**: a check may only *add an inactive
 * revision*. Nothing here writes `is_current`, and nothing here touches a
 * mapping's stale flag or a template's taxonomy link. Only the promote Command
 * changes what a feed emits. A shortcut that made this path activate a revision
 * would be convenient and would destroy the property that makes the fetch safe.
 *
 * **It never throws.** Every outcome — installed, unchanged, rejected, failed —
 * becomes a `product_feed_taxonomy_checks` row and the job completes. The next
 * scheduled tick is the retry; the operator has "Check now" for impatience.
 * This copies the reaper's stated posture, with more force: the thing being
 * retried here is a third party's web server, and a handler that failed its job
 * on a `503` would be retried, log noise, and eventually be switched off by an
 * operator who has stopped reading it.
 *
 * **Nothing is written to disk** (FR-098). `data/taxonomies/` is a read-only
 * vendored artefact of the image whose `PROVENANCE.md` documents what shipped;
 * downloaded bytes are parsed in memory, inserted as node rows and released.
 * Raw bytes are not persisted at all — the parsed node set is lossless for
 * every consumer, and the content hash is what "prove this is the same file"
 * actually needs.
 *
 * The validation gate runs **before any revision row is created** (FR-092), so
 * a rejected response leaves the database exactly as it was.
 */

/** The first is authoritative for the tree; the second contributes labels. */
const LANGUAGES = ['en', 'pl'] as const;
type Language = (typeof LANGUAGES)[number];

/** Below this a revision is flagged `shrink` for the operator to judge. */
const SHRINK_RATIO = 0.8;

export interface TaxonomyRefreshSettings {
  enabled(): Promise<boolean>;
  /** Per provider and language, already defaulted from the manifest. */
  sourceUrl(providerCode: TaxonomyProviderCode, language: Language): Promise<string>;
}

export interface TaxonomyRefreshDeps {
  emFactory: () => EntityManager;
  fetcher: TaxonomySourceFetcherPort;
  reconciler: Pick<TaxonomyReconcilerService, 'installRevision'>;
  retention: Pick<TaxonomyRevisionRetentionService, 'enforce'>;
  settings: TaxonomyRefreshSettings;
  /** FR-093 — `not_found` notifies once per transition into failure. */
  notifyNotFound?: (input: {
    providerCode: TaxonomyProviderCode;
    checkId: string;
    detail: string;
  }) => Promise<unknown>;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface TaxonomyCheckResult {
  checkId: string;
  providerCode: TaxonomyProviderCode;
  outcome: FeedTaxonomyCheckOutcome;
  reason: FeedTaxonomyCheckReason | null;
  installedTaxonomyId: string | null;
  revision: string | null;
  detail: string | null;
}

export class TaxonomyFetchDisabledError extends Error {
  constructor() {
    super('Taxonomy checking is switched off.');
    this.name = 'TaxonomyFetchDisabledError';
  }
}

export class TaxonomyCheckInProgressError extends Error {
  constructor(public readonly providerCode: TaxonomyProviderCode) {
    super(`A taxonomy check for ${providerCode} is already running.`);
    this.name = 'TaxonomyCheckInProgressError';
  }
}

export class TaxonomyRefreshService {
  constructor(private readonly deps: TaxonomyRefreshDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** True while a check for this provider has not finished (FR-096). */
  async isCheckInFlight(providerCode: TaxonomyProviderCode): Promise<boolean> {
    const em = this.deps.emFactory();
    const inFlight = await em.findOne(FeedTaxonomyCheck, { providerCode, finishedAt: null });
    return inFlight !== null;
  }

  /**
   * Opens the check row for a manual trigger. Separated from `runCheck` because
   * the HTTP request must return `202` immediately: the row is the receipt, and
   * the work is done by the worker (or, with no queue, inline afterwards).
   */
  async openCheck(input: {
    providerCode: TaxonomyProviderCode;
    trigger: FeedTaxonomyCheckTrigger;
    /** Pre-generated by the manual trigger so the audit entry addresses this row. */
    id?: string;
  }): Promise<FeedTaxonomyCheck> {
    // command-coverage-ignore: operational history. The audited write for a
    // manual check is `product_feeds.taxonomy_check.start`, which records who
    // asked for outbound traffic; this row is the machine's own log of it.
    const em = this.deps.emFactory();
    const check = em.create(FeedTaxonomyCheck, {
      ...(input.id !== undefined ? { id: input.id } : {}),
      providerCode: input.providerCode,
      trigger: input.trigger,
      startedAt: this.now(),
    });
    await em.persistAndFlush(check);
    return check;
  }

  /**
   * Runs one provider's check to completion and closes its row.
   *
   * Never throws. The caller (worker or route) gets a result object; the row is
   * the durable record.
   */
  async runCheck(input: {
    providerCode: TaxonomyProviderCode;
    trigger: FeedTaxonomyCheckTrigger;
    /** Reuse the row `openCheck` already created for a manual trigger. */
    checkId?: string;
    signal?: AbortSignal;
  }): Promise<TaxonomyCheckResult> {
    const { providerCode } = input;
    let check: FeedTaxonomyCheck;
    try {
      check = input.checkId
        ? ((await this.deps.emFactory().findOne(FeedTaxonomyCheck, { id: input.checkId })) ??
          (await this.openCheck(input)))
        : await this.openCheck(input);
    } catch (err) {
      // Not even the receipt could be written. Log and return; a check that
      // cannot record itself must still not fail the job.
      this.deps.logWarn?.('product_feeds: taxonomy check could not be opened', {
        providerCode,
        error: String(err),
      });
      return {
        checkId: '',
        providerCode,
        outcome: 'failed',
        reason: 'transport',
        installedTaxonomyId: null,
        revision: null,
        detail: String(err).slice(0, 500),
      };
    }

    try {
      return await this.execute(check, providerCode, input.signal);
    } catch (err) {
      // The belt to the braces: every branch below already handles its own
      // failure, so reaching here means a defect. It is still recorded as a
      // failed check rather than allowed to fail the job (FR-093).
      this.deps.logWarn?.('product_feeds: taxonomy check failed unexpectedly', {
        providerCode,
        error: String(err),
      });
      return this.close(check, {
        outcome: 'failed',
        reason: 'transport',
        detail: String(err).slice(0, 500),
      });
    }
  }

  private async execute(
    check: FeedTaxonomyCheck,
    providerCode: TaxonomyProviderCode,
    signal: AbortSignal | undefined,
  ): Promise<TaxonomyCheckResult> {
    if (!(await this.deps.settings.enabled())) {
      // Belt and braces: with the switch off no scheduler exists, so this is
      // unreachable through the scheduled path. It stays because "off means no
      // outbound request whatsoever" (FR-087) must not depend on the scheduler
      // reconciler having run.
      return this.close(check, {
        outcome: 'failed',
        reason: 'transport',
        detail: 'Taxonomy checking is switched off; no request was made.',
      });
    }

    // The whole-check budget, on top of the per-request timeout.
    const budget = new AbortController();
    const budgetTimer = setTimeout(() => budget.abort(), TAXONOMY_FETCH_LIMITS.CHECK_BUDGET_MS);
    signal?.addEventListener('abort', () => budget.abort(), { once: true });

    try {
      const sourceUrls: Record<string, string> = {};
      const bodies: Partial<Record<Language, string>> = {};
      const hashes: string[] = [];
      let etag: string | null = null;
      let bytesRead = 0;

      for (const language of LANGUAGES) {
        const url = await this.deps.settings.sourceUrl(providerCode, language);
        sourceUrls[language] = url;

        const fetched = await this.deps.fetcher.fetchFile({ url, signal: budget.signal });
        if (!fetched.ok) {
          // The authoritative language failing is the failure; a translation
          // failing is `incomplete_languages`, because a revision is installed
          // only when both languages are complete and an operator needs to know
          // which half did not arrive.
          const reason: FeedTaxonomyCheckReason =
            language === LANGUAGES[0] ? fetched.reason : 'incomplete_languages';
          const result = await this.close(check, {
            outcome: language === LANGUAGES[0] ? fetched.outcome : 'rejected',
            reason,
            detail:
              language === LANGUAGES[0]
                ? fetched.detail
                : `The ${language} file could not be downloaded: ${fetched.detail}`,
            httpStatus: fetched.httpStatus,
            bytesRead: fetched.bytesRead,
          });
          if (reason === 'not_found') await this.raiseNotFound(check, fetched.detail);
          return result;
        }
        if (fetched.notModified) {
          // The provider says our stored validator still matches. That is a
          // bandwidth win, never an identity claim — but combined with the
          // stored hash it is the same answer as stage 1, so stop here.
          return this.close(check, {
            outcome: 'unchanged',
            reason: null,
            detail: `${providerCode} answered 304 Not Modified.`,
            httpStatus: fetched.httpStatus,
          });
        }

        bodies[language] = fetched.body;
        hashes.push(taxonomyContentHash(fetched.body));
        bytesRead += fetched.bytesRead;
        etag = etag ?? fetched.etag;
      }

      const contentHash = combineContentHashes(...hashes);

      // Stage 1 — the cheap gate. Equal hash ⇒ these exact bytes are already a
      // revision of ours; a database fact, thanks to the partial unique index.
      const em = this.deps.emFactory();
      const sameBytes = await em.findOne(FeedTaxonomy, {
        providerCode,
        sourceContentHash: contentHash,
      });
      if (sameBytes) {
        return this.close(check, {
          outcome: 'unchanged',
          reason: null,
          detail: `${providerCode} is serving revision ${sameBytes.revision}, which is already installed.`,
          contentHash,
          bytesRead,
        });
      }

      // Parse, then the plausibility gate — BEFORE any row is created (FR-092).
      let drafts: TaxonomyNodeDraft[];
      try {
        drafts = buildTaxonomyNodes(
          LANGUAGES.map((language) => ({
            language,
            lines: parseTaxonomyFile(bodies[language] ?? ''),
          })),
        );
      } catch (err) {
        return this.close(check, {
          outcome: 'rejected',
          reason: 'no_nodes',
          detail: `No categories could be read from the downloaded file: ${String(err).slice(0, 200)}`,
          contentHash,
          bytesRead,
        });
      }
      if (drafts.length < TAXONOMY_FETCH_LIMITS.MIN_PLAUSIBLE_NODES) {
        return this.close(check, {
          outcome: 'rejected',
          reason: 'implausible',
          detail: `Only ${drafts.length} categories could be read, below the ${TAXONOMY_FETCH_LIMITS.MIN_PLAUSIBLE_NODES}-node floor.`,
          contentHash,
          bytesRead,
        });
      }

      // Stage 3 — the authoritative comparison, against the NEWEST installed
      // revision (which need not be the one in force: a candidate installed
      // last week is what a re-fetch this week should compare against).
      const newest = await em.findOne(
        FeedTaxonomy,
        { providerCode },
        { orderBy: { installedAt: 'desc', id: 'desc' } },
      );
      if (newest) {
        const installedNodes = await em.find(FeedTaxonomyNode, { taxonomyId: newest.id });
        const verdict = compareToInstalledNodeSet(
          drafts,
          installedNodes.map((node) => ({
            externalId: node.externalId,
            parentExternalId: node.parentExternalId ?? null,
            fullPath: node.fullPath['en'] ?? '',
          })),
        );
        if (verdict === 'unchanged') {
          // command-coverage-ignore: provenance bookkeeping on a revision that
          // did not change. It records the hash and validator this check
          // computed so next week's cheap gate catches the same byte variant
          // without a full parse; no revision is created, nothing becomes
          // current, and no feed's output can move.
          newest.sourceContentHash = newest.sourceContentHash ?? contentHash;
          newest.sourceEtag = etag ?? newest.sourceEtag;
          await em.flush().catch(() => undefined);
          return this.close(check, {
            outcome: 'unchanged',
            reason: null,
            detail: `${providerCode} is serving the same ${drafts.length} categories as revision ${newest.revision}.`,
            contentHash,
            bytesRead,
          });
        }
      }

      const taken = new Set(
        (await em.find(FeedTaxonomy, { providerCode })).map((row) => row.revision),
      );
      const label = withCollisionSuffix(
        deriveRevisionLabel({
          providerCode,
          headerLabel: parseTaxonomyHeader(bodies[LANGUAGES[0]] ?? ''),
          contentHash,
          fetchedAt: this.now(),
        }),
        taken,
      );

      const current = await em.findOne(FeedTaxonomy, { providerCode, isCurrent: true });
      const flags: FeedTaxonomyRevisionFlag[] =
        current && drafts.length < current.nodeCount * SHRINK_RATIO ? ['shrink'] : [];

      // **Inactive, always** (FR-086). A well-formed but much smaller file is
      // the provider's decision to make, so it installs too — flagged, so the
      // impact preview is where it becomes a judgement rather than the
      // platform overriding the provider.
      const taxonomyId = await this.deps.reconciler.installRevision({
        providerCode,
        revision: label,
        drafts,
        markCurrent: false,
        source: 'fetched',
        sourceUrls,
        sourceContentHash: contentHash,
        sourceEtag: etag,
        fetchedAt: this.now(),
        flags,
      });

      await this.deps.retention.enforce(providerCode);

      return this.close(check, {
        outcome: 'installed',
        reason: null,
        detail: `Installed revision ${label} with ${drafts.length} categories. It is not in use until an administrator promotes it.`,
        contentHash,
        bytesRead,
        installedTaxonomyId: taxonomyId,
        revision: label,
      });
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  private async raiseNotFound(check: FeedTaxonomyCheck, detail: string): Promise<void> {
    try {
      await this.deps.notifyNotFound?.({
        providerCode: check.providerCode,
        checkId: check.id,
        detail,
      });
    } catch (err) {
      this.deps.logWarn?.('product_feeds: taxonomy not-found notification failed', {
        providerCode: check.providerCode,
        error: String(err),
      });
    }
  }

  /** Closes the check row and trims the provider's history to the cap. */
  private async close(
    check: FeedTaxonomyCheck,
    outcome: {
      outcome: FeedTaxonomyCheckOutcome;
      reason: FeedTaxonomyCheckReason | null;
      detail: string;
      httpStatus?: number | null;
      bytesRead?: number | null;
      contentHash?: string | null;
      installedTaxonomyId?: string | null;
      revision?: string | null;
    },
  ): Promise<TaxonomyCheckResult> {
    // command-coverage-ignore: operational history. Closing a check row records
    // what a machine transition did; it cannot change what any feed emits,
    // because the revision it may have installed is inactive by construction.
    try {
      const em = this.deps.emFactory();
      const row = (await em.findOne(FeedTaxonomyCheck, { id: check.id })) ?? check;
      row.finishedAt = this.now();
      row.outcome = outcome.outcome;
      row.reason = outcome.reason;
      row.detail = outcome.detail.slice(0, 500);
      row.httpStatus = outcome.httpStatus ?? null;
      row.bytesRead = outcome.bytesRead ?? null;
      row.contentHash = outcome.contentHash ?? null;
      row.installedTaxonomyId = outcome.installedTaxonomyId ?? null;
      await em.persistAndFlush(row);
      await this.trimHistory(em, check.providerCode);
    } catch (err) {
      this.deps.logWarn?.('product_feeds: taxonomy check row could not be closed', {
        providerCode: check.providerCode,
        error: String(err),
      });
    }

    return {
      checkId: check.id,
      providerCode: check.providerCode,
      outcome: outcome.outcome,
      reason: outcome.reason,
      installedTaxonomyId: outcome.installedTaxonomyId ?? null,
      revision: outcome.revision ?? null,
      detail: outcome.detail,
    };
  }

  /** Twenty weekly checks ≈ five months, and the table can never grow. */
  private async trimHistory(
    em: EntityManager,
    providerCode: TaxonomyProviderCode,
  ): Promise<void> {
    // command-coverage-ignore: bounded history maintenance, like artefact
    // retention and the check rows it trims.
    await em.getConnection().execute(
      `delete from "product_feed_taxonomy_checks"
        where "provider_code" = ?
          and "id" not in (
            select "id" from "product_feed_taxonomy_checks"
             where "provider_code" = ?
             order by "started_at" desc, "id" desc
             limit ?)`,
      [providerCode, providerCode, TAXONOMY_FETCH_LIMITS.CHECK_HISTORY_PER_PROVIDER],
      'run',
      em.getTransactionContext(),
    );
  }
}
