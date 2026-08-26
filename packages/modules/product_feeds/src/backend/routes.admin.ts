import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  ERROR_CODES,
  createProductFeedRequestSchema,
  duplicateProductFeedRequestSchema,
  feedRunIssueReasonSchema,
  listQuerySchema,
  productSelectionPreviewRequestSchema,
  updateProductFeedRequestSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { PRODUCT_FEEDS_READ_PERMISSION, PRODUCT_FEEDS_WRITE_PERMISSION } from '../manifest.js';
import { FeedArtefact } from './entities/feed-artefact.entity.js';
import { FeedRun } from './entities/feed-run.entity.js';
import { FeedRunIssue } from './entities/feed-run-issue.entity.js';
import type { ArtefactStorageBackend, ArtefactStorePort } from './services/artefact-store.js';
import type { FeedTokenCache } from './services/feed-cache-invalidator.js';
import type { ProductFeedService } from './services/product-feed.service.js';
import {
  ChannelUnavailableError,
  UnknownSelectionFieldError,
  type ProductSelectionService,
} from './services/product-selection.service.js';
import { toFeedDto, toRunDto } from './services/feed-dto.js';
import { artefactFilename } from './services/artefact-filename.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin HTTP surface for the Product Feed module — feature 067
 * (contracts/admin-feeds.md §1, admin-runs.md §1).
 *
 *   GET    /api/v1/admin/product-feeds
 *   POST   /api/v1/admin/product-feeds
 *   GET    /api/v1/admin/product-feeds/:id
 *   PATCH  /api/v1/admin/product-feeds/:id
 *   DELETE /api/v1/admin/product-feeds/:id
 *   POST   /api/v1/admin/product-feeds/:id/duplicate
 *   POST   /api/v1/admin/product-feeds/:id/generate
 *   POST   /api/v1/admin/product-feeds/:id/token/rotate
 *   POST   /api/v1/admin/product-feeds/:id/token/revoke
 *   GET    /api/v1/admin/product-feeds/:id/runs
 *   GET    /api/v1/admin/product-feeds/:id/runs/:runId
 *   GET    /api/v1/admin/product-feeds/:id/runs/:runId/issues
 *   GET    /api/v1/admin/product-feeds/:id/runs/:runId/issues/export
 *   GET    /api/v1/admin/product-feeds/:id/runs/:runId/artefact
 *   GET    /api/v1/admin/product-feeds/:id/artefact
 *   POST   /api/v1/admin/feed-previews/selection
 *
 * The feed-template surface lives in `routes.templates.ts`.
 *
 * **Downloads require `product_feeds:write`, not `:read`** (FR-051, US6 AS-7).
 * An artefact carries resolved prices for the whole selection; a read-only
 * operator can see that a run succeeded, and why items were skipped, without
 * being handed the priced catalogue.
 *
 * Every async handler `return`s its reply. `inject()` masks a missing return;
 * over a real socket the same handler crash-loops with `ERR_HTTP_HEADERS_SENT`.
 */

export interface ProductFeedsAdminRoutesDeps {
  requireAdmin: RequireAdminFactory;
  emFactory: () => EntityManager;
  feeds: ProductFeedService;
  selection: ProductSelectionService;
  artefactStore: ArtefactStorePort;
  tokenCache: FeedTokenCache;
  /** Enqueues the generation job. A no-op producer still answers 202 (FR-032). */
  enqueueRun: (input: { productFeedId: string; feedRunId: string }) => Promise<void>;
}

/** The contract caps the sample at ten; the criteria panel shows exactly that. */
const PREVIEW_SAMPLE_SIZE = 10;

const idParamsSchema = z.object({ id: z.string().uuid() });
const runParamsSchema = z.object({ id: z.string().uuid(), runId: z.string().uuid() });

/**
 * The issue filters (FR-054). Both are the contract's own enums, so an unknown
 * value is a `400` naming the field rather than a silently ignored parameter
 * that returns the unfiltered list — which reads as "no such problems exist".
 */
const issueQuerySchema = listQuerySchema.extend({
  severity: z.enum(['skip', 'warning']).optional(),
  reason: feedRunIssueReasonSchema.optional(),
});

/** The duplicate body: the contract's schema, with the slug pattern enforced. */
const duplicateFeedBodySchema = duplicateProductFeedRequestSchema.extend({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'invalid_slug')
    .max(160),
});

/**
 * A product name for the preview sample. The sample exists so an operator can
 * recognise what a rule selected, so any localized value beats an empty string;
 * the SKU is the last resort because it always identifies the row.
 */
function pickProductName(name: Record<string, string>, sku: string): string {
  const values = Object.values(name).filter((value) => value.trim() !== '');
  return name['en-US']?.trim() || values[0] || sku;
}

