import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_FEED_ERROR_CODES,
  type CreateProductFeedRequest,
  type DuplicateProductFeedRequest,
  type UpdateProductFeedRequest,
} from '@b2b/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { HttpError } from '../../../http/error-envelope.js';
import { Language } from '../../languages/entities/language.entity.js';
import { PriceList } from '../../price_lists/entities/price-list.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { FeedArtefact } from '../entities/feed-artefact.entity.js';
import { FeedRun } from '../entities/feed-run.entity.js';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { FeedTemplateField } from '../entities/feed-template-field.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import { isValidCronExpression, isValidTimezone } from './cron-expression.js';
import {
  makeCreateFeedCommand,
  makeDeleteFeedCommand,
  makeDuplicateFeedCommand,
  makeRevokeTokenCommand,
  makeRotateTokenCommand,
  makeStartRunCommand,
  makeUpdateFeedCommand,
  type CreatedFeed,
  type FeedWriteValues,
  type RotatedToken,
} from '../commands/product-feed.commands.js';

/**
 * Feed CRUD — feature 067 / FR-019, FR-021–FR-023, FR-059.
 *
 * Every write goes through `CommandBus.run` (Principle XIII), so this service
 * validates and orchestrates but never writes directly and never calls the
 * audit writer.
 *
 * The validation here is the whole reason the surface exists: a feed's bindings
 * are checked against **live data** — an active language, a currency the
 * channel actually carries, a template that exists — rather than a static enum,
 * because the failure mode of getting this wrong is a provider ingesting
 * wrong-currency prices for a week before anyone notices.
 */

export interface ProductFeedServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** Absolute origin the public feed URL is built on; empty ⇒ a path-only URL. */
  publicBaseUrl: string;
}

/** Thrown as `400 VALIDATION_FAILED`, naming the offending field (contract §2). */
function fieldError(field: string, message: string): HttpError {
  return new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `${field}: ${message}`, {
    field,
  });
}

export class ProductFeedService {
  constructor(private readonly deps: ProductFeedServiceDeps) {}

  /** The absolute public URL of a feed. `feed` is accepted so an overlay can
   *  build a per-channel origin without changing every call site. */
  publicUrlFor(_feed: ProductFeed, token: string): string {
    const base = this.deps.publicBaseUrl.replace(/\/+$/, '');
    return `${base}/api/v1/public/product-feeds/${token}`;
  }

  async getOrFail(feedId: string): Promise<ProductFeed> {
    const feed = await this.deps.emFactory().findOne(ProductFeed, { id: feedId });
    if (!feed) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
    return feed;
  }

  // -------------------------------------------------------------------------
  // Validation (contract admin-feeds.md §2)
  // -------------------------------------------------------------------------

