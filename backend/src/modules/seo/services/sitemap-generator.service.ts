import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { Product } from '../../catalog/entities/product.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
import { CmsPage } from '../../cms/entities/cms-page.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import { SitemapCache } from '../entities/sitemap-cache.entity.js';

/**
 * SitemapGeneratorService — per-channel sitemap.
 *
 * One sitemap is produced per active Sales Channel. Membership-bridge
 * tables (`sales_channel_products`, `sales_channel_categories`,
 * `sales_channel_cms_pages`) decide what each channel's sitemap contains
 * so a crawler hitting `https://channel-a.example.com/sitemap.xml` does
 * not see URLs that only belong to channel B.
 *
 * Storefront origin used when stamping URLs is read from the per-channel
 * setting `sales_channels.storefront_url` (see the sales_channels module
 * manifest); empty value falls back to the `STOREFRONT_BASE_URL` env, then
 * to `http://localhost:3000`.
 *
 * Cache: one row per channel in `sitemap_cache`, keyed by the channel
 * `code` (varchar(32)). Regenerate is per-channel; the public route
 * resolves the channel from `request.salesChannel` and serves that row.
 *
 * Anonymous-visible only: products with `visibility != 'public'` and
 * archived/deleted rows are excluded so we don't leak internal SKUs into
 * crawlers.
 */

const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
const STOREFRONT_URL_SETTING = 'sales_channels.storefront_url';

export interface SitemapGeneratorOptions {
  /** Public origin used when no per-channel URL is configured. Defaults to env or localhost. */
  baseUrl?: string;
  /** How old the cache row may be before serve triggers a regenerate. */
  staleAfterMs?: number;
}

export interface SitemapStatus {
  generatedAt: Date | null;
  byteSize: number | null;
  urlCount: number | null;
}

export interface SitemapChannelStatus extends SitemapStatus {
  salesChannelCode: string;
  salesChannelName: string;
  storefrontUrl: string;
  storefrontUrlSource: 'setting' | 'env' | 'fallback';
}

/** Minimal port for the SettingsService — only the read we need. */
export interface SitemapSettingsPort {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
}

