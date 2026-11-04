import type { EntityManager } from '@mikro-orm/postgresql';
import { firstSlugSegment } from '@endora-commerce/contracts';
import type {
  CmsPageReadPort,
  CmsPageRecord,
  CmsPageStorefrontLink,
  CmsPageStorefrontLinkScope,
} from '@endora-commerce/contracts';
import { CmsPage } from '../entities/cms-page.entity.js';
import { loadChannelPageNodes, pageStorefrontLinks } from './page-paths.js';

/**
 * The page read model `cms` publishes (feature 075, Phase P).
 *
 * `seo` is the only consumer, and it reads pages twice: to resolve one page's
 * meta tags, and to enumerate the published ones for the sitemap.
 *
 * The `body` and `content` columns do not survive the mapping. A sitemap and a
 * meta-tag resolver have no use for a page's rendered tree, and shipping it
 * would make every sitemap build carry the whole CMS through memory.
 */
export class CmsPageReadService implements CmsPageReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findById(id: string): Promise<CmsPageRecord | null> {
    const page = await this.emFactory().findOne(CmsPage, { id });
    return page ? toCmsPageRecord(page) : null;
  }

  async findByPath(path: string): Promise<CmsPageRecord | null> {
    const page = await this.emFactory().findOne(CmsPage, { path });
    return page ? toCmsPageRecord(page) : null;
  }

  async findByIds(ids: readonly string[]): Promise<CmsPageRecord[]> {
    if (ids.length === 0) return [];
    const pages = await this.emFactory().find(CmsPage, { id: { $in: [...ids] } });
    return pages.map(toCmsPageRecord);
  }

  async listPublished(): Promise<CmsPageRecord[]> {
    const pages = await this.emFactory().find(
      CmsPage,
      { status: 'published' },
      { orderBy: { path: 'asc' } },
    );
    return pages.map(toCmsPageRecord);
  }

  /**
   * Feature 168 — the channel's page tree and the pages' names, two reads
   * however many links a menu holds.
   */
  async findStorefrontLinks(
    ids: readonly string[],
    scope: CmsPageStorefrontLinkScope,
  ): Promise<CmsPageStorefrontLink[]> {
    if (ids.length === 0) return [];
    const em = this.emFactory();
    const [nodes, pages] = await Promise.all([
      loadChannelPageNodes(em, [scope.salesChannelId]),
      em.find(CmsPage, { id: { $in: [...ids] } }),
    ]);
    return pageStorefrontLinks(
      nodes,
      pages.map((page) => ({
        id: page.id,
        name: page.name,
        slug: page.slug,
        description: page.description ?? null,
        languages: page.languages,
        translations: page.translations,
      })),
      ids,
      scope,
    );
  }

  /**
   * Feature 171 — every first slug segment the channel's pages hold, in every
   * language, lower-cased. A page served under its parent's path has its parent's
   * first segment, and the parent is a page of the channel too.
   */
  async firstSegmentsInChannel(salesChannelId: string): Promise<string[]> {
    const rows = (await this.emFactory().execute(
      `select p.slug, p.translations
         from cms_pages p
         join cms_page_sales_channels s on s.page_id = p.id
        where s.sales_channel_id = ?`,
      [salesChannelId],
    )) as Array<{ slug: string; translations: Record<string, { slug?: string | null }> | null }>;
    const segments = new Set<string>();
    for (const row of rows) {
      const slugs = [row.slug, ...Object.values(row.translations ?? {}).map((t) => t?.slug ?? '')];
      for (const slug of slugs) {
        const segment = firstSlugSegment(slug ?? '');
        if (segment.length > 0) segments.add(segment);
      }
    }
    return [...segments];
  }
}

export function toCmsPageRecord(page: CmsPage): CmsPageRecord {
  return {
    id: page.id,
    path: page.path,
    slug: page.slug,
    status: page.status,
    name: page.name,
    active: page.active,
    title: page.title,
    metaTitle: page.metaTitle ?? null,
    metaDescription: page.metaDescription ?? null,
    metaKeywords: page.metaKeywords ?? null,
    publishedAt: page.publishedAt ?? null,
    archivedAt: page.archivedAt ?? null,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    parentPageId: page.parentPageId ?? null,
    // Feature 167 — the sitemap lists a page under each of its languages' prefixes.
    languages: [...(page.languages ?? [])],
    // 163 R24 — each language's own slug, for the sitemap.
    translations: page.translations ?? {},
  };
}
