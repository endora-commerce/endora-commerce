import type { EntityManager } from '@mikro-orm/postgresql';
import type { CmsPageReadPort, CmsPageRecord } from '@b2b/contracts';
import { CmsPage } from '../entities/cms-page.entity.js';

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

  async listPublished(): Promise<CmsPageRecord[]> {
    const pages = await this.emFactory().find(
      CmsPage,
      { status: 'published' },
      { orderBy: { path: 'asc' } },
    );
    return pages.map(toCmsPageRecord);
  }
}

export function toCmsPageRecord(page: CmsPage): CmsPageRecord {
  return {
    id: page.id,
    path: page.path,
    status: page.status,
    title: page.title,
    metaTitle: page.metaTitle ?? null,
    metaDescription: page.metaDescription ?? null,
    metaKeywords: page.metaKeywords ?? null,
    publishedAt: page.publishedAt ?? null,
    archivedAt: page.archivedAt ?? null,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}
