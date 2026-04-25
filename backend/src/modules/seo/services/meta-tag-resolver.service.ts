import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { ResolvedMeta, SeoEntityType } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
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
 */

const FALLBACK_LOCALE = 'en-US';
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

export interface RuleBuilderInput {
  product?: Product;
  category?: Category;
}

export class MetaTagResolverService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolve(input: {
    entityType: SeoEntityType;
    entityId: string;
    locale: string;
  }): Promise<ResolvedMeta> {
    const em = this.emFactory();
    const ruleSource = await this.loadRuleSource(em, input.entityType, input.entityId);
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
    await this.loadRuleSource(em, input.entityType, input.entityId);

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
    await em.persistAndFlush(row);
    return row;
  }

  async deleteOverride(input: {
    entityType: SeoEntityType;
    entityId: string;
    locale: string;
  }): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(SeoMetaOverride, input);
    if (row) await em.removeAndFlush(row);
  }

  private async findOverride(
    em: EntityManager,
    input: { entityType: SeoEntityType; entityId: string; locale: string },
  ): Promise<SeoMetaOverride | null> {
    return em.findOne(SeoMetaOverride, input);
  }

  private async loadRuleSource(
    em: EntityManager,
    entityType: SeoEntityType,
    entityId: string,
  ): Promise<RuleBuilderInput> {
    if (entityType === 'product') {
      const product = await em.findOne(Product, { id: entityId });
      if (!product) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Product ${entityId} not found.`);
      }
      return { product };
    }
    if (entityType === 'category') {
      const category = await em.findOne(Category, { id: entityId });
      if (!category) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Category ${entityId} not found.`);
      }
      return { category };
    }
    // CMS pages have no module yet — rule falls back to a static stub but the
    // override path still works once a CMS row exists. For now reject so a
    // misconfigured admin cannot pin a stale override to a non-existent page.
    throw new HttpError(
      404,
      ERROR_CODES.NOT_FOUND,
      'CMS pages are not yet supported (cms module pending).',
    );
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
  return {
    title: '',
    description: '',
    openGraph: { title: '', description: '', image: null },
  };
}

function pickLocale(value: Record<string, string>, locale: string): string {
  return value[locale] ?? value[FALLBACK_LOCALE] ?? Object.values(value)[0] ?? '';
}

function trim(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd() + '…';
}
