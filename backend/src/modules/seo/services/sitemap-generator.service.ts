import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type {
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  ChannelMemberEntityType,
  CmsPageReadPort,
} from '@b2b/contracts';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
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
 * resolves the channel from the request scope and serves that row.
 *
 * Anonymous-visible only: products with `visibility != 'public'` and
 * archived/deleted rows are excluded so we don't leak internal SKUs into
 * crawlers.
 *
 * Feature 075, Phase C — the three entity reads go through their owners'
 * published read ports and the membership lookup through
 * `salesChannelMembershipPort`, which is the sanctioned bridge accessor of
 * Constitution XII. Both were the same defect in two disguises: the entity
 * reads were imports no gate can reach, and the membership read was three
 * hand-written `SELECT`s against `sales_channel_products`,
 * `sales_channel_categories` and `sales_channel_cms_pages` — which
 * `check-module-boundary` cannot see at all, because raw SQL names no
 * specifier. `catalog` and `cms` are binding dependencies: a sitemap that
 * silently drops every product URL still parses as a sitemap, which is exactly
 * why it must not be produced.
 */

const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
const STOREFRONT_URL_SETTING = 'sales_channels.storefront_url';
/** How many member ids one bridge read fetches. The port's own default is 100. */
const MEMBERSHIP_PAGE_SIZE = 500;

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
    /** What this channel contains, and what those rows are (feature 075, Phase C). */
    private readonly membership: SalesChannelMembershipPort,
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly catalogCategories: CatalogCategoryReadPort,
    private readonly cmsPages: CmsPageReadPort,
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
    // command-coverage-ignore: idempotent lifecycle reconciler/seed — a system-
    // invariant repair, not an operator-initiated audited write.
    const em = this.emFactory();
    const channel = await em.findOne(SalesChannel, { code: salesChannelCode });
    if (channel === null) {
      throw new Error(`Unknown sales channel code "${salesChannelCode}".`);
    }

    const baseUrl = await this.resolveStorefrontUrl(channel);
    const memberIds = await this.collectChannelMemberIds(channel.id);

    // Each read keeps the filter and the ordering the SQL spelled. `liveOnly`
    // and `activeOnly` are the port's names for the `deleted_at is null` and
    // `status = 'active'` halves; `visibility`, `archivedAt`, `isActive` and
    // `active` are columns on the records, so those predicates stay here — the
    // same conditions, evaluated one layer up.
    const products = (
      await this.catalogProducts.findByIds([...memberIds.products], {
        liveOnly: true,
        activeOnly: true,
      })
    )
      .filter((p) => p.visibility === 'public' && p.archivedAt === null)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Feature 068 — a deactivated category is not a customer-reachable URL, so
    // it must not be advertised to crawlers.
    const categories = (
      await this.catalogCategories.findByIds([...memberIds.categories], { liveOnly: true })
    )
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const cmsPages = (await this.cmsPages.findByIds([...memberIds.cmsPages]))
      .filter((page) => page.status === 'published' && page.active)
      .sort((a, b) => a.slug.localeCompare(b.slug));

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

  /**
   * What belongs to this channel, through the sanctioned bridge accessor
   * (Constitution XII). This was three hand-written `SELECT`s against
   * `sales_channel_products`, `sales_channel_categories` and
   * `sales_channel_cms_pages` — the tables `SalesChannelMembershipPort`'s own
   * doc comment says a module must not reach for, and the one cross-module
   * read in this file that `check-module-boundary` could never have found,
   * because raw SQL names no import specifier.
   */
  private async collectChannelMemberIds(salesChannelId: string): Promise<{
    products: Set<string>;
    categories: Set<string>;
    cmsPages: Set<string>;
  }> {
    const [products, categories, cmsPages] = await Promise.all([
      this.allMemberIds(salesChannelId, 'product'),
      this.allMemberIds(salesChannelId, 'category'),
      this.allMemberIds(salesChannelId, 'cms-page'),
    ]);
    return { products, categories, cmsPages };
  }

  /**
   * Every member id, not the first page of them. `listEntityIdsForChannel` is
   * paginated and defaults to 100; a sitemap wants the channel's whole
   * catalogue, so the pages are walked to `total`. `total` is re-read on each
   * call and the loop is bounded by it, so a concurrent membership write
   * cannot spin it.
   */
  private async allMemberIds(
    salesChannelId: string,
    entityType: ChannelMemberEntityType,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    for (let page = 0; ; page += 1) {
      const { entityIds, total } = await this.membership.listEntityIdsForChannel(
        salesChannelId,
        entityType,
        page,
        MEMBERSHIP_PAGE_SIZE,
      );
      for (const id of entityIds) ids.add(id);
      if (entityIds.length === 0 || ids.size >= total) return ids;
    }
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
