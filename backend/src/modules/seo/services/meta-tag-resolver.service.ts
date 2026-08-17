import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
  CmsPageReadPort,
  CmsPageRecord,
  ResolvedMeta,
  SeoEntityType,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { SeoMetaOverride } from '../entities/seo-meta-override.entity.js';

/**
 * MetaTagResolverService (T235 / FR-101).
 *
 * Resolution order:
 *   1. Look up the per-(entity, locale) override row.
 *   2. If a field is set on the override, use it verbatim.
 *   3. Otherwise fall back to the rule derived from the entity (Product
 *      name + description, Category name, etc.).
 *
 * Locale fallback: if no override exists for the requested locale, try
 * `en-US`, then return rule-only.
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

export interface RuleBuilderInput {
  product?: CatalogProductRecord;
  category?: CatalogCategoryRecord;
  cmsPage?: CmsPageRecord;
}

export class MetaTagResolverService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditLogService | undefined,
    /** The three rows a rule is derived from, asked of the modules that own them. */
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly catalogCategories: CatalogCategoryReadPort,
    private readonly cmsPages: CmsPageReadPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'seo_meta_override', objectId, stateBefore, stateAfter });
    }
  }

  async resolve(input: {
    entityType: SeoEntityType;
    entityId: string;
    locale: string;
  }): Promise<ResolvedMeta> {
    const em = this.emFactory();
    const ruleSource = await this.loadRuleSource(input.entityType, input.entityId);
    const rule = buildRuleMeta(input.entityType, ruleSource, input.locale);

    const override = await this.findOverride(em, input);
    if (!override) {
      return { ...rule, source: 'rule', locale: input.locale };
    }

    return {
      title: override.title ?? rule.title,
      description: override.description ?? rule.description,
      openGraph: {
        title: override.ogTitle ?? rule.openGraph.title,
        description: override.ogDescription ?? rule.openGraph.description,
        image: override.ogImageUrl ?? rule.openGraph.image,
      },
      source: 'override',
      locale: input.locale,
    };
  }

  async getOverride(input: {
    entityType: SeoEntityType;
    entityId: string;
    locale: string;
  }): Promise<SeoMetaOverride | null> {
    return this.findOverride(this.emFactory(), input);
  }

  async upsertOverride(input: {
    entityType: SeoEntityType;
    entityId: string;
    locale: string;
    title?: string | null;
    description?: string | null;
    ogTitle?: string | null;
    ogDescription?: string | null;
    ogImageUrl?: string | null;
  }): Promise<SeoMetaOverride> {
    const em = this.emFactory();
    // Validate the entity actually exists so an admin typo doesn't write a
    // dangling row.
    await this.loadRuleSource(input.entityType, input.entityId);

    const existing = await em.findOne(SeoMetaOverride, {
      entityType: input.entityType,
      entityId: input.entityId,
      locale: input.locale,
    });
    if (existing) {
      if (input.title !== undefined) existing.title = input.title;
      if (input.description !== undefined) existing.description = input.description;
      if (input.ogTitle !== undefined) existing.ogTitle = input.ogTitle;
      if (input.ogDescription !== undefined) existing.ogDescription = input.ogDescription;
      if (input.ogImageUrl !== undefined) existing.ogImageUrl = input.ogImageUrl;
      this.#audit(em, 'seo_meta_override.upsert', existing.id, null, { entityType: existing.entityType, entityId: existing.entityId, locale: existing.locale });
      await em.flush();
      return existing;
    }
    const row = em.create(SeoMetaOverride, {
      entityType: input.entityType,
      entityId: input.entityId,
      locale: input.locale,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.ogTitle !== undefined ? { ogTitle: input.ogTitle } : {}),
      ...(input.ogDescription !== undefined ? { ogDescription: input.ogDescription } : {}),
      ...(input.ogImageUrl !== undefined ? { ogImageUrl: input.ogImageUrl } : {}),
    });
    em.persist(row);
    this.#audit(em, 'seo_meta_override.upsert', row.id, null, { entityType: row.entityType, entityId: row.entityId, locale: row.locale });
    await em.flush();
    return row;
  }

  async deleteOverride(input: {
    entityType: SeoEntityType;
    entityId: string;
    locale: string;
  }): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(SeoMetaOverride, input);
    if (row) {
      this.#audit(em, 'seo_meta_override.delete', row.id, { entityType: row.entityType, entityId: row.entityId, locale: row.locale }, null);
      await em.removeAndFlush(row);
    }
  }

  private async findOverride(
    em: EntityManager,
    input: { entityType: SeoEntityType; entityId: string; locale: string },
  ): Promise<SeoMetaOverride | null> {
    return em.findOne(SeoMetaOverride, input);
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
    const name = pickLocale(source.product.name, locale);
    const description = pickLocale(source.product.description, locale);
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
