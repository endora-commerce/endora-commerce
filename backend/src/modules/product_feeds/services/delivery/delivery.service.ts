import { Readable } from 'node:stream';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  FEED_DELIVERY_LIMITS,
  PRODUCT_FEED_ERROR_CODES,
  type FeedDeliveryAttempt as FeedDeliveryAttemptDto,
  type FeedDeliveryFailureReason,
  type FeedDeliveryProtocol,
} from '@b2b/contracts';
import { HttpError } from '../../../../http/error-envelope.js';
import { FeedArtefact } from '../../entities/feed-artefact.entity.js';
import type { FeedDelivery } from '../../entities/feed-delivery.entity.js';
import { FeedDeliveryAttempt } from '../../entities/feed-delivery-attempt.entity.js';
import { ProductFeed } from '../../entities/product-feed.entity.js';
import { artefactFilename } from '../artefact-filename.js';
import type { ArtefactStorageBackend, ArtefactStorePort } from '../artefact-store.js';
import {
  FeedDeliveryError,
  describeTarget,
  type FeedDeliveryAdapter,
} from './delivery-adapter.interface.js';
import { DeliveryConfigService } from './delivery-config.service.js';
import { toFailureDetail } from './delivery-redaction.js';

/**
 * Delivery orchestration — feature 070 / FR-102 – FR-106, FR-108.
 *
 * The rules this class exists to hold, in the order they matter:
 *
 *  - **Delivery runs only after a successful publish** (FR-102). A failed, empty
 *    or skipped run delivers nothing: the previously published file is the one
 *    still being served, and re-sending it would tell the partner something
 *    changed when nothing did. That is enforced at the call site — the
 *    generation pipeline invokes the port only on the publishing branch — and
 *    again here, by requiring the artefact to be the feed's *published* one.
 *  - **A delivery failure never fails the run** (FR-103). The artefact is
 *    already published; delivery is a separate outcome with its own status, its
 *    own retry and its own row.
 *  - **Every attempt is recorded** (FR-105), successful or not. An empty history
 *    and a history of five failures look identical if only successes are
 *    written down.
 *  - **No secret reaches a row** (FR-108). `target` is the redacted display form
 *    and `failureDetail` goes through `toFailureDetail`, because a transport
 *    library will put a password into an error message.
 *
 * Nothing here throws at the caller. `deliver` returns an outcome; the worker
 * decides whether to retry from it, and the run is untouched either way.
 */

export interface DeliveryOutcome {
  status: 'succeeded' | 'failed' | 'skipped';
  failureReason: FeedDeliveryFailureReason | null;
  failureDetail: string | null;
  /** Null when nothing was attempted (no configuration, delivery off). */
  attemptId: string | null;
  /** True when another attempt is worth making (FR-104). */
  retryable: boolean;
}

export interface DeliverRequest {
  feedId: string;
  runId: string | null;
  artefactId: string;
  /** 1-based. The worker passes BullMQ's attempt number. */
  attempt: number;
  maxAttempts: number;
}

export interface DeliveryServiceDeps {
  emFactory: () => EntityManager;
  config: DeliveryConfigService;
  artefactStore: ArtefactStorePort;
  /** Keyed by protocol. An overlay contributes a fourth here (Principle XV). */
  adapters: Map<FeedDeliveryProtocol, FeedDeliveryAdapter>;
  /** Bounded per feed; the sweep runs after each recorded attempt. */
  attemptHistoryLimit?: number;
  /** SR-5 — `POST /delivery/test` ceiling per feed per hour. */
  testRateLimitPerHour?: () => Promise<number>;
  logWarn?: (message: string, detail: Record<string, unknown>) => void;
}

/**
 * Reasons a retry cannot help. A refused address and a missing configuration are
 * facts about the configuration, not about the network: retrying four more times
 * produces four more identical rows and delays the operator noticing.
 */
const TERMINAL_REASONS: ReadonlySet<FeedDeliveryFailureReason> = new Set([
  'not_configured',
  'target_refused',
  'authentication_failed',
]);

export class DeliveryService {
  constructor(private readonly deps: DeliveryServiceDeps) {}

  // -------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------

