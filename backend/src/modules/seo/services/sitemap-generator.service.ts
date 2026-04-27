import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../catalog/entities/product.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
import { CmsPage } from '../../cms_pages/entities/cms-page.entity.js';
import { SitemapCache } from '../entities/sitemap-cache.entity.js';

/**
 * SitemapGeneratorService (T235 / FR-102).
 *
 * Walks the published surface (active products, non-deleted categories)
 * and writes a `sitemapindex`/`urlset` payload to the singleton
 * `sitemap_cache` row. The public route serves the cached XML; if the row
 * is older than `staleAfterMs`, it regenerates inline.
 *
 * Anonymous-visible only: products with `visibility != 'public'` and
 * archived/deleted rows are excluded so we don't leak internal SKUs into
 * crawlers.
 */

const SITEMAP_KEY = 'default';
const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface SitemapGeneratorOptions {
  /** Public origin used when stamping URLs. Defaults to env or localhost. */
  baseUrl?: string;
  /** How old the cache row may be before serve triggers a regenerate. */
  staleAfterMs?: number;
}

export interface SitemapStatus {
  generatedAt: Date | null;
  byteSize: number | null;
  urlCount: number | null;
}

export class SitemapGeneratorService {
  private readonly baseUrl: string;
  private readonly staleAfterMs: number;

  constructor(
    private readonly emFactory: () => EntityManager,
    options: SitemapGeneratorOptions = {},
  ) {
    this.baseUrl =
      options.baseUrl ??
      process.env['STOREFRONT_BASE_URL'] ??
      'http://localhost:3000';
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  async getOrGenerate(): Promise<{ payload: string; generatedAt: Date }> {
    const em = this.emFactory();
    const cache = await em.findOne(SitemapCache, { key: SITEMAP_KEY });
    if (cache && Date.now() - cache.generatedAt.getTime() < this.staleAfterMs) {
      return { payload: cache.payload, generatedAt: cache.generatedAt };
    }
    return this.regenerate();
  }

  async regenerate(): Promise<{ payload: string; generatedAt: Date }> {
    const em = this.emFactory();
    const products = await em.find(
      Product,
      { status: 'active', visibility: 'public', archivedAt: null, deletedAt: null },
      { orderBy: { updatedAt: 'desc' } },
    );
    const categories = await em.find(
      Category,
      { deletedAt: null },
      { orderBy: { sortOrder: 'asc' } },
    );
    const cmsPages = await em.find(
      CmsPage,
      { status: 'published' },
      { orderBy: { path: 'asc' } },
    );

    const urls: SitemapUrl[] = [];
    for (const c of categories) {
      urls.push({
        loc: `${this.baseUrl}/c/${c.slug}`,
        lastmod: c.updatedAt,
        changefreq: 'weekly',
        priority: 0.7,
      });
    }
    for (const page of cmsPages) {
      urls.push({
        loc: `${this.baseUrl}/${page.path}`,
        lastmod: page.publishedAt ?? page.updatedAt,
        changefreq: 'monthly',
        priority: 0.5,
      });
    }
    for (const p of products) {
      urls.push({
        loc: `${this.baseUrl}/p/${p.slug}`,
        lastmod: p.updatedAt,
        changefreq: 'daily',
        priority: 0.8,
      });
    }
    const payload = renderSitemap(urls);
    const now = new Date();

    const cache = await em.findOne(SitemapCache, { key: SITEMAP_KEY });
    if (cache) {
      cache.payload = payload;
      cache.urlCount = urls.length;
      cache.byteSize = Buffer.byteLength(payload, 'utf8');
      cache.generatedAt = now;
    } else {
      em.create(SitemapCache, {
        key: SITEMAP_KEY,
        payload,
        urlCount: urls.length,
        byteSize: Buffer.byteLength(payload, 'utf8'),
        generatedAt: now,
      });
    }
    await em.flush();
    return { payload, generatedAt: now };
  }

  async getStatus(): Promise<SitemapStatus> {
    const em = this.emFactory();
    const cache = await em.findOne(SitemapCache, { key: SITEMAP_KEY });
    if (!cache) return { generatedAt: null, byteSize: null, urlCount: null };
    return {
      generatedAt: cache.generatedAt,
      byteSize: cache.byteSize,
      urlCount: cache.urlCount,
    };
  }
}

interface SitemapUrl {
  loc: string;
  lastmod: Date;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

function renderSitemap(urls: SitemapUrl[]): string {
  const items = urls.map(
    (u) =>
      `  <url><loc>${escapeXml(u.loc)}</loc><lastmod>${u.lastmod.toISOString()}</lastmod>` +
      `<changefreq>${u.changefreq}</changefreq><priority>${u.priority.toFixed(1)}</priority></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...items,
    '</urlset>',
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
