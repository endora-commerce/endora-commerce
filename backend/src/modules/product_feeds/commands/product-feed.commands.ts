import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import type { Command } from '../../../commands/command.js';
import { HttpError } from '../../../http/error-envelope.js';
import { FeedRun } from '../entities/feed-run.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import { issueFeedToken } from '../services/feed-token.service.js';

/**
 * Product Feed Commands — feature 067 / FR-059, Principle XIII, research §R17.
 *
 * Every operator-initiated write in this module runs through `CommandBus.run`,
 * which is what gives it exactly one audit entry attributed to the acting
 * administrator. There is no hand-written audit call anywhere in the module.
 *
 * Two rules the token commands carry that a reviewer should check:
 *  - `stateAfter` records the **prefix and the timestamps only**. Never the
 *    plaintext token, and never its hash — an audit log is not a place where a
 *    live credential should be recoverable.
 *  - Rotation has **no grace window** (research §R8). A second still-valid
 *    token would mean rotation did not actually revoke anything.
 *
 * Deliberately NOT commands (each carries `command-coverage-ignore` at its
 * site): run status transitions, artefact publication, retention purge and the
 * reaper. They are machine transitions inside an operation already audited at
 * `product_feeds.run.start`.
 */

/** Envelope every module event carries (`EventBase`). */
function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

/** The audit projection of a feed. Excludes every token field except the prefix. */
function auditState(feed: ProductFeed): Record<string, unknown> {
  return {
    id: feed.id,
    name: feed.name,
    slug: feed.slug,
    feedTemplateId: feed.feedTemplateId,
    salesChannelId: feed.salesChannelId,
    languageCode: feed.languageCode,
    currencyCode: feed.currencyCode,
    priceListId: feed.priceListId ?? null,
    pricePresentation: feed.pricePresentation,
    taxCountry: feed.taxCountry ?? null,
    selectionRule: feed.selectionRule,
    scheduleCron: feed.scheduleCron ?? null,
    scheduleTimezone: feed.scheduleTimezone ?? null,
    enabled: feed.enabled,
    tokenPrefix: feed.tokenPrefix ?? null,
    version: feed.version,
  };
}

export interface FeedWriteValues {
  name: string;
  slug: string;
  feedTemplateId: string;
  salesChannelId: string;
  languageCode: string;
  currencyCode: string;
  priceListId: string | null;
  pricePresentation: 'net' | 'gross';
  taxCountry: string | null;
  selectionRule: ProductFeed['selectionRule'];
  scheduleCron: string | null;
  scheduleTimezone: string | null;
  enabled: boolean;
}

export interface CreatedFeed {
  feed: ProductFeed;
  token: { token: string; prefix: string; rotatedAt: Date };
}

export function makeCreateFeedCommand(values: FeedWriteValues): Command<CreatedFeed> {
  const issued = issueFeedToken();
  const rotatedAt = new Date();
  return {
    action: 'product_feeds.feed.create',
    objectType: 'product_feed',
    objectId: 'pending',
    run: async ({ em }) => {
      const feed = em.create(ProductFeed, {
        ...values,
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.prefix,
        tokenRotatedAt: rotatedAt,
      });
      await em.persistAndFlush(feed);
      return {
        result: { feed, token: { token: issued.token, prefix: issued.prefix, rotatedAt } },
        after: auditState(feed),
      };
    },
    event: (result) => ({
      eventName: 'product_feeds.feed_changed',
      payload: { ...envelope(), feedId: result.feed.id },
    }),
  };
}

export function makeUpdateFeedCommand(
  feedId: string,
  patch: Partial<FeedWriteValues>,
): Command<ProductFeed> {
  return {
    action: 'product_feeds.feed.update',
    objectType: 'product_feed',
    objectId: feedId,
    capture: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      return feed ? auditState(feed) : null;
    },
    run: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      if (!feed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
      Object.assign(feed, patch);
      feed.version += 1;
      await em.persistAndFlush(feed);
      return { result: feed, after: auditState(feed) };
    },
    event: (result) => ({
      eventName: 'product_feeds.feed_changed',
      payload: { ...envelope(), feedId: result.id },
    }),
  };
}

export function makeDeleteFeedCommand(feedId: string): Command<{ tokenHash: string | null }> {
  return {
    action: 'product_feeds.feed.delete',
    objectType: 'product_feed',
    objectId: feedId,
    capture: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      return feed ? auditState(feed) : null;
    },
    run: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      if (!feed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
      const tokenHash = feed.tokenHash ?? null;
      // Runs, issues and artefacts cascade in the database; the storage objects
      // are reclaimed by retention (FR-052). The pointers are cleared first so
      // the deferred FKs cannot block the delete.
      feed.publishedArtefactId = null;
      feed.currentRunId = null;
      feed.lastRunId = null;
      await em.persistAndFlush(feed);
      await em.removeAndFlush(feed);
      return { result: { tokenHash }, after: null };
    },
    event: () => ({
      eventName: 'product_feeds.feed_changed',
      payload: { ...envelope(), feedId },
    }),
  };
}

