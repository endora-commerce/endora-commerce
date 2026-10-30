import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, resolveScoped, toScopeChannel } from '@endora-commerce/contracts';
import type { ScopeRef, ScopedFieldView, ScopedRow } from '@endora-commerce/contracts';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
  CmsPageReadPort,
  CmsPageRecord,
  ResolvedMeta,
  SeoEntityType,
  SeoProductMetaField,
  SeoProductMetaPort,
  SeoProductMetaSource,
  SeoProductMetaValues,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SeoMetaOverride } from '../entities/seo-meta-override.entity.js';
import {
  makeDeleteSeoMetaOverrideCommand,
  makeUpsertSeoMetaOverrideCommand,
  seoMetaOverrideWhere,
  type SeoMetaOverrideAddress,
  type SeoMetaOverrideFields,
} from '../commands/seo-meta-override.commands.js';

/**
 * MetaTagResolverService (T235 / FR-101; feature 163, R13).
 *
 * Resolution order, per field:
 *   1. the override row at the request's scope — for a product read at a sales
 *      channel and language, channel × language → channel → language;
 *   2. otherwise the rule derived from the entity (Product name + description,
 *      Category name, etc.).
 *
 * There is no cross-language fallback: an override of one language never answers
 * for another. A request naming neither a channel nor a locale is the `en-US`
 * language row, as before feature 163.
 *
 * Writes run as Commands (`seo_meta_override.upsert` / `.delete`) through the
 * Command Bus — one audit entry per request with the full row before and after
 * (Constitution XIII, analyze C1).
 *
 * The three rule sources arrive over their owners' published read ports
 * (feature 075, Phase C) rather than out of `catalog`'s and `cms`' tables.
 * Both edges fail closed, which is the answer a meta tag should get: the tags
 * describe a page a customer can reach, and a switched-off `catalog` or `cms`
 * means there is no such page to describe.
 */

const FALLBACK_LOCALE = 'en-US';
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

const FIELDS: readonly SeoProductMetaField[] = ['title', 'description', 'ogTitle', 'ogDescription', 'ogImageUrl'];

export interface RuleBuilderInput {
  product?: CatalogProductRecord;
  category?: CatalogCategoryRecord;
  cmsPage?: CmsPageRecord;
}

/** What a request names: a channel, a locale, both, or neither (= `en-US`). */
export interface SeoMetaScopeRequest {
  entityType: SeoEntityType;
  entityId: string;
  channelId?: string | null | undefined;
  locale?: string | null | undefined;
}

function sameLanguage(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * The address a request names. Neither half keeps today's meaning, the `en-US`
 * language row; a channel is a product's alone (`422 VALIDATION_FAILED`).
 */
export function seoMetaAddress(request: SeoMetaScopeRequest): SeoMetaOverrideAddress {
  const channelId = request.channelId ?? null;
  const locale = request.locale ?? null;
  if (channelId !== null && request.entityType !== 'product') {
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Only a product takes a sales channel scope.', {
      field: 'channelId',
    });
  }
  return {
    entityType: request.entityType,
    entityId: request.entityId,
    channelId,
    locale: channelId === null && locale === null ? FALLBACK_LOCALE : locale,
  };
}

/** The override rows that apply at (channel, language), most specific first. */
function scopeChain(
  rows: readonly SeoMetaOverride[],
  channelId: string | null,
  languageCode: string,
): Array<{ row: SeoMetaOverride; source: Exclude<SeoProductMetaSource, 'derived'> }> {
  const chain: Array<{ row: SeoMetaOverride; source: Exclude<SeoProductMetaSource, 'derived'> }> = [];
  if (channelId !== null) {
    const cxl = rows.find((r) => r.salesChannelId === channelId && sameLanguage(r.locale ?? null, languageCode));
    if (cxl) chain.push({ row: cxl, source: 'set' });
    const c = rows.find((r) => r.salesChannelId === channelId && (r.locale ?? null) === null);
    if (c) chain.push({ row: c, source: 'inherited_channel' });
  }
  // Feature 168 (FR-010) — the Global row, never a Language-only one. 168-shim: the empty override
  // (`''`) → derived value rule of round 6 is T121's.
  const g = rows.find((r) => (r.salesChannelId ?? null) === null && (r.locale ?? null) === null);
  if (g) chain.push({ row: g, source: 'inherited_global' });
  return chain;
}

