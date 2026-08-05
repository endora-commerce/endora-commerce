import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type FeedItemGranularity,
  type FeedOutputFormat,
  type FeedRunIssueReason,
  type FeedTemplatePreviewRequest,
  type TaxonomyProviderCode,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { FeedTemplateField } from '../entities/feed-template-field.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import {
  buildLanguageChain,
  type FeedGenerationService,
  type FeedItemHydrationScope,
  type TaxonomyResolution,
} from './feed-generation.service.js';
import type {
  FeedItemSource,
  FeedResolutionContext,
  ItemFieldResolverPort,
  ResolvableTemplateField,
} from './item-field-resolver.interface.js';
import { DelimitedFeedSerializer } from './serializers/delimited-feed-serializer.js';
import { XmlFeedSerializer } from './serializers/xml-feed-serializer.js';

/**
 * The sample-product preview — feature 067 / FR-072, SC-013.
 *
 * The preview is the editor's teaching device: a merchandiser does not learn
 * what `availability` means by reading the word, they learn it by seeing
 * `in_stock` next to it, computed from a product they recognise. Three
 * properties follow from that and are the reason this service exists at all:
 *
 *  - **it evaluates the draft on screen**, not a persisted template. An
 *    operator mid-edit is exactly when feedback matters; forcing a save of a
 *    broken intermediate state to see a value would put SC-013 out of reach.
 *  - **it never fails over one bad binding.** A draft may name an attribute
 *    that does not exist — after an import, or two keystrokes into a rename.
 *    That is a field-level fact (`unbound: true`), not a request failure; a
 *    preview that 400s mid-typing is a preview nobody keeps open.
 *  - **it resolves through the same code the run does.** Values come from
 *    `FeedGenerationService.hydrateItems` and the same `ItemFieldResolver`, so
 *    a preview cannot promise something the file will not carry.
 *
 * It writes nothing: no run, no issue, no artefact, no audit entry, no cache
 * keyed by draft content. It is a `POST` because the body is a document.
 */

/** Source kinds whose binding is a definition key that may not exist locally. */
const KEYED_SOURCE_KINDS = new Set(['attribute', 'custom_field']);

export interface TemplatePreviewDeps {
  emFactory: () => EntityManager;
  generation: FeedGenerationService;
  resolver: ItemFieldResolverPort;
  listProductFieldKeys: () => Promise<Set<string>>;
  listActiveLanguages: () => Promise<
    Array<{ code: string; fallbackCode: string | null; isDefault: boolean }>
  >;
  loadTaxonomyResolution: (providerCode: TaxonomyProviderCode) => Promise<TaxonomyResolution>;
  storefrontOriginFor: (salesChannelId: string) => Promise<string>;
}

export interface PreviewFieldResult {
  outputName: string;
  value: string | null;
  resolvedFrom: 'source' | 'fallback' | 'omitted';
  wouldSkipItem: boolean;
  issueReason: FeedRunIssueReason | null;
  unbound: boolean;
  helpKey: string | null;
}

export interface PreviewResult {
  fields: PreviewFieldResult[];
  wouldEmitItem: boolean;
  skipReason: FeedRunIssueReason | null;
  renderedItem: string;
  resolvedContext: {
    salesChannelId: string;
    languageCode: string;
    currencyCode: string;
    priceListId: string | null;
    pricePresentation: 'net' | 'gross';
    taxCountry: string | null;
  };
}

export class TemplatePreviewService {
  constructor(private readonly deps: TemplatePreviewDeps) {}

