import type { FeedArtefact } from '../entities/feed-artefact.entity.js';
import type { FeedRun } from '../entities/feed-run.entity.js';
import type { ProductFeed } from '../entities/product-feed.entity.js';
import type { ProductFeedRow, ProductFeedService } from './product-feed.service.js';

/**
 * Wire mapping for the Product Feed admin surface — feature 067 / FR-055.
 *
 * Everything the list and detail pages show, assembled once here so the list
 * row and the detail row cannot drift apart. Three fields are worth explaining:
 *
 *  - `token.url` is **null while the token is revoked** (FR-047): the admin
 *    must not show a URL that no longer serves.
 *  - `isRunning` is derived from the claim (`current_run_id`), so the admin
 *    disables *Generate* on exactly the condition the worker enforces (FR-033).
 *  - `scheduleTooTightWarning` compares the rolling average run duration with
 *    half the schedule interval — the honest way to accept minute granularity
 *    while telling an operator a 100k-item feed cannot regenerate every five
 *    minutes.
 *
 * The plaintext token is never reachable from here; it exists only in the
 * create/rotate response.
 */

export interface FeedDtoTokenView {
  prefix: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  url: string | null;
  /**
   * Whether `url` carries the real, working link rather than the masked form.
   * False for tokens issued before the token became recoverable, and on a
   * deployment with no encryption key — the admin then keeps the old
   * "rotate to get a new one" copy instead of offering a link that 404s.
   */
  urlIsLive: boolean;
}

export function toFeedDto(
  row: ProductFeedRow,
  feeds: Pick<ProductFeedService, 'publicUrlFor' | 'revealTokenFor'>,
): Record<string, unknown> {
  const feed = row.feed;
  return {
    id: feed.id,
    name: feed.name,
    slug: feed.slug,
    feedTemplateId: feed.feedTemplateId,
    feedTemplateName: row.templateName,
    salesChannelId: feed.salesChannelId,
    salesChannelCode: row.channelCode,
    languageCode: feed.languageCode,
    currencyCode: feed.currencyCode,
    priceListId: feed.priceListId ?? null,
    pricePresentation: feed.pricePresentation,
    taxCountry: feed.taxCountry ?? null,
    selectionRule: feed.selectionRule,
    schedule:
      feed.scheduleCron && feed.scheduleTimezone
        ? { cron: feed.scheduleCron, timezone: feed.scheduleTimezone }
        : null,
    enabled: feed.enabled,
    token: tokenView(feed, feeds),
    lastRun: row.lastRun ? toRunSummary(row.lastRun) : null,
    nextRunAt: feed.nextRunAt ? feed.nextRunAt.toISOString() : null,
    publishedArtefactId: feed.publishedArtefactId ?? null,
    publishedItemCount: row.publishedArtefact ? row.publishedArtefact.itemCount : null,
    publishedAt: row.publishedArtefact ? row.publishedArtefact.producedAt.toISOString() : null,
    isRunning: feed.currentRunId != null,
    scheduleTooTightWarning: scheduleTooTight(feed),
    version: feed.version,
    createdAt: feed.createdAt.toISOString(),
    updatedAt: feed.updatedAt.toISOString(),
  };
}

function tokenView(
  feed: ProductFeed,
  feeds: Pick<ProductFeedService, 'publicUrlFor' | 'revealTokenFor'>,
): FeedDtoTokenView {
  const live = feed.tokenHash != null && feed.tokenRevokedAt == null;
  if (!live || !feed.tokenPrefix) {
    return {
      prefix: feed.tokenPrefix ?? null,
      rotatedAt: feed.tokenRotatedAt ? feed.tokenRotatedAt.toISOString() : null,
      revokedAt: feed.tokenRevokedAt ? feed.tokenRevokedAt.toISOString() : null,
      url: null,
      urlIsLive: false,
    };
  }

  // The plaintext is recoverable now (it is stored encrypted at rest), so the
  // admin gets the real link — the one the operator has to paste into Merchant
  // Center, and re-paste every time a provider is reconfigured. Where it is
  // NOT recoverable — a token issued before the column existed, or no
  // encryption key on this deployment — the masked form is still the honest
  // answer, and `urlIsLive` is what tells the two apart.
  const plaintext = feeds.revealTokenFor(feed);
  return {
    prefix: feed.tokenPrefix,
    rotatedAt: feed.tokenRotatedAt ? feed.tokenRotatedAt.toISOString() : null,
    revokedAt: feed.tokenRevokedAt ? feed.tokenRevokedAt.toISOString() : null,
    url: feeds.publicUrlFor(feed, plaintext ?? `${feed.tokenPrefix}…`),
    urlIsLive: plaintext !== null,
  };
}

export function toRunSummary(run: FeedRun): Record<string, unknown> {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    emittedCount: run.emittedCount,
    skippedCount: run.skippedCount,
    warningCount: run.warningCount,
    failureCode: run.failureCode ?? null,
  };
}

export function toRunDto(
  run: FeedRun,
  artefact: FeedArtefact | null,
  feed: ProductFeed,
): Record<string, unknown> {
  return {
    ...toRunSummary(run),
    productFeedId: run.productFeedId,
    triggeredByAdminUserId: run.triggeredByAdminUserId ?? null,
    consideredCount: run.consideredCount,
    durationMs: run.durationMs ?? null,
    failureDetail: run.failureDetail ?? null,
    skipReason: run.skipReason ?? null,
    issueOverflow: run.issueOverflow,
    artefact: artefact
      ? {
          id: artefact.id,
          byteSize: Number(artefact.byteSize),
          itemCount: artefact.itemCount,
          contentType: artefact.contentType,
          producedAt: artefact.producedAt.toISOString(),
          isPublished: feed.publishedArtefactId === artefact.id,
        }
      : null,
    createdAt: run.createdAt.toISOString(),
  };
}

/**
 * True when the rolling average run duration exceeds half the schedule
 * interval. Only the two simplest cron shapes are measured — `*​/N` on minutes
 * and on hours — because those are what the presets produce; anything hand
 * written is left unwarned rather than guessed at.
 */
export function scheduleTooTight(feed: ProductFeed): boolean {
  if (!feed.scheduleCron || feed.avgRunDurationMs == null) return false;
  const intervalMs = approximateCronIntervalMs(feed.scheduleCron);
  if (intervalMs === null) return false;
  return feed.avgRunDurationMs > intervalMs / 2;
}

export function approximateCronIntervalMs(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts as [string, string, string, string, string];
  const everyMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyMinutes && hour === '*') return Number(everyMinutes[1]) * 60_000;
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours) return Number(everyHours[1]) * 3_600_000;
  if (/^\d+$/.test(minute) && hour === '*') return 3_600_000;
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) return 86_400_000;
  return null;
}