// Re-exported for `routes.public.ts`, which has imported it from here since
// feature 067. The mapping itself moved to `services/artefact-filename.ts` when
// delivery arrived: the name a partner's directory receives and the name a
// browser downloads have to be the same string.
export { extensionFor } from './services/artefact-filename.js';

/** Shared by the taxonomy routes so one shape of validation error is produced. */
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') || 'body';
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      `${path}: ${issue?.message ?? 'invalid'}`,
      { field: path },
    );
  }
  return parsed.data;
}

const parse = parseOrThrow;

export async function registerProductFeedsAdminRoutes(
  app: FastifyInstance,
  deps: ProductFeedsAdminRoutesDeps,
): Promise<void> {
  const read = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION) };
  const write = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_WRITE_PERMISSION) };

  // ---------------------------------------------------------------------------
  // Draft evaluation — the criteria match count (FR-028)
  //
  // Draft-shaped by construction: a channel and a rule, never a feed id, so the
  // count works on `/product-feeds/new` where no feed exists yet. It reads the
  // catalogue, so it needs `catalog:read` **in addition to**
  // `product_feeds:read` — an operator who cannot see products must not be able
  // to enumerate them a criterion at a time. Side-effect-free: no run, no
  // issue, no artefact, no Command, and deliberately no `withSystemScope`.
  // ---------------------------------------------------------------------------

  app.post(
    '/api/v1/admin/feed-previews/selection',
    { preHandler: [deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION), deps.requireAdmin('catalog:read')] },
    async (request, reply) => {
      const body = parse(productSelectionPreviewRequestSchema, request.body ?? {});
      const channel = await deps
        .emFactory()
        .findOne(SalesChannel, { id: body.salesChannelId });
      if (!channel || !channel.active) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sales channel not found.');
      }
      const scope = {
        salesChannelId: channel.id,
        selectionRule: body.selectionRule,
        // A draft has no price list and no chosen currency yet; the channel's
        // default is the only defensible basis for a price criterion, and it is
        // what a feed on this channel will carry unless the operator changes it.
        currencyCode: channel.defaultCurrency,
        priceListId: null,
      };
      try {
        const [matchedCount, sample] = await Promise.all([
          deps.selection.countProductIds(scope),
          deps.selection.sampleProducts(scope, PREVIEW_SAMPLE_SIZE),
        ]);
        return reply.send({
          data: {
            matchedCount,
            sample: sample.map((item) => ({
              id: item.id,
              sku: item.sku,
              name: pickProductName(item.name, item.sku),
            })),
          },
        });
      } catch (error) {
        // FR-029 surfaced where it is actionable: the operator is told which
        // criterion is broken while they are still editing it, rather than
        // discovering it as a failed run tomorrow morning.
        if (error instanceof UnknownSelectionFieldError) {
          throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, error.message, {
            field: 'selectionRule',
          });
        }
        if (error instanceof ChannelUnavailableError) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sales channel not found.');
        }
        throw error;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Feeds
  // ---------------------------------------------------------------------------

  app.get('/api/v1/admin/product-feeds', read, async (request, reply) => {
    const query = parse(listQuerySchema, request.query ?? {});
    const rows = await deps.feeds.listRows(query.limit);
    return reply.send({
      data: rows.map((row) => toFeedDto(row, deps.feeds)),
      pagination: { cursor: null, hasMore: false, limit: query.limit },
    });
  });

  app.post('/api/v1/admin/product-feeds', write, async (request, reply) => {
    const body = parse(createProductFeedRequestSchema, request.body ?? {});
    const created = await deps.feeds.create(body);
    const row = await deps.feeds.row(created.feed.id);
    return reply.status(201).send({
      data: {
        feed: toFeedDto(row, deps.feeds),
        issuedToken: {
          token: created.token.token,
          url: deps.feeds.publicUrlFor(created.feed, created.token.token),
          prefix: created.token.prefix,
          rotatedAt: created.token.rotatedAt.toISOString(),
        },
      },
    });
  });

  app.get('/api/v1/admin/product-feeds/:id', read, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const row = await deps.feeds.row(id);
    return reply.send({ data: toFeedDto(row, deps.feeds) });
  });

  app.patch('/api/v1/admin/product-feeds/:id', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(updateProductFeedRequestSchema, request.body ?? {});
    await deps.feeds.update(id, body);
    const row = await deps.feeds.row(id);
    return reply.send({ data: toFeedDto(row, deps.feeds) });
  });

  app.post('/api/v1/admin/product-feeds/:id/duplicate', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(duplicateFeedBodySchema, request.body ?? {});
    const created = await deps.feeds.duplicate(id, body);
    const row = await deps.feeds.row(created.feed.id);
    return reply.status(201).send({
      data: {
        feed: toFeedDto(row, deps.feeds),
        issuedToken: {
          token: created.token.token,
          url: deps.feeds.publicUrlFor(created.feed, created.token.token),
          prefix: created.token.prefix,
          rotatedAt: created.token.rotatedAt.toISOString(),
        },
      },
    });
  });

  app.delete('/api/v1/admin/product-feeds/:id', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const { tokenHash } = await deps.feeds.delete(id);
    // The link must stop serving now, not at the end of a cache TTL.
    if (tokenHash) await deps.tokenCache.drop(tokenHash);
    return reply.status(204).send();
  });

  app.post('/api/v1/admin/product-feeds/:id/generate', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const run = await deps.feeds.startManualRun(id);
    // Producer only: the work never runs inside the request (Principle X).
    await deps.enqueueRun({ productFeedId: id, feedRunId: run.id });
    return reply.status(202).send({ data: { runId: run.id, status: 'queued' } });
  });

  app.post('/api/v1/admin/product-feeds/:id/token/rotate', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const rotated = await deps.feeds.rotateToken(id);
    if (rotated.previousTokenHash) await deps.tokenCache.drop(rotated.previousTokenHash);
    return reply.send({
      data: {
        token: rotated.token,
        url: deps.feeds.publicUrlFor(rotated.feed, rotated.token),
        prefix: rotated.prefix,
        rotatedAt: rotated.rotatedAt.toISOString(),
      },
    });
  });

  app.post('/api/v1/admin/product-feeds/:id/token/revoke', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const revoked = await deps.feeds.revokeToken(id);
    if (revoked.previousTokenHash) await deps.tokenCache.drop(revoked.previousTokenHash);
    const row = await deps.feeds.row(id);
    return reply.send({ data: toFeedDto(row, deps.feeds) });
  });

  // ---------------------------------------------------------------------------
  // Runs and the published artefact
  // ---------------------------------------------------------------------------

  app.get('/api/v1/admin/product-feeds/:id/runs', read, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const query = parse(listQuerySchema, request.query ?? {});
    const em = deps.emFactory();
    const feed = await deps.feeds.getOrFail(id);
    const runs = await em.find(
      FeedRun,
      { productFeedId: id },
      { orderBy: { createdAt: 'desc' }, limit: query.limit },
    );
    const artefacts = await em.find(FeedArtefact, { productFeedId: id });
    return reply.send({
      data: runs.map((run) =>
        toRunDto(run, artefacts.find((a) => a.id === run.artefactId) ?? null, feed),
      ),
      pagination: { cursor: null, hasMore: false, limit: query.limit },
    });
  });

  app.get('/api/v1/admin/product-feeds/:id/runs/:runId', read, async (request, reply) => {
    const { id, runId } = parse(runParamsSchema, request.params);
    const em = deps.emFactory();
    const run = await em.findOne(FeedRun, { id: runId, productFeedId: id });
    if (!run) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed run not found.');
    const artefact = run.artefactId
      ? await em.findOne(FeedArtefact, { id: run.artefactId })
      : null;
    const feed = await deps.feeds.getOrFail(id);
    return reply.send({
      data: { ...toRunDto(run, artefact, feed), templateSnapshot: run.templateSnapshot ?? null },
    });
  });

  // ---------------------------------------------------------------------------
  // Per-item diagnostics (FR-054)
  //
  // The list is `:read` — a read-only operator has to be able to answer "why
  // were 61 products left out" without being handed the priced catalogue. The
  // export is `:write`, because a CSV of every SKU in the selection is the same
  // disclosure as the artefact by another route.
  // ---------------------------------------------------------------------------

  app.get('/api/v1/admin/product-feeds/:id/runs/:runId/issues', read, async (request, reply) => {
    const { id, runId } = parse(runParamsSchema, request.params);
    const query = parse(issueQuerySchema, request.query ?? {});
    const em = deps.emFactory();
    await requireRun(em, id, runId);
    const issues = await em.find(
      FeedRunIssue,
      {
        feedRunId: runId,
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.reason ? { reason: query.reason } : {}),
      },
      { orderBy: { reason: 'asc', createdAt: 'asc', id: 'asc' }, limit: query.limit },
    );
    return reply.send({
      data: issues.map(toIssueDto),
      pagination: { cursor: null, hasMore: false, limit: query.limit },
    });
  });

  app.get(
    '/api/v1/admin/product-feeds/:id/runs/:runId/issues/export',
    write,
    async (request, reply) => {
      const { id, runId } = parse(runParamsSchema, request.params);
      const em = deps.emFactory();
      const feed = await deps.feeds.getOrFail(id);
      await requireRun(em, id, runId);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Cache-Control', 'private, no-store')
        .header(
          'Content-Disposition',
          `attachment; filename="${feed.slug}-run-issues.csv"`,
        );
      // Streamed, and read in keyset pages: the cap bounds what is *recorded*,
      // not what an export may be asked for, and a thousand-row string built in
      // memory here would be the one place this module buffers.
      return reply.send(Readable.from(streamIssueCsv(em, runId)));
    },
  );

  // ---------------------------------------------------------------------------
  // Artefact downloads (FR-051) — `:write`, because a feed file carries prices
  // ---------------------------------------------------------------------------

  app.get('/api/v1/admin/product-feeds/:id/runs/:runId/artefact', write, async (request, reply) => {
    const { id, runId } = parse(runParamsSchema, request.params);
    const em = deps.emFactory();
    const feed = await deps.feeds.getOrFail(id);
    const run = await requireRun(em, id, runId);
    const artefact = run.artefactId
      ? await em.findOne(FeedArtefact, { id: run.artefactId, productFeedId: id })
      : null;
    if (!artefact) {
      // A skipped, failed or purged run has no file. A plain not-found beats
      // silently streaming the currently published one, which would tell the
      // operator this run produced something it did not.
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'This run produced no file.');
    }
    return sendArtefact(reply, feed.slug, artefact);
  });

  app.get('/api/v1/admin/product-feeds/:id/artefact', write, async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const feed = await deps.feeds.getOrFail(id);
    const artefact = feed.publishedArtefactId
      ? await deps.emFactory().findOne(FeedArtefact, { id: feed.publishedArtefactId })
      : null;
    if (!artefact) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'This feed has no published file yet.');
    }
    return sendArtefact(reply, feed.slug, artefact);
  });

  /** Shared by both download routes so their headers cannot drift apart. */
  async function sendArtefact(
    reply: FastifyReply,
    slug: string,
    artefact: FeedArtefact,
  ): Promise<FastifyReply> {
    const stream = await deps.artefactStore.open({
      backend: artefact.storageBackend as ArtefactStorageBackend,
      locator: artefact.storageLocator,
    });
    reply
      .header('Content-Type', artefact.contentType)
      .header('Content-Length', String(artefact.byteSize))
      .header('Cache-Control', 'private, no-store')
      .header(
        'Content-Disposition',
        `attachment; filename="${artefactFilename(slug, artefact.contentType)}"`,
      );
    return reply.send(stream);
  }
}