  async preview(request: FeedTemplatePreviewRequest): Promise<PreviewResult> {
    const channel = await this.resolveChannel(request);
    const context = await this.resolveContext(request, channel);

    const draft = request.draft;
    const knownKeys = draft.fields.some((f) => KEYED_SOURCE_KINDS.has(f.sourceKind))
      ? await this.deps.listProductFieldKeys()
      : new Set<string>();

    // `helpKey`s the draft omits are inherited from the template it came from,
    // matched by output name — the gloss survives a reorder and a rebind, and
    // disappears only when the operator renames the field, which is the point
    // at which the platform no longer knows what the field means.
    const inheritedHelp = await this.inheritedHelpKeys(request.baseTemplateId);

    const item = await this.loadSampleItem(request, channel, draft, context);

    const fields: ResolvableTemplateField[] = draft.fields.map((field) => ({
      outputName: field.outputName,
      sourceKind: field.sourceKind,
      sourceKey: field.sourceKey ?? null,
      constantValue: field.constantValue ?? null,
      fallbackValue: field.fallbackValue ?? null,
      providerRequired: field.providerRequired ?? false,
      transform: field.transform ?? null,
      transformArg: field.transformArg ?? null,
    }));

    const whole = this.deps.resolver.resolve({ fields, item, context });

    const perField = fields.map((field, index) => {
      const source = draft.fields[index]!;
      const unbound =
        KEYED_SOURCE_KINDS.has(field.sourceKind) &&
        (!field.sourceKey || !knownKeys.has(field.sourceKey));

      // Resolved twice on purpose: once without the fallback, to find out
      // whether the source itself produced the value, and once as configured.
      // That is what lets the editor show "Empty — will send \"New\"" instead
      // of a value the operator cannot account for (ux-design §3.4).
      const withoutFallback = this.deps.resolver.resolve({
        fields: [{ ...field, fallbackValue: null }],
        item,
        context,
      });
      const asConfigured = this.deps.resolver.resolve({ fields: [field], item, context });

      const emitted = asConfigured.fields[0]?.value ?? null;
      const resolvedFrom: PreviewFieldResult['resolvedFrom'] =
        withoutFallback.fields.length > 0
          ? 'source'
          : emitted !== null
            ? 'fallback'
            : 'omitted';

      return {
        outputName: field.outputName,
        value: emitted,
        resolvedFrom,
        wouldSkipItem: asConfigured.skipped,
        issueReason: asConfigured.skipReason ?? asConfigured.issues[0]?.reason ?? null,
        unbound,
        helpKey: source.helpKey ?? inheritedHelp.get(field.outputName) ?? null,
      } satisfies PreviewFieldResult;
    });

    return {
      fields: perField,
      wouldEmitItem: !whole.skipped,
      skipReason: whole.skipReason,
      renderedItem: renderItem(draft.outputFormat, whole.fields, fields),
      resolvedContext: {
        salesChannelId: context.salesChannelId,
        languageCode: context.languageCode,
        currencyCode: context.currencyCode,
        priceListId: context.priceListId,
        pricePresentation: context.pricePresentation,
        taxCountry: context.taxCountry,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Context resolution — the server fills what the operator did not choose
  // -------------------------------------------------------------------------

  /**
   * Every id in the request is resolved through the ordinary reads (contract
   * §6.2): an id the caller cannot reach yields a not-found, never a partial
   * render, and `withSystemScope` is deliberately never used here.
   */
  private async resolveChannel(request: FeedTemplatePreviewRequest): Promise<SalesChannel> {
    const em = this.deps.emFactory();
    const feed = request.context.productFeedId
      ? await em.findOne(ProductFeed, { id: request.context.productFeedId })
      : null;
    if (request.context.productFeedId && !feed) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product feed not found.');
    }
    const explicitId = request.context.salesChannelId ?? feed?.salesChannelId ?? null;
    if (explicitId) {
      const channel = await em.findOne(SalesChannel, { id: explicitId });
      if (!channel) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Sales channel not found.');
      return channel;
    }
    const fallback = await em.findOne(
      SalesChannel,
      { active: true },
      { orderBy: { createdAt: 'asc' } },
    );
    if (!fallback) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        'There is no active sales channel to preview against.',
      );
    }
    return fallback;
  }