  /**
   * Delivers one published artefact. Never throws.
   *
   * `skipped` and `failed` are different answers on purpose: skipped means
   * nothing was configured or delivery is off, which is not a problem; failed
   * means a configured target did not receive the file, which is.
   */
  async deliver(request: DeliverRequest): Promise<DeliveryOutcome> {
    try {
      return await this.attemptDelivery(request);
    } catch (err) {
      // The catch-all exists because FR-103 is absolute: a bug in this file must
      // not be able to fail a run whose artefact is already published and served.
      this.deps.logWarn?.('product_feeds: delivery raised an unexpected error', {
        productFeedId: request.feedId,
        feedArtefactId: request.artefactId,
        error: String(err),
      });
      return {
        status: 'failed',
        failureReason: 'internal_error',
        failureDetail: null,
        attemptId: null,
        retryable: false,
      };
    }
  }

  private async attemptDelivery(request: DeliverRequest): Promise<DeliveryOutcome> {
    const delivery = await this.deps.config.find(request.feedId);
    if (!delivery || !delivery.enabled) return skipped();

    const adapter = this.deps.adapters.get(delivery.protocol);
    if (!adapter) {
      return this.record(request, delivery, '(no transport)', {
        reason: 'internal_error',
        detail: `No transport is registered for "${delivery.protocol}".`,
        retryable: false,
      });
    }

    const target = await this.deps.config.resolveTarget(delivery);
    if (!target) {
      return this.record(request, delivery, '(not configured)', {
        reason: 'not_configured',
        detail:
          'The delivery target is incomplete, or the credential holding its password is gone.',
        retryable: false,
      });
    }
    const display = describeTarget(target);
    const secrets = DeliveryConfigService.secretsOf(target, delivery.headers);

    const em = this.deps.emFactory();
    const feed = await em.findOne(ProductFeed, { id: request.feedId });
    const artefact = await em.findOne(FeedArtefact, {
      id: request.artefactId,
      productFeedId: request.feedId,
    });
    if (!feed || !artefact) {
      return this.record(request, delivery, display, {
        reason: 'artefact_unavailable',
        detail: 'The generated file is no longer available to send.',
        retryable: false,
      });
    }

    // FR-102, enforced a second time here rather than trusted from the caller: a
    // redelivered queue job whose artefact has since been superseded must not
    // push yesterday's file over today's.
    if (feed.publishedArtefactId !== artefact.id) {
      return skipped();
    }

    let body: Readable;
    try {
      const stream = await this.deps.artefactStore.open({
        backend: artefact.storageBackend as ArtefactStorageBackend,
        locator: artefact.storageLocator,
      });
      body = stream instanceof Readable ? stream : Readable.from(stream);
    } catch (err) {
      return this.record(request, delivery, display, {
        reason: 'artefact_unavailable',
        detail: toFailureDetail(err, { secrets }),
        // Storage being briefly unavailable is exactly what a retry is for.
        retryable: true,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_DELIVERY_LIMITS.TRANSFER_TIMEOUT_MS);
    const startedAtMs = Date.now();
    try {
      await adapter.send({
        body,
        filename: artefactFilename(feed.slug, artefact.contentType),
        contentType: artefact.contentType,
        byteSize: Number(artefact.byteSize),
        target,
        signal: controller.signal,
      });
      return this.record(request, delivery, display, null, false, startedAtMs);
    } catch (err) {
      const failure = classify(err, secrets);
      return this.record(request, delivery, display, failure, false, startedAtMs);
    } finally {
      clearTimeout(timer);
      // A transport that threw mid-stream leaves the storage handle open.
      body.destroy();
    }
  }

  // -------------------------------------------------------------------------
  // Connection test (FR-106)
  // -------------------------------------------------------------------------

  /**
   * Proves reachability and authentication without delivering an artefact.
   *
   * Rate-limited per feed (SR-5) and sending a fixed, non-operator-controlled
   * payload, so the endpoint cannot be turned into a general-purpose request
   * tool by an administrator who has `product_feeds:write` but should not have
   * arbitrary egress.
   */
  async test(feedId: string): Promise<{
    ok: boolean;
    failureReason: FeedDeliveryFailureReason | null;
    failureDetail: string | null;
    attempt: FeedDeliveryAttemptDto;
  }> {
    const delivery = await this.deps.config.find(feedId);
    if (!delivery) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        'This feed has no delivery configuration to test.',
        { reason: PRODUCT_FEED_ERROR_CODES.DELIVERY_NOT_CONFIGURED },
      );
    }
    await this.assertTestAllowed(feedId);

    const adapter = this.deps.adapters.get(delivery.protocol);
    const target = await this.deps.config.resolveTarget(delivery);
    const request: DeliverRequest = {
      feedId,
      runId: null,
      artefactId: '',
      attempt: 1,
      maxAttempts: 1,
    };

    if (!adapter || !target) {
      const outcome = await this.record(
        request,
        delivery,
        target ? describeTarget(target) : '(not configured)',
        {
          reason: 'not_configured',
          detail: 'The delivery target is incomplete. Fill in every required field and save.',
          retryable: false,
        },
        true,
      );
      return this.testResult(outcome);
    }

    const secrets = DeliveryConfigService.secretsOf(target, delivery.headers);
    const display = describeTarget(target);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_DELIVERY_LIMITS.CONNECT_TIMEOUT_MS * 2);
    const startedAtMs = Date.now();
    try {
      await adapter.check(target, controller.signal);
      return this.testResult(
        await this.record(request, delivery, display, null, true, startedAtMs),
      );
    } catch (err) {
      return this.testResult(
        await this.record(request, delivery, display, classify(err, secrets), true, startedAtMs),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async assertTestAllowed(feedId: string): Promise<void> {
    const limit = this.deps.testRateLimitPerHour
      ? await this.deps.testRateLimitPerHour()
      : FEED_DELIVERY_LIMITS.DEFAULT_TEST_RATE_LIMIT_PER_HOUR;
    if (limit <= 0) return;
    const since = new Date(Date.now() - 3_600_000);
    const used = await this.deps
      .emFactory()
      .count(FeedDeliveryAttempt, { productFeedId: feedId, isTest: true, startedAt: { $gte: since } });
    if (used >= limit) {
      throw new HttpError(
        429,
        ERROR_CODES.RATE_LIMITED,
        `The connection test may be run ${limit} times an hour for one feed. Try again later.`,
        { reason: PRODUCT_FEED_ERROR_CODES.DELIVERY_TEST_RATE_LIMITED },
      );
    }
  }

  private async testResult(outcome: DeliveryOutcome): Promise<{
    ok: boolean;
    failureReason: FeedDeliveryFailureReason | null;
    failureDetail: string | null;
    attempt: FeedDeliveryAttemptDto;
  }> {
    const row = outcome.attemptId
      ? await this.deps.emFactory().findOne(FeedDeliveryAttempt, { id: outcome.attemptId })
      : null;
    if (!row) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'The connection test ran but its result could not be recorded.',
      );
    }
    return {
      ok: outcome.status === 'succeeded',
      failureReason: outcome.failureReason,
      failureDetail: outcome.failureDetail,
      attempt: toAttemptDto(row),
    };
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async listAttempts(feedId: string, limit: number): Promise<FeedDeliveryAttemptDto[]> {
    const rows = await this.deps
      .emFactory()
      .find(
        FeedDeliveryAttempt,
        { productFeedId: feedId },
        { orderBy: { startedAt: 'desc', id: 'desc' }, limit },
      );
    return rows.map(toAttemptDto);
  }

  /** The most recent attempt, for the feed detail's delivery status line. */
  async lastAttempt(feedId: string): Promise<FeedDeliveryAttemptDto | null> {
    const [row] = await this.deps
      .emFactory()
      .find(
        FeedDeliveryAttempt,
        { productFeedId: feedId, isTest: false },
        { orderBy: { startedAt: 'desc', id: 'desc' }, limit: 1 },
      );
    return row ? toAttemptDto(row) : null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Writes the attempt row and returns the outcome. `failure === null` is a
   * success.
   *
   * The row is written on its own `EntityManager` fork and flushed here, because
   * this runs inside a worker with no request-scoped manager, and a row
   * persisted onto a fork nobody flushes is silently lost.
   */
  private async record(
    request: DeliverRequest,
    delivery: FeedDelivery,
    target: string,
    failure: { reason: FeedDeliveryFailureReason; detail: string; retryable: boolean } | null,
    isTest = false,
    startedAtMs: number = Date.now(),
  ): Promise<DeliveryOutcome> {
    // command-coverage-ignore: the attempt row is this module's own
    // observability data (FR-105), written by a worker with no acting
    // administrator — a scheduled run has no actor at all. The operator writes
    // that produce it are audited where they happen:
    // `product_feeds.delivery.upsert` for the target and
    // `product_feeds.run.start` for a manual generation.
    const startedAt = new Date(startedAtMs);
    const finishedAt = new Date();
    const em = this.deps.emFactory();
    const row = em.create(FeedDeliveryAttempt, {
      productFeedId: request.feedId,
      feedRunId: request.runId,
      feedArtefactId: request.artefactId === '' ? null : request.artefactId,
      protocol: delivery.protocol,
      target: target.slice(0, 512),
      status: failure ? 'failed' : 'succeeded',
      failureReason: failure ? failure.reason : null,
      failureDetail: failure ? failure.detail.slice(0, 2048) : null,
      attempt: request.attempt,
      isTest,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    });
    await em.persistAndFlush(row);
    await this.sweepHistory(request.feedId);

    return {
      status: failure ? 'failed' : 'succeeded',
      failureReason: failure ? failure.reason : null,
      failureDetail: failure ? failure.detail : null,
      attemptId: row.id,
      retryable: failure ? failure.retryable && request.attempt < request.maxAttempts : false,
    };
  }

  /**
   * Keeps the attempt history bounded. A feed on a five-minute schedule writes
   * 288 rows a day and nobody reads the two-hundredth, but the newest few are
   * the whole point of the table.
   */
  private async sweepHistory(feedId: string): Promise<void> {
    const limit = this.deps.attemptHistoryLimit ?? FEED_DELIVERY_LIMITS.ATTEMPT_HISTORY_PER_FEED;
    try {
      const em = this.deps.emFactory();
      await em
        .getConnection()
        .execute(
          `delete from "product_feed_delivery_attempts"
            where "product_feed_id" = ?
              and "id" not in (
                select "id" from "product_feed_delivery_attempts"
                 where "product_feed_id" = ?
                 order by "started_at" desc, "id" desc
                 limit ?
              )`,
          [feedId, feedId, limit],
          'run',
          em.getTransactionContext(),
        );
    } catch (err) {
      // A sweep that cannot run must not turn a recorded delivery into an
      // unrecorded crash — the row it was called to trim is already committed.
      this.deps.logWarn?.('product_feeds: delivery attempt history could not be trimmed', {
        productFeedId: feedId,
        error: String(err),
      });
    }
  }
}

function skipped(): DeliveryOutcome {
  return {
    status: 'skipped',
    failureReason: null,
    failureDetail: null,
    attemptId: null,
    retryable: false,
  };
}

/** Maps a transport throw onto the closed reason set, redacting as it goes. */
function classify(
  err: unknown,
  secrets: string[],
): { reason: FeedDeliveryFailureReason; detail: string; retryable: boolean } {
  if (err instanceof FeedDeliveryError) {
    const detail = err.cause
      ? `${err.message} ${toFailureDetail(err.cause, { secrets })}`.trim()
      : err.message;
    return {
      reason: err.reason,
      detail: toFailureDetail(new Error(detail), { secrets }).replace(/^Error: /, ''),
      retryable: !TERMINAL_REASONS.has(err.reason),
    };
  }
  return {
    reason: 'internal_error',
    detail: toFailureDetail(err, { secrets }),
    retryable: true,
  };
}

export function toAttemptDto(row: FeedDeliveryAttempt): FeedDeliveryAttemptDto {
  return {
    id: row.id,
    productFeedId: row.productFeedId,
    feedRunId: row.feedRunId ?? null,
    feedArtefactId: row.feedArtefactId ?? null,
    protocol: row.protocol,
    target: row.target,
    status: row.status,
    failureReason: row.failureReason ?? null,
    failureDetail: row.failureDetail ?? null,
    attempt: row.attempt,
    isTest: row.isTest,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    durationMs: row.durationMs ?? null,
  };
}