  private async validateBindings(
    values: Partial<FeedWriteValues>,
    current?: ProductFeed,
  ): Promise<void> {
    const em = this.deps.emFactory();

    const templateId = values.feedTemplateId ?? current?.feedTemplateId;
    if (values.feedTemplateId !== undefined) {
      const template = await em.findOne(FeedTemplate, {
        id: values.feedTemplateId,
        deletedAt: null,
      });
      if (!template) throw fieldError('feedTemplateId', 'no such feed template');
    }
    if (!templateId) throw fieldError('feedTemplateId', 'is required');

    const channelId = values.salesChannelId ?? current?.salesChannelId;
    let channel: SalesChannel | null = null;
    if (values.salesChannelId !== undefined) {
      channel = await em.findOne(SalesChannel, { id: values.salesChannelId });
      if (!channel) throw fieldError('salesChannelId', 'no such sales channel');
    } else if (channelId) {
      channel = await em.findOne(SalesChannel, { id: channelId });
    }

    if (values.languageCode !== undefined) {
      const language = await em.findOne(Language, { code: values.languageCode });
      if (!language || !language.isActive) {
        throw fieldError('languageCode', 'is not an active language on this installation');
      }
    }

    const currencyCode = values.currencyCode ?? current?.currencyCode;
    if (values.currencyCode !== undefined && channel) {
      // The channel's currencies live as a JSONB array, so this is validated
      // rather than foreign-keyed (data-model §3).
      const currencies = channel.currencies ?? [];
      const allowed = currencies.length > 0 ? currencies : [channel.defaultCurrency];
      if (!allowed.includes(String(currencyCode))) {
        throw fieldError('currencyCode', `is not offered by this sales channel (${allowed.join(', ')})`);
      }
    }

    if (values.priceListId) {
      const list = await em.findOne(PriceList, { id: values.priceListId });
      if (!list) throw fieldError('priceListId', 'no such price list');
    }

    const presentation = values.pricePresentation ?? current?.pricePresentation ?? 'gross';
    const taxCountry =
      values.taxCountry !== undefined ? values.taxCountry : (current?.taxCountry ?? null);
    if (presentation === 'gross' && !taxCountry) {
      throw fieldError('taxCountry', 'is required when prices are gross');
    }

    const cron = values.scheduleCron !== undefined ? values.scheduleCron : (current?.scheduleCron ?? null);
    const tz =
      values.scheduleTimezone !== undefined
        ? values.scheduleTimezone
        : (current?.scheduleTimezone ?? null);
    if ((cron === null) !== (tz === null)) {
      throw fieldError('schedule', 'needs both a cron expression and a timezone, or neither');
    }
    // The contract's regex is grammatical only, so `60 * * * *` reaches here.
    // Refusing it now is the difference between an operator seeing an error and
    // an operator seeing a saved schedule that silently never fires (FR-031).
    if (cron !== null && !isValidCronExpression(cron)) {
      throw fieldError('schedule', 'is not a valid 5-field cron expression');
    }
    if (tz !== null && !isValidTimezone(tz)) {
      throw fieldError('schedule', 'names a timezone this installation does not know');
    }

    if (values.slug !== undefined) {
      const clash = await em.findOne(ProductFeed, { slug: values.slug });
      if (clash && clash.id !== current?.id) {
        throw fieldError('slug', 'is already used by another feed');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Writes — every one a Command
  // -------------------------------------------------------------------------

  async create(request: CreateProductFeedRequest): Promise<CreatedFeed> {
    const values = toWriteValues(request);
    await this.validateBindings(values);
    return this.deps.commandBus.run(makeCreateFeedCommand(values));
  }

  async update(feedId: string, request: UpdateProductFeedRequest): Promise<ProductFeed> {
    const current = await this.getOrFail(feedId);
    const patch = toPartialWriteValues(request);
    await this.validateBindings(patch, current);
    return this.deps.commandBus.run(makeUpdateFeedCommand(feedId, patch));
  }

  async duplicate(
    feedId: string,
    request: DuplicateProductFeedRequest,
  ): Promise<CreatedFeed> {
    await this.getOrFail(feedId);
    const em = this.deps.emFactory();
    if (await em.findOne(ProductFeed, { slug: request.slug })) {
      throw fieldError('slug', 'is already used by another feed');
    }
    return this.deps.commandBus.run(
      makeDuplicateFeedCommand(feedId, {
        name: request.name,
        slug: request.slug,
        ...(request.languageCode !== undefined ? { languageCode: request.languageCode } : {}),
        ...(request.currencyCode !== undefined ? { currencyCode: request.currencyCode } : {}),
      }),
    );
  }

  async delete(feedId: string): Promise<{ tokenHash: string | null }> {
    await this.getOrFail(feedId);
    return this.deps.commandBus.run(makeDeleteFeedCommand(feedId));
  }

  async rotateToken(feedId: string): Promise<RotatedToken> {
    await this.getOrFail(feedId);
    return this.deps.commandBus.run(makeRotateTokenCommand(feedId));
  }

  async revokeToken(
    feedId: string,
  ): Promise<{ feed: ProductFeed; previousTokenHash: string | null }> {
    await this.getOrFail(feedId);
    return this.deps.commandBus.run(makeRevokeTokenCommand(feedId));
  }

  /**
   * Creates the `queued` run row and returns it. The caller enqueues the job;
   * the work never runs inline (FR-032).
   *
   * Two refusals happen before anything is written: a disabled feed, and a
   * template with unbound fields (FR-016) — both are configuration problems the
   * operator must fix, not run failures they should discover later.
   */
  async startManualRun(feedId: string): Promise<FeedRun> {
    const feed = await this.getOrFail(feedId);
    if (!feed.enabled) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_FEED_DISABLED,
        'This feed is disabled. Enable it before generating.',
        { reason: PRODUCT_FEED_ERROR_CODES.FEED_DISABLED },
      );
    }
    const unbound = await this.deps
      .emFactory()
      .find(FeedTemplateField, { feedTemplateId: feed.feedTemplateId, unbound: true });
    if (unbound.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_FEED_TEMPLATE_UNBOUND,
        `These template fields are not bound to anything: ${unbound
          .map((f) => f.outputName)
          .join(', ')}.`,
        {
          reason: PRODUCT_FEED_ERROR_CODES.UNBOUND_TEMPLATE_FIELDS,
          outputNames: unbound.map((f) => f.outputName),
        },
      );
    }
    return this.deps.commandBus.run(makeStartRunCommand(feedId));
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * The list row (FR-055) — everything the page shows, assembled from a bounded
   * number of batch reads rather than one query per row.
   */
  async listRows(limit: number): Promise<ProductFeedRow[]> {
    const em = this.deps.emFactory();
    const feeds = await em.find(
      ProductFeed,
      {},
      { orderBy: { createdAt: 'desc' }, limit },
    );
    return this.decorate(feeds);
  }

  async row(feedId: string): Promise<ProductFeedRow> {
    const feed = await this.getOrFail(feedId);
    const [row] = await this.decorate([feed]);
    return row!;
  }

  private async decorate(feeds: ProductFeed[]): Promise<ProductFeedRow[]> {
    if (feeds.length === 0) return [];
    const em = this.deps.emFactory();
    const templates = await em.find(FeedTemplate, {
      id: { $in: [...new Set(feeds.map((f) => f.feedTemplateId))] },
    });
    const channels = await em.find(SalesChannel, {
      id: { $in: [...new Set(feeds.map((f) => f.salesChannelId))] },
    });
    const runIds = feeds.map((f) => f.lastRunId).filter((id): id is string => !!id);
    const runs = runIds.length ? await em.find(FeedRun, { id: { $in: runIds } }) : [];
    const artefactIds = feeds
      .map((f) => f.publishedArtefactId)
      .filter((id): id is string => !!id);
    const artefacts = artefactIds.length
      ? await em.find(FeedArtefact, { id: { $in: artefactIds } })
      : [];

    const templateById = new Map(templates.map((t) => [t.id, t]));
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const runById = new Map(runs.map((r) => [r.id, r]));
    const artefactById = new Map(artefacts.map((a) => [a.id, a]));

    return feeds.map((feed) => {
      const lastRun = feed.lastRunId ? runById.get(feed.lastRunId) : undefined;
      const artefact = feed.publishedArtefactId
        ? artefactById.get(feed.publishedArtefactId)
        : undefined;
      return {
        feed,
        templateName: templateById.get(feed.feedTemplateId)?.name ?? '',
        channelCode: channelById.get(feed.salesChannelId)?.code ?? '',
        lastRun: lastRun ?? null,
        publishedArtefact: artefact ?? null,
      };
    });
  }
}

export interface ProductFeedRow {
  feed: ProductFeed;
  templateName: string;
  channelCode: string;
  lastRun: FeedRun | null;
  publishedArtefact: FeedArtefact | null;
}

function toWriteValues(request: CreateProductFeedRequest): FeedWriteValues {
  return {
    name: request.name,
    slug: request.slug,
    feedTemplateId: request.feedTemplateId,
    salesChannelId: request.salesChannelId,
    languageCode: request.languageCode,
    currencyCode: request.currencyCode.toUpperCase(),
    priceListId: request.priceListId ?? null,
    pricePresentation: request.pricePresentation,
    taxCountry: request.taxCountry ? request.taxCountry.toUpperCase() : null,
    selectionRule: request.selectionRule,
    scheduleCron: request.schedule?.cron ?? null,
    scheduleTimezone: request.schedule?.timezone ?? null,
    enabled: request.enabled,
  };
}

function toPartialWriteValues(request: UpdateProductFeedRequest): Partial<FeedWriteValues> {
  const patch: Partial<FeedWriteValues> = {};
  if (request.name !== undefined) patch.name = request.name;
  if (request.slug !== undefined) patch.slug = request.slug;
  if (request.feedTemplateId !== undefined) patch.feedTemplateId = request.feedTemplateId;
  if (request.salesChannelId !== undefined) patch.salesChannelId = request.salesChannelId;
  if (request.languageCode !== undefined) patch.languageCode = request.languageCode;
  if (request.currencyCode !== undefined) patch.currencyCode = request.currencyCode.toUpperCase();
  if (request.priceListId !== undefined) patch.priceListId = request.priceListId ?? null;
  if (request.pricePresentation !== undefined) patch.pricePresentation = request.pricePresentation;
  if (request.taxCountry !== undefined) {
    patch.taxCountry = request.taxCountry ? request.taxCountry.toUpperCase() : null;
  }
  if (request.selectionRule !== undefined) patch.selectionRule = request.selectionRule;
  if (request.enabled !== undefined) patch.enabled = request.enabled;
  if (request.schedule !== undefined) {
    patch.scheduleCron = request.schedule?.cron ?? null;
    patch.scheduleTimezone = request.schedule?.timezone ?? null;
  }
  return patch;
}