export class SitemapGeneratorService {
  private readonly fallbackBaseUrl: string;
  private readonly staleAfterMs: number;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settings: SitemapSettingsPort | null,
    options: SitemapGeneratorOptions = {},
  ) {
    this.fallbackBaseUrl =
      options.baseUrl ??
      process.env['STOREFRONT_BASE_URL'] ??
      'http://localhost:3000';
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  /**
   * Serve the sitemap for a single channel; regenerates inline when stale
   * or when no cache row exists yet.
   */
  async getOrGenerateForChannel(
    salesChannelCode: string,
  ): Promise<{ payload: string; generatedAt: Date }> {
    const em = this.emFactory();
    const cache = await em.findOne(SitemapCache, { key: salesChannelCode });
    if (cache && Date.now() - cache.generatedAt.getTime() < this.staleAfterMs) {
      return { payload: cache.payload, generatedAt: cache.generatedAt };
    }
    return this.regenerateForChannel(salesChannelCode);
  }

  async regenerateForChannel(
    salesChannelCode: string,
  ): Promise<{ payload: string; generatedAt: Date }> {
    const em = this.emFactory();
    const channel = await em.findOne(SalesChannel, { code: salesChannelCode });
    if (channel === null) {
      throw new Error(`Unknown sales channel code "${salesChannelCode}".`);
    }

    const baseUrl = await this.resolveStorefrontUrl(channel);
    const memberIds = await this.collectChannelMemberIds(em, channel.id);

    const products = memberIds.products.size
      ? await em.find(
          Product,
          {
            id: { $in: [...memberIds.products] },
            status: 'active',
            visibility: 'public',
            archivedAt: null,
            deletedAt: null,
          },
          { orderBy: { updatedAt: 'desc' } },
        )
      : [];
    const categories = memberIds.categories.size
      ? await em.find(
          Category,
          { id: { $in: [...memberIds.categories] }, deletedAt: null },
          { orderBy: { sortOrder: 'asc' } },
        )
      : [];
    const cmsPages = memberIds.cmsPages.size
      ? await em.find(
          CmsPage,
          {
            id: { $in: [...memberIds.cmsPages] },
            status: 'published',
            active: true,
          },
          { orderBy: { slug: 'asc' } },
        )
      : [];

    const urls: SitemapUrl[] = [];
    for (const c of categories) {
      urls.push({
        loc: `${baseUrl}/c/${c.slug}`,
        lastmod: c.updatedAt,
        changefreq: 'weekly',
        priority: 0.7,
      });
    }
    for (const page of cmsPages) {
      urls.push({
        loc: `${baseUrl}/${page.slug}`,
        lastmod: page.publishedAt ?? page.updatedAt,
        changefreq: 'monthly',
        priority: 0.5,
      });
    }
    for (const p of products) {
      urls.push({
        loc: `${baseUrl}/p/${p.slug}`,
        lastmod: p.updatedAt,
        changefreq: 'daily',
        priority: 0.8,
      });
    }
    const payload = renderSitemap(urls);
    const now = new Date();

    const cache = await em.findOne(SitemapCache, { key: salesChannelCode });
    if (cache) {
      cache.payload = payload;
      cache.urlCount = urls.length;
      cache.byteSize = Buffer.byteLength(payload, 'utf8');
      cache.generatedAt = now;
    } else {
      em.create(SitemapCache, {
        key: salesChannelCode,
        payload,
        urlCount: urls.length,
        byteSize: Buffer.byteLength(payload, 'utf8'),
        generatedAt: now,
      });
    }
    await em.flush();
    return { payload, generatedAt: now };
  }

  async getStatusForChannel(salesChannelCode: string): Promise<SitemapStatus> {
    const em = this.emFactory();
    const cache = await em.findOne(SitemapCache, { key: salesChannelCode });
    if (!cache) return { generatedAt: null, byteSize: null, urlCount: null };
    return {
      generatedAt: cache.generatedAt,
      byteSize: cache.byteSize,
      urlCount: cache.urlCount,
    };
  }

  /**
   * Per-channel admin overview: one row per active channel, with the
   * cache stats (or NULLs when never generated) and the resolved
   * storefront URL.
   */
  async listChannelStatuses(): Promise<SitemapChannelStatus[]> {
    const em = this.emFactory();
    const channels = await em.find(
      SalesChannel,
      { active: true },
      { orderBy: { systemDefault: 'desc', code: 'asc' } },
    );
    const out: SitemapChannelStatus[] = [];
    for (const channel of channels) {
      const cache = await em.findOne(SitemapCache, { key: channel.code });
      const { url, source } = await this.resolveStorefrontUrlSource(channel);
      out.push({
        salesChannelCode: channel.code,
        salesChannelName: pickName(channel),
        storefrontUrl: url,
        storefrontUrlSource: source,
        generatedAt: cache?.generatedAt ?? null,
        byteSize: cache?.byteSize ?? null,
        urlCount: cache?.urlCount ?? null,
      });
    }
    return out;
  }

  // --- internals -----------------------------------------------------------

  private async resolveStorefrontUrl(channel: SalesChannel): Promise<string> {
    const { url } = await this.resolveStorefrontUrlSource(channel);
    return trimTrailingSlash(url);
  }

  private async resolveStorefrontUrlSource(channel: SalesChannel): Promise<{
    url: string;
    source: 'setting' | 'env' | 'fallback';
  }> {
    if (this.settings) {
      try {
        const fromSetting = await this.settings.get(
          STOREFRONT_URL_SETTING,
          channel.id,
          z.string(),
        );
        if (fromSetting && fromSetting.trim() !== '') {
          return { url: fromSetting.trim(), source: 'setting' };
        }
      } catch {
        // Not registered or out of scope — fall through to env / fallback.
      }
    }
    const fromEnv = process.env['STOREFRONT_BASE_URL'];
    if (fromEnv && fromEnv.trim() !== '') {
      return { url: fromEnv.trim(), source: 'env' };
    }
    return { url: this.fallbackBaseUrl, source: 'fallback' };
  }

  private async collectChannelMemberIds(
    em: EntityManager,
    salesChannelId: string,
  ): Promise<{
    products: Set<string>;
    categories: Set<string>;
    cmsPages: Set<string>;
  }> {
    const conn = em.getConnection();
    const params = [salesChannelId];

    const productRows = (await conn.execute(
      `SELECT product_id FROM sales_channel_products WHERE sales_channel_id = ?`,
      params,
      'all',
    )) as Array<{ product_id: string }>;
    const categoryRows = (await conn.execute(
      `SELECT category_id FROM sales_channel_categories WHERE sales_channel_id = ?`,
      params,
      'all',
    )) as Array<{ category_id: string }>;
    const cmsPageRows = (await conn.execute(
      `SELECT cms_page_id FROM sales_channel_cms_pages WHERE sales_channel_id = ?`,
      params,
      'all',
    )) as Array<{ cms_page_id: string }>;

    return {
      products: new Set(productRows.map((r) => r.product_id)),
      categories: new Set(categoryRows.map((r) => r.category_id)),
      cmsPages: new Set(cmsPageRows.map((r) => r.cms_page_id)),
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

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function pickName(channel: SalesChannel): string {
  const map = channel.name ?? {};
  const codes: string[] = [];
  if (channel.defaultLanguage) codes.push(channel.defaultLanguage);
  codes.push('en', 'en-US', 'pl', 'pl-PL');
  for (const code of codes) {
    const v = map[code];
    if (typeof v === 'string' && v) return v;
  }
  for (const v of Object.values(map)) {
    if (typeof v === 'string' && v) return v;
  }
  return channel.code;
}
