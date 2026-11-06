import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  isInsideWindow,
  isProductVisibleTo,
  channelUrlLanguages,
  cmsLocalizedPage,
  productPath,
  storefrontPagePath,
  type CatalogProductAvailabilityPort,
  type CatalogProductUrlKeyReadPort,
  type CatalogCategoryReadPort,
  type CatalogProductReadPort,
  type ChannelMemberEntityType,
  type CmsPageReadPort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SitemapCache } from '../entities/sitemap-cache.entity.js';
import type { StorefrontAddressService } from './storefront-address.service.js';
import { UnknownSalesChannelError } from './crawler-file-preview.service.js';

/**
 * SitemapGeneratorService — per-channel sitemap.
 *
 * One sitemap is produced per active Sales Channel. Membership-bridge
 * tables (`sales_channel_products`, `sales_channel_categories`,
 * `sales_channel_cms_pages`) decide what each channel's sitemap contains
 * so a crawler hitting `https://channel-a.example.com/sitemap.xml` does
 * not see URLs that only belong to channel B.
 *
 * Storefront origin used when stamping URLs is `StorefrontAddressService`'s
 * answer for the channel: the per-channel setting
 * `sales_channels.storefront_url` (see the sales_channels module manifest),
 * then the `STOREFRONT_BASE_URL` env, then a fallback.
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

export class SitemapGeneratorService {
  private readonly staleAfterMs: number;

  constructor(
    private readonly emFactory: () => EntityManager,
    /** Where each channel's storefront is; the last rung is `options.baseUrl`. */
    private readonly storefrontAddress: StorefrontAddressService,
    /** What this channel contains, and what those rows are (feature 075, Phase C). */
    private readonly membership: SalesChannelMembershipPort,
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly catalogCategories: CatalogCategoryReadPort,
    private readonly cmsPages: CmsPageReadPort,
    /**
     * Feature 163 — `catalog`'s availability projection for the channel: the
     * languages each member is on in, its effective window and its effective
     * audience. A sitemap lists what an anonymous crawler may open, now.
     */
    private readonly availability: Pick<CatalogProductAvailabilityPort, 'describeChannelAvailability'>,
    /**
     * Feature 163 (R28, FR-074) — `catalog`'s effective URL key per channel
     * language: a product's URL in a language is its key there, not its global
     * key (a key is valid only in its own language, K1).
     */
    private readonly urlKeys: Pick<CatalogProductUrlKeyReadPort, 'effectiveKeys'>,
    options: SitemapGeneratorOptions = {},
  ) {
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
      // Typed, so the admin routes answer it `404` rather than `500` (issue #793).
      throw new UnknownSalesChannelError(salesChannelCode);
    }

    const baseUrl = await this.resolveStorefrontUrl(channel);
    const memberIds = await this.collectChannelMemberIds(channel.id);

    // Feature 163 — which members are available to an anonymous crawler in
    // which channel language, now, is `catalog`'s answer
    // (`describeChannelAvailability`): on in that language (archived and
    // deleted products are on in none), inside the effective publication
    // window at generation time, and admitted by the channel-effective
    // audience rule for the anonymous audience (issue #227: a `public`
    // product with an allow-list is not public). No status is tested here
    // (FR-002), so `activeOnly` is gone from the read: a product off globally
    // and on in this channel is listed. One URL per live language (FR-074).
    const productIds = [...memberIds.products];
    const generatedFor = new Date();
    const availability = await this.availability.describeChannelAvailability(productIds, channel.id);
    const products = (await this.catalogProducts.findByIds(productIds, { liveOnly: true }))
      .filter((p) => {
        const a = availability.get(p.id);
        return (
          a !== undefined &&
          a.liveLanguages.length > 0 &&
          isInsideWindow(a.window, generatedFor) &&
          isProductVisibleTo(a.audience, ANONYMOUS_PRODUCT_AUDIENCE)
        );
      })
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

    const keys = products.length === 0 ? new Map<string, Map<string, string>>() : await this.urlKeys.effectiveKeys(
      products.map((p) => p.id),
      channel.id,
    );

    // Feature 167 (FR-032) — one URL per channel language, under that language's
    // path prefix (or none for the unprefixed default); categories and CMS pages
    // share one slug across languages, so each is listed once per language.
    const channelLanguages = channelUrlLanguages(channel).map((l) => l.languageCode);
    const pageUrl = (path: string, languageCode: string): string =>
      `${baseUrl}${storefrontPagePath({ path, languageCode, channel })}`;
    const urls: SitemapUrl[] = [];
    for (const c of categories) {
      for (const languageCode of channelLanguages) {
        urls.push({
          loc: pageUrl(`/c/${c.slug}`, languageCode),
          lastmod: c.updatedAt,
          changefreq: 'weekly',
          priority: 0.7,
        });
      }
    }
    for (const page of cmsPages) {
      // A page is listed in the languages it has content in that the channel serves;
      // a record that names none is listed in every channel language.
      const own = page.languages ?? [];
      const languages =
        own.length === 0
          ? channelLanguages
          : channelLanguages.filter((code) => own.some((l) => l.toLowerCase() === code.toLowerCase()));
      for (const languageCode of languages) {
        // 163 R24 — each language at its own slug.
        const slug = cmsLocalizedPage(
          { name: page.name, slug: page.slug, languages: own, translations: page.translations ?? null },
          languageCode,
        ).slug;
        urls.push({
          loc: pageUrl(`/${slug}`, languageCode),
          lastmod: page.publishedAt ?? page.updatedAt,
          changefreq: 'monthly',
          priority: 0.5,
        });
      }
    }
    for (const p of products) {
      // One URL per live language (FR-074), each on the product's effective key
      // in that language; `productPath` is the one place a product URL is composed.
      const productKeys = keys.get(p.id);
      for (const languageCode of availability.get(p.id)?.liveLanguages ?? []) {
        const key = productKeys?.get(languageCode) ?? p.slug;
        urls.push({
          // Feature 167 — under the language's path prefix, never `?lang=`.
          loc: `${baseUrl}${productPath({ key, languageCode, channel })}`,
          lastmod: p.updatedAt,
          changefreq: 'daily',
          priority: 0.8,
        });
      }
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

  /**
   * Feature 163 (security review, carry 4) — a product's availability changed in
   * a way a sitemap lists: its scoped status, its publication window (the window
   * sweep announces each bound it crosses), its audience or its URL keys. Every
   * channel's cached document is marked stale, so the next serve regenerates it
   * instead of advertising — for up to the staleness window — a URL that no
   * longer opens, or omitting one that just started to. Which channels the
   * product is in is not asked: the regeneration is lazy and per channel.
   */
  async markAllStale(): Promise<void> {
    // command-coverage-ignore: a derived cache's staleness stamp — no operator
    // write, nothing to audit; the document is rebuilt from catalog's answer.
    await this.emFactory().nativeUpdate(SitemapCache, {}, { generatedAt: new Date(0) });
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
      const { url, source } = await this.storefrontAddress.resolve(channel.id);
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
    const { url } = await this.storefrontAddress.resolve(channel.id);
    return trimTrailingSlash(url);
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