/** Each field from the most specific row that sets it, else the fallback (FR-075). */
export function walkSeoScopes(
  rows: readonly SeoMetaOverride[],
  channelId: string | null,
  languageCode: string,
  fallback: SeoProductMetaValues,
): SeoProductMetaValues & { sources: Record<SeoProductMetaField, SeoProductMetaSource> } {
  const chain = scopeChain(rows, channelId, languageCode);
  const values = { ...fallback };
  const sources = {} as Record<SeoProductMetaField, SeoProductMetaSource>;
  for (const field of FIELDS) {
    const hit = chain.find(({ row }) => row[field] != null);
    sources[field] = hit ? hit.source : 'derived';
    if (hit) (values as Record<SeoProductMetaField, string | null>)[field] = hit.row[field] ?? null;
  }
  return { ...values, sources };
}

export class MetaTagResolverService implements SeoProductMetaPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Every override write is a Command on the bus (Constitution XIII). */
    private readonly commandBus: CommandBus,
    /** The three rows a rule is derived from, asked of the modules that own them. */
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly catalogCategories: CatalogCategoryReadPort,
    private readonly cmsPages: CmsPageReadPort,
    /** A product's channels and their languages, for the FR-014 check of a scoped write. */
    private readonly membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>,
  ) {}

  async resolve(input: SeoMetaScopeRequest): Promise<ResolvedMeta> {
    return (await this.resolveWithSources(input)).resolved;
  }

  /**
   * {@link resolve} plus, per field, the scope its value comes from — what the admin
   * meta editor shows beside each resolved value (feature 163, T126).
   */
  async resolveWithSources(
    input: SeoMetaScopeRequest,
  ): Promise<{ resolved: ResolvedMeta; sources: Record<SeoProductMetaField, SeoProductMetaSource> }> {
    const address = seoMetaAddress(input);
    const locale = address.locale ?? FALLBACK_LOCALE;
    const ruleSource = await this.loadRuleSource(input.entityType, input.entityId);
    const rule = buildRuleMeta(input.entityType, ruleSource, locale);
    const rows = await this.emFactory().find(SeoMetaOverride, {
      entityType: input.entityType,
      entityId: input.entityId,
    });
    const walked = walkSeoScopes(rows, address.channelId, locale, {
      title: rule.title,
      description: rule.description,
      ogTitle: rule.openGraph.title,
      ogDescription: rule.openGraph.description,
      ogImageUrl: rule.openGraph.image,
    });
    return {
      resolved: {
        title: walked.title,
        description: walked.description,
        openGraph: { title: walked.ogTitle, description: walked.ogDescription, image: walked.ogImageUrl },
        source: FIELDS.some((field) => walked.sources[field] !== 'derived') ? 'override' : 'rule',
        locale,
      },
      sources: walked.sources,
    };
  }

  /** The row at exactly the requested address, or `null`. */
  async getOverride(input: SeoMetaScopeRequest): Promise<SeoMetaOverride | null> {
    return this.emFactory().findOne(SeoMetaOverride, seoMetaOverrideWhere(seoMetaAddress(input)));
  }

  async upsertOverride(input: SeoMetaScopeRequest & SeoMetaOverrideFields): Promise<SeoMetaOverride> {
    const address = seoMetaAddress(input);
    // Validate the entity actually exists so an admin typo doesn't write a
    // dangling row.
    await this.loadRuleSource(input.entityType, input.entityId);
    const scoped = await this.#checkScope(address);
    const existing = await this.emFactory().findOne(SeoMetaOverride, seoMetaOverrideWhere(scoped));
    return this.commandBus.run(
      makeUpsertSeoMetaOverrideCommand({
        address: scoped,
        existingId: existing?.id ?? null,
        fields: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.ogTitle !== undefined ? { ogTitle: input.ogTitle } : {}),
          ...(input.ogDescription !== undefined ? { ogDescription: input.ogDescription } : {}),
          ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
        },
      }),
    );
  }

  /**
   * Removes the addressed row. No scope check: removing an override whose channel
   * the product left, or whose language the channel dropped, is always allowed
   * (FR-015).
   */
  async deleteOverride(input: SeoMetaScopeRequest): Promise<void> {
    const address = seoMetaAddress(input);
    const existing = await this.emFactory().findOne(SeoMetaOverride, seoMetaOverrideWhere(address));
    await this.commandBus.run(makeDeleteSeoMetaOverrideCommand({ address, existingId: existing?.id ?? null }));
  }

  // --- seoProductMetaPort (feature 163, R13) -------------------------------

  async resolveForProduct(input: {
    productId: string;
    channelId: string;
    languageCode: string;
    fallback: SeoProductMetaValues;
  }): Promise<SeoProductMetaValues & { sources: Record<SeoProductMetaField, SeoProductMetaSource> }> {
    const rows = await this.emFactory().find(SeoMetaOverride, {
      entityType: 'product',
      entityId: input.productId,
      $or: [{ salesChannelId: input.channelId }, { salesChannelId: null }],
    });
    return walkSeoScopes(rows, input.channelId, input.languageCode, input.fallback);
  }

  /**
   * Feature 168 (`contracts/seo-ports.md` §1) — each field's view at one scope.
   * 168-shim: no scope validation (`422 SCOPE_INVALID`) yet — T121's.
   */
  async readScoped(productId: string, scope: ScopeRef): Promise<Record<SeoProductMetaField, ScopedFieldView<string>>> {
    const rows = await this.emFactory().find(SeoMetaOverride, { entityType: 'product', entityId: productId });
    const global = rows.find((r) => (r.salesChannelId ?? null) === null && (r.locale ?? null) === null);
    const out = {} as Record<SeoProductMetaField, ScopedFieldView<string>>;
    for (const field of FIELDS) {
      const scoped: ScopedRow<string>[] = rows.flatMap((r) => {
        const value = r[field];
        if (r.salesChannelId == null || value == null) return [];
        return [
          {
            channelId: r.salesChannelId,
            languageCode: r.locale ?? null,
            value: value === '' ? { kind: 'empty' as const } : { kind: 'value' as const, value },
          },
        ];
      });
      const resolved = resolveScoped<string>({
        global: global?.[field] || null,
        rows: scoped,
        scope,
        levels: ['G', 'C', 'CL'],
      });
      out[field] = { ...resolved, levels: ['G', 'C', 'CL'], supportedHere: true, required: false };
    }
    return out;
  }

  async listScopesForProduct(
    productId: string,
  ): Promise<Array<{ channelId: string | null; languageCode: string | null; fields: SeoProductMetaField[] }>> {
    const rows = await this.emFactory().find(
      SeoMetaOverride,
      { entityType: 'product', entityId: productId },
      { orderBy: { salesChannelId: 'asc', locale: 'asc' } },
    );
    return rows.map((row) => ({
      channelId: row.salesChannelId ?? null,
      languageCode: row.locale ?? null,
      fields: FIELDS.filter((field) => row[field] != null),
    }));
  }

  /**
   * FR-014 for a write naming a channel: the product is a member of it, and the
   * locale (when named) is one the channel offers — answered in the channel's own
   * spelling. A language row is checked by nothing beyond today's rules.
   */
  async #checkScope(address: SeoMetaOverrideAddress): Promise<SeoMetaOverrideAddress> {
    if (address.channelId === null) return address;
    const channels = await this.membership.listChannelsForEntity('product', address.entityId);
    const channel = channels.find((c) => c.id === address.channelId);
    if (!channel) {
      throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The product is not a member of this sales channel.', {
        channelId: address.channelId,
        reason: 'not_a_member',
      });
    }
    if (address.locale === null) return address;
    const offered = toScopeChannel(channel).languages.find((code) => sameLanguage(code, address.locale!));
    if (offered === undefined) {
      throw new HttpError(422, ERROR_CODES.SCOPE_INVALID, 'The sales channel does not offer this language.', {
        channelId: address.channelId,
        languageCode: address.locale,
        reason: 'language_not_offered',
      });
    }
    return { ...address, locale: offered };
  }

  private async loadRuleSource(
    entityType: SeoEntityType,
    entityId: string,
  ): Promise<RuleBuilderInput> {
    if (entityType === 'product') {
      const product = await this.catalogProducts.findById(entityId);
      if (!product) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Product ${entityId} not found.`);
      }
      return { product };
    }
    if (entityType === 'category') {
      // Feature 068 — meta tags describe a page a customer can reach: a
      // deactivated (or deleted, never filtered here before) category has none.
      // `liveOnly` is the port's name for the `deletedAt: null` half; `isActive`
      // is a column on the record, so the other half stays a test here.
      const category = await this.catalogCategories.findById(entityId, { liveOnly: true });
      if (!category || !category.isActive) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Category ${entityId} not found.`);
      }
      return { category };
    }
    if (entityType === 'cms_page') {
      const cmsPage = await this.cmsPages.findById(entityId);
      if (!cmsPage) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `CMS page ${entityId} not found.`);
      }
      return { cmsPage };
    }
    // Exhaustiveness — every branch in `seoEntityTypeSchema` is handled above.
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Unknown entity type ${String(entityType)}.`);
  }
}

export function buildRuleMeta(
  entityType: SeoEntityType,
  source: RuleBuilderInput,
  locale: string,
): { title: string; description: string; openGraph: ResolvedMeta['openGraph'] } {
  if (entityType === 'product' && source.product) {
    // 168-shim: the Global texts; the derived fallback at (C, L) through `effectiveTexts` is T121's.
    const name = source.product.name;
    const description = source.product.description ?? '';
    return {
      title: trim(name, TITLE_MAX),
      description: trim(description, DESCRIPTION_MAX),
      openGraph: {
        title: trim(name, TITLE_MAX),
        description: trim(description, DESCRIPTION_MAX),
        image: null,
      },
    };
  }
  if (entityType === 'category' && source.category) {
    const name = pickLocale(source.category.name, locale);
    const description = `Browse ${trim(name, 80)}.`;
    return {
      title: trim(name, TITLE_MAX),
      description,
      openGraph: {
        title: trim(name, TITLE_MAX),
        description,
        image: null,
      },
    };
  }
  if (entityType === 'cms_page' && source.cmsPage) {
    // Feature 014 — meta fields are per-language; fall back to the
    // admin-facing `name` for title when no localized meta is set.
    const title =
      pickLocale(source.cmsPage.metaTitle ?? null, locale) || source.cmsPage.name;
    const description = pickLocale(source.cmsPage.metaDescription ?? null, locale);
    return {
      title: trim(title, TITLE_MAX),
      description: trim(description, DESCRIPTION_MAX),
      openGraph: {
        title: trim(title, TITLE_MAX),
        description: trim(description, DESCRIPTION_MAX),
        image: null,
      },
    };
  }
  return {
    title: '',
    description: '',
    openGraph: { title: '', description: '', image: null },
  };
}

function pickLocale(
  value: Record<string, string> | null | undefined,
  locale: string,
): string {
  if (!value) return '';
  return value[locale] ?? value[FALLBACK_LOCALE] ?? Object.values(value)[0] ?? '';
}

function trim(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd() + '…';
}