  private async resolveContext(
    request: FeedTemplatePreviewRequest,
    channel: SalesChannel,
  ): Promise<FeedResolutionContext> {
    const em = this.deps.emFactory();
    const feed = request.context.productFeedId
      ? await em.findOne(ProductFeed, { id: request.context.productFeedId })
      : null;

    const languageCode =
      request.context.languageCode ?? feed?.languageCode ?? channel.defaultLanguage;
    const currencyCode = (
      request.context.currencyCode ??
      feed?.currencyCode ??
      channel.defaultCurrency
    ).toUpperCase();
    const priceListId =
      request.context.priceListId !== undefined
        ? request.context.priceListId
        : (feed?.priceListId ?? null);
    const pricePresentation =
      request.context.pricePresentation ?? feed?.pricePresentation ?? 'net';
    const taxCountry =
      request.context.taxCountry?.toUpperCase() ?? feed?.taxCountry?.toUpperCase() ?? null;

    const languages = await this.deps.listActiveLanguages();
    return {
      languageCode,
      languageFallbacks: buildLanguageChain(languageCode, languages),
      currencyCode,
      pricePresentation,
      taxCountry,
      storefrontOrigin: await this.deps.storefrontOriginFor(channel.id),
      salesChannelId: channel.id,
      priceListId,
    };
  }

  private async inheritedHelpKeys(
    baseTemplateId: string | undefined,
  ): Promise<Map<string, string>> {
    if (!baseTemplateId) return new Map();
    const em = this.deps.emFactory();
    const template = await em.findOne(FeedTemplate, { id: baseTemplateId, deletedAt: null });
    if (!template) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Feed template not found.');
    const fields = await em.find(FeedTemplateField, { feedTemplateId: baseTemplateId });
    return new Map(
      fields
        .filter((field): field is FeedTemplateField & { helpKey: string } => !!field.helpKey)
        .map((field) => [field.outputName, field.helpKey]),
    );
  }

  // -------------------------------------------------------------------------
  // The sample item — hydrated by the generation pipeline, not by a copy of it
  // -------------------------------------------------------------------------

  private async loadSampleItem(
    request: FeedTemplatePreviewRequest,
    channel: SalesChannel,
    draft: FeedTemplatePreviewRequest['draft'],
    context: FeedResolutionContext,
  ): Promise<FeedItemSource> {
    const em = this.deps.emFactory();
    // The preview is evaluated in the channel the draft names, exactly as a run
    // would be; binding it here keeps that visible at the read
    // (`no-unscoped-channel-query`).
    const salesChannelId = channel.id;
    const product = await em.findOne(Product, { id: request.productId });
    if (!product) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product not found.');

    const bindsProviderCategory = draft.fields.some(
      (field) => field.sourceKind === 'provider_category',
    );
    const taxonomy =
      bindsProviderCategory && draft.taxonomyProviderCode
        ? await this.deps.loadTaxonomyResolution(draft.taxonomyProviderCode)
        : null;

    const scope: FeedItemHydrationScope = {
      salesChannelId,
      channelDefaultCurrency: channel.defaultCurrency,
      taxonomy,
      itemGranularity: draft.itemGranularity as FeedItemGranularity,
      context,
    };

    const items = await this.deps.generation.hydrateItems([product.id], scope);
    if (items.length === 0) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product not found.');
    }
    const chosen = request.variantId
      ? items.find((item) => item.variantId === request.variantId)
      : items[0];
    if (!chosen) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product variant not found.');
    }
    return chosen;
  }
}

/**
 * The item exactly as it would appear in the file (FR-075: the operator sees
 * the mechanics handled, never handles them). A delimited preview carries its
 * header row, because a bare CSV line is unreadable without one; an XML preview
 * carries the item element alone, because the RSS prologue is document framing
 * rather than anything about this product.
 */
function renderItem(
  outputFormat: FeedOutputFormat,
  emitted: ReadonlyArray<{ name: string; value: string }>,
  fields: ResolvableTemplateField[],
): string {
  if (outputFormat === 'xml') {
    return new XmlFeedSerializer({ title: '', link: '', description: '' }).item(emitted);
  }
  // An XLSX preview is rendered tab-separated on purpose. The preview answers
  // "which value lands in which column", and that layout is identical; the
  // alternative is showing the operator a fragment of a ZIP archive, which
  // answers nothing. The real file is still a genuine workbook.
  const serializer = new DelimitedFeedSerializer({
    columns: fields.map((field) => field.outputName),
    delimiter: outputFormat === 'csv' ? ',' : '\t',
  });
  return `${serializer.begin()}${serializer.item(emitted)}`;
}