/** 404s a run id that is not this feed's, rather than leaking its existence. */
async function requireRun(em: EntityManager, feedId: string, runId: string): Promise<FeedRun> {
  const run = await em.findOne(FeedRun, { id: runId, productFeedId: feedId });
  if (!run) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed run not found.');
  return run;
}

function toIssueDto(issue: FeedRunIssue): Record<string, unknown> {
  return {
    id: issue.id,
    severity: issue.severity,
    reason: issue.reason,
    productId: issue.productId ?? null,
    variantId: issue.variantId ?? null,
    sku: issue.sku ?? null,
    outputName: issue.outputName ?? null,
    detail: issue.detail ?? null,
  };
}

/** RFC 4180 quoting, kept local: the whole file is seven short columns. */
function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const ISSUE_EXPORT_PAGE = 500;

/**
 * The full recorded issue list as CSV, one keyset page at a time.
 *
 * `em.clear()` per page for the same reason the generation pipeline does it:
 * without it MikroORM's identity map turns a streamed export into an in-memory
 * one at exactly the size where it matters.
 */
async function* streamIssueCsv(em: EntityManager, runId: string): AsyncGenerator<string> {
  yield 'severity,reason,sku,productId,variantId,outputName,detail\n';
  let cursor: string | null = null;
  for (;;) {
    const page: FeedRunIssue[] = await em.find(
      FeedRunIssue,
      { feedRunId: runId, ...(cursor ? { id: { $gt: cursor } } : {}) },
      { orderBy: { id: 'asc' }, limit: ISSUE_EXPORT_PAGE },
    );
    if (page.length === 0) return;
    for (const issue of page) {
      yield [
        csvCell(issue.severity),
        csvCell(issue.reason),
        csvCell(issue.sku),
        csvCell(issue.productId),
        csvCell(issue.variantId),
        csvCell(issue.outputName),
        csvCell(issue.detail),
      ].join(',');
      yield '\n';
    }
    cursor = page[page.length - 1]!.id;
    em.clear();
    if (page.length < ISSUE_EXPORT_PAGE) return;
  }
}