export function makeDuplicateFeedCommand(
  sourceId: string,
  values: { name: string; slug: string; languageCode?: string; currencyCode?: string },
): Command<CreatedFeed> {
  const issued = issueFeedToken();
  const rotatedAt = new Date();
  return {
    action: 'product_feeds.feed.duplicate',
    objectType: 'product_feed',
    objectId: sourceId,
    run: async ({ em }) => {
      const source = await em.findOne(ProductFeed, { id: sourceId });
      if (!source) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
      const copy = em.create(ProductFeed, {
        name: values.name,
        slug: values.slug,
        feedTemplateId: source.feedTemplateId,
        salesChannelId: source.salesChannelId,
        languageCode: values.languageCode ?? source.languageCode,
        currencyCode: values.currencyCode ?? source.currencyCode,
        priceListId: source.priceListId ?? null,
        pricePresentation: source.pricePresentation,
        taxCountry: source.taxCountry ?? null,
        selectionRule: source.selectionRule,
        scheduleCron: source.scheduleCron ?? null,
        scheduleTimezone: source.scheduleTimezone ?? null,
        enabled: source.enabled,
        // A copy gets its OWN token (FR-022): sharing one would make revoking
        // the original silently break the copy.
        tokenHash: issued.tokenHash,
        tokenPrefix: issued.prefix,
        tokenRotatedAt: rotatedAt,
      });
      await em.persistAndFlush(copy);
      return {
        result: { feed: copy, token: { token: issued.token, prefix: issued.prefix, rotatedAt } },
        after: auditState(copy),
      };
    },
    event: (result) => ({
      eventName: 'product_feeds.feed_changed',
      payload: { ...envelope(), feedId: result.feed.id },
    }),
  };
}

export interface RotatedToken {
  feed: ProductFeed;
  token: string;
  prefix: string;
  rotatedAt: Date;
  /** The hash being replaced, so the caller can drop its cache entry. */
  previousTokenHash: string | null;
}

export function makeRotateTokenCommand(feedId: string): Command<RotatedToken> {
  const issued = issueFeedToken();
  return {
    action: 'product_feeds.token.rotate',
    objectType: 'product_feed',
    objectId: feedId,
    capture: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      // Prefix and timestamps only — never the plaintext, never the hash.
      return feed
        ? { id: feed.id, tokenPrefix: feed.tokenPrefix ?? null, tokenRotatedAt: feed.tokenRotatedAt ?? null }
        : null;
    },
    run: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      if (!feed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
      const previousTokenHash = feed.tokenHash ?? null;
      const rotatedAt = new Date();
      feed.tokenHash = issued.tokenHash;
      feed.tokenPrefix = issued.prefix;
      feed.tokenRotatedAt = rotatedAt;
      feed.tokenRevokedAt = null;
      await em.persistAndFlush(feed);
      return {
        result: { feed, token: issued.token, prefix: issued.prefix, rotatedAt, previousTokenHash },
        after: { id: feed.id, tokenPrefix: issued.prefix, tokenRotatedAt: rotatedAt.toISOString() },
      };
    },
    event: (result) => ({
      eventName: 'product_feeds.token_rotated',
      payload: { ...envelope(), feedId: result.feed.id, previousTokenHash: result.previousTokenHash },
    }),
  };
}

export function makeRevokeTokenCommand(
  feedId: string,
): Command<{ feed: ProductFeed; previousTokenHash: string | null }> {
  return {
    action: 'product_feeds.token.revoke',
    objectType: 'product_feed',
    objectId: feedId,
    capture: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      return feed ? { id: feed.id, tokenPrefix: feed.tokenPrefix ?? null } : null;
    },
    run: async ({ em }) => {
      const feed = await em.findOne(ProductFeed, { id: feedId });
      if (!feed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
      const previousTokenHash = feed.tokenHash ?? null;
      const revokedAt = new Date();
      // The hash goes with it: a revoked feed must not be resolvable by any
      // token at all, not merely flagged as revoked.
      feed.tokenHash = null;
      feed.tokenRevokedAt = revokedAt;
      await em.persistAndFlush(feed);
      return {
        result: { feed, previousTokenHash },
        after: { id: feed.id, tokenPrefix: feed.tokenPrefix ?? null, tokenRevokedAt: revokedAt.toISOString() },
      };
    },
    event: (result) => ({
      eventName: 'product_feeds.token_rotated',
      payload: { ...envelope(), feedId: result.feed.id, previousTokenHash: result.previousTokenHash },
    }),
  };
}

/**
 * Records **who asked** for a manual generation. The work itself is enqueued;
 * a scheduled run deliberately records no command at all (research §R17).
 */
export function makeStartRunCommand(feedId: string): Command<FeedRun> {
  return {
    action: 'product_feeds.run.start',
    objectType: 'product_feed',
    objectId: feedId,
    run: async ({ em, actor }) => {
      const run = em.create(FeedRun, {
        productFeedId: feedId,
        trigger: 'manual',
        triggeredByAdminUserId: actor.actorAdminUserId,
        status: 'queued',
      });
      await em.persistAndFlush(run);
      return { result: run, after: { runId: run.id, productFeedId: feedId, trigger: 'manual' } };
    },
  };
}
