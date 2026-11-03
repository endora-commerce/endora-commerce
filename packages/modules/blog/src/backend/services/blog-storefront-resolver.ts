import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  BlogBySlugResponse,
  BlogCategoryTile,
  BlogIndexResponse,
  BlogPagination,
  BlogPostCard,
  BlogPostStatus,
  BlogProductCard,
  BlogResolvedCategory,
  BlogResolvedPost,
  BlogResolvedTagRef,
  BlogTagByCodeResponse,
} from '@endora-commerce/contracts';
import { blogDefaultPath, blogPath, resolveScopeLanguage, type BlogAlternates } from '@endora-commerce/contracts';
import { effectiveKeys, resolveBlogKey, type BlogEntityRef } from './blog-url-keys.js';
import type { ResolvedBlogSettings } from './blog-settings-resolver.js';
import type { BlogAuthors } from './blog-authors.js';
import { BlogCacheService } from './blog-cache.js';
import type { BlogSettingsResolver } from './blog-settings-resolver.js';

/**
 * Cross-module surfaces the storefront resolver delegates to. Each is a
 * narrow port (Constitution I) — the resolver does not import the
 * upstream module's internals.
 */
/**
 * Feature 171 (US3, FR-020) — a post or a category exists in a language when that
 * language is assigned to it; every storefront read asks it, with the request
 * language already matched to one of the channel's (`resolveScopeLanguage`).
 */
const POST_IN_LANGUAGE = `exists (select 1 from blog_post_languages bpl
           where bpl.blog_post_id = p.id and lower(bpl.language) = lower(?))`;
// A category assigned no language at all — the seeded system `Default` — is in every one.
const CATEGORY_IN_LANGUAGE = `(not exists (select 1 from blog_category_languages bcl0 where bcl0.blog_category_id = c.id)
           or exists (select 1 from blog_category_languages bcl
           where bcl.blog_category_id = c.id and lower(bcl.language) = lower(?)))`;

export interface BlogStorefrontDeps {
  /**
   * Resolves a Library Asset id to a CDN-ready URL. Returns null when
   * the asset is missing, soft-deleted, or otherwise unavailable.
   */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  /**
   * Resolves a Catalog Product id to a card payload (or null when the
   * product is soft-deleted / out-of-channel — handled at the upstream
   * port, not here). Optional: when omitted, `relatedProducts` is empty.
   *
   * @deprecated Since issue #590 — no composition in this repository ever
   * passed it, and the storefront no longer reads what it produces. The post
   * payload names its related products in `relatedProductIds`, and the
   * storefront reads them from the catalogue listing as the viewer. A card
   * made here is cached for every visitor, so it must never carry a
   * buyer-specific figure. Kept for one minor release so a deployment that
   * passes it still compiles.
   */
  resolveProductCard?: (
    productId: string,
    salesChannelId: string,
    language: string,
  ) => Promise<BlogProductCard | null>;
  /**
   * Feature 171 — whether `seo` is effectively present: a former key redirects only
   * then, as a former product key does (163 Q-C). Absent → no redirects.
   */
  seoPresent?: () => boolean;
  /** Feature 171 (US7) — the posts' authors, filled per request after the cache. */
  authors?: BlogAuthors;
}

type ChannelRow = {
  id: string;
  code: string;
  default_language: string;
};

/**
 * The already-resolved sales channel handed down from the route layer
 * (feature 053). Mirrors the shape of the sales-channel resolver's
 * `CachedChannel`; the resolver has already refused inactive/unknown
 * channels upstream, so no re-query or active check is needed here.
 */
export type ResolvedChannel = {
  id: string;
  code: string;
  defaultLanguage: string;
  /** The channel's languages and prefix setting — the URL facts `blogPath` composes with (feature 171). */
  languages: readonly string[];
  prefixDefaultLanguage: boolean;
};

/**
 * The blog paths of one (channel, language) — every URL a payload carries is built
 * here, through `blogPath` (feature 171, FR-002).
 */
type BlogUrls = {
  index(): string;
  entry(key: string): string;
  tag(code: string): string;
};

function toChannelRow(channel: ResolvedChannel): ChannelRow {
  return { id: channel.id, code: channel.code, default_language: channel.defaultLanguage };
}

type PostRow = {
  id: string;
  slug: string;
  name: Record<string, string>;
  status: BlogPostStatus;
  active: boolean;
  published_at: Date | string | null;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  content: { schema_version?: number; languages?: Record<string, unknown> } | null;
  main_image_asset_id: string | null;
  author_admin_user_id?: string | null;
};

type CategoryRow = {
  id: string;
  slug: string;
  name: Record<string, string>;
  enabled: boolean;
  parent_id: string | null;
  position: number;
  main_image_asset_id: string | null;
  description:
    | { schema_version?: number; languages?: Record<string, unknown> }
    | null;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
};

/**
 * BlogStorefrontResolver — feature 016 / T051.
 *
 * Three read endpoints behind `/api/v1/blog/**`:
 *
 *   getIndex         → BlogIndexResponse (latest N + first-level categories)
 *   getBySlug        → BlogBySlugResponse discriminated by `kind`
 *   getTagByCode     → BlogTagByCodeResponse paginated
 *
 * Every method:
 *   - reads the channel-resolved blog settings via BlogSettingsResolver;
 *   - returns null (the route maps to 404) when blog.enabled = false;
 *   - applies the platform-wide language-fallback rule (feature 005)
 *     via the `pickLanguage` helper;
 *   - wraps results in BlogCacheService when Redis is wired.
 */
export class BlogStorefrontResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly settingsResolver: BlogSettingsResolver,
    private readonly deps: BlogStorefrontDeps = {},
    private readonly cache?: BlogCacheService,
  ) {}

  async getIndex(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    page?: number | undefined;
  }): Promise<BlogIndexResponse | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = resolveScopeLanguage(input.resolvedChannel, input.language ?? channel.default_language);
    const settings = await this.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;
    const page = Math.max(1, input.page ?? 1);

    const cacheKey = BlogCacheService.composeIndexKey(channel.code, language, page);
    if (this.cache) {
      const cached = await this.cache.get<BlogIndexResponse>(cacheKey);
      if (cached) return this.withIndexAuthors(cached, language, channel.default_language);
    }

    // Feature 171 — the index is paged by the channel's posts-per-page, and the
    // category tiles stand on its first page only (OR-5).
    const latest = await this.postsPage(em, channel.id, language, {}, page, settings.postsPerPage);
    const topLevelRows =
      page === 1
        ? ((await em.execute(
            `select c.*
               from blog_categories c
               join blog_category_sales_channels csc on csc.blog_category_id = c.id
              where c.deleted_at is null
                and c.enabled = true
                and c.parent_id is null
                and csc.sales_channel_id = ?
                and csc.deleted_at is null
                and ${CATEGORY_IN_LANGUAGE}
              order by c.position asc, c.slug asc`,
            [channel.id, language],
          )) as CategoryRow[])
        : [];

    const channelDefault = channel.default_language;
    const urls = this.urlsFor(input.resolvedChannel, language, prefixFor(settings, language));
    const cards: BlogPostCard[] = await Promise.all(
      latest.rows.map((r) => this.toPostCard(em, r, language, channelDefault, urls)),
    );
    const topLevelCategories: BlogCategoryTile[] = await Promise.all(
      topLevelRows.map((r) => this.toCategoryTile(em, r, language, channelDefault, urls)),
    );

    const out: BlogIndexResponse = {
      urlPrefix: settings.urlPrefix,
      url: urls.index(),
      latestPosts: cards,
      posts: { data: cards, pagination: latest.pagination },
      topLevelCategories,
    };
    if (this.cache) await this.cache.set(cacheKey, out);
    return this.withIndexAuthors(out, language, channel.default_language);
  }

  /**
   * The published posts of the resolved channel as cards, newest first, one page
   * of them (`GET /api/v1/blog/posts`; feature 163, paged by feature 171). Every
   * filter is optional and combinable; an unknown filter value, or the blog
   * disabled in the channel, answers an empty page so a page block with a stale
   * setting renders nothing. Posts, the category and the tag are all read within
   * the channel (Constitution XII).
   */
  async listPosts(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    page: number;
    perPage: number;
    categorySlug?: string | undefined;
    tagCode?: string | undefined;
    authorId?: string | undefined;
  }): Promise<{ data: BlogPostCard[]; pagination: BlogPagination }> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = resolveScopeLanguage(input.resolvedChannel, input.language ?? channel.default_language);
    const settings = await this.settingsResolver.getResolved(channel.id);
    const empty = { data: [], pagination: { page: input.page, perPage: input.perPage, totalItems: 0, totalPages: 0 } };
    if (!settings.enabled) return empty;

    const cacheKey = BlogCacheService.composeListKey(channel.code, language, {
      page: input.page,
      perPage: input.perPage,
      categorySlug: input.categorySlug ?? null,
      tagCode: input.tagCode ?? null,
      authorId: input.authorId ?? null,
    });
    if (this.cache) {
      const cached = await this.cache.get<{ data: BlogPostCard[]; pagination: BlogPagination }>(cacheKey);
      if (cached) {
        await this.attachAuthors(cached.data, language, channel.default_language);
        return cached;
      }
    }

    const found = await this.postsPage(
      em,
      channel.id,
      language,
      { categorySlug: input.categorySlug, tagCode: input.tagCode, authorId: input.authorId },
      input.page,
      input.perPage,
    );
    const channelDefault = channel.default_language;
    const urls = this.urlsFor(input.resolvedChannel, language, prefixFor(settings, language));
    const out = {
      data: await Promise.all(found.rows.map((r) => this.toPostCard(em, r, language, channelDefault, urls))),
      pagination: found.pagination,
    };
    if (this.cache) await this.cache.set(cacheKey, out);
    await this.attachAuthors(out.data, language, channel.default_language);
    return out;
  }

  /**
   * One page of the channel's published posts, newest first, with the totals of
   * every matching post. The order has a stable tie-breaker, so pages never repeat
   * or skip a post (FR-013); the total is read with the page, and asked for on its
   * own only when the page is past the last one.
   */
  private async postsPage(
    em: EntityManager,
    channelId: string,
    language: string,
    filters: { categorySlug?: string | undefined; tagCode?: string | undefined; authorId?: string | undefined },
    page: number,
    perPage: number,
  ): Promise<{ rows: PostRow[]; pagination: BlogPagination }> {
    const joins: string[] = [];
    const params: unknown[] = [];
    if (filters.categorySlug) {
      joins.push(`join blog_post_categories pc on pc.blog_post_id = p.id
         join blog_categories c on c.id = pc.blog_category_id
          and c.deleted_at is null
          and c.enabled = true
          and ${CATEGORY_IN_LANGUAGE}
         join blog_category_sales_channels csc on csc.blog_category_id = c.id
          and csc.sales_channel_id = psc.sales_channel_id
          and csc.slug = ?
          and csc.deleted_at is null`);
      params.push(language, filters.categorySlug);
    }
    if (filters.tagCode) {
      joins.push(`join blog_post_tags pt on pt.blog_post_id = p.id
         join blog_tags t on t.id = pt.blog_tag_id
          and t.deleted_at is null
          and t.code = ?`);
      params.push(filters.tagCode);
    }
    const from = `from blog_posts p
         join blog_post_sales_channels psc on psc.blog_post_id = p.id
         ${joins.join('\n         ')}
        where p.deleted_at is null
          and p.active = true
          and p.status = 'published'
          and psc.sales_channel_id = ?
          and psc.deleted_at is null
          and ${POST_IN_LANGUAGE}
          ${filters.authorId ? 'and p.author_admin_user_id = ?' : ''}`;
    const rows = (await em.execute(
      `select p.*, count(*) over () as total_count
         ${from}
        order by p.published_at desc nulls last, p.created_at desc, p.id desc
        limit ? offset ?`,
      [...params, channelId, language, ...(filters.authorId ? [filters.authorId] : []), perPage, (page - 1) * perPage],
    )) as Array<PostRow & { total_count: string | number }>;
    let totalItems = rows[0] ? Number(rows[0].total_count) : 0;
    if (rows.length === 0 && page > 1) {
      const counted = (await em.execute(`select count(*)::int as n ${from}`, [...params, channelId, language, ...(filters.authorId ? [filters.authorId] : [])])) as Array<{ n: number }>;
      totalItems = counted[0]?.n ?? 0;
    }
    return {
      rows,
      pagination: { page, perPage, totalItems, totalPages: Math.ceil(totalItems / perPage) },
    };
  }

  async getBySlug(
    slug: string,
    input: { resolvedChannel: ResolvedChannel; language?: string | undefined; page?: number },
  ): Promise<BlogBySlugResponse | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = resolveScopeLanguage(input.resolvedChannel, input.language ?? channel.default_language);
    const settings = await this.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;
    const channelDefault = channel.default_language;
    const urls = this.urlsFor(input.resolvedChannel, language, prefixFor(settings, language));

    // Feature 171 (US4) — the key is a key of the request language: its key row, else
    // a base slug; a former key and a keyed language's base slug redirect.
    const resolved = await resolveBlogKey(em, {
      channelId: channel.id,
      languageCode: language,
      key: slug,
      redirects: this.deps.seoPresent?.() ?? false,
      isServed: (ref) => this.isServed(em, ref, channel.id, language),
    });
    if (resolved === null) return null;
    if ('redirect' in resolved) {
      const target = resolved.redirect;
      const rows = (await em.execute(
        `select slug from ${target.kind === 'post' ? 'blog_posts' : 'blog_categories'} where id = ?`,
        [target.id],
      )) as Array<{ slug: string }>;
      const key = await this.keyOf(em, target.kind, target.id, rows[0]!.slug, language);
      return { kind: 'redirect', path: urls.entry(key), permanent: true };
    }
    const postRows =
      resolved.found.kind === 'post'
        ? ((await em.execute('select p.* from blog_posts p where p.id = ?', [resolved.found.id])) as PostRow[])
        : [];

    if (postRows[0]) {
      const post = postRows[0];
      const cacheKey = BlogCacheService.composePostKey(channel.code, language, slug);
      if (this.cache) {
        const cached = await this.cache.get<BlogBySlugResponse>(cacheKey);
        if (cached) return this.withSlugAuthors(cached, language, channelDefault);
      }
      const resolvedPost = await this.toResolvedPost(em, post, input.resolvedChannel, language, channelDefault, urls, settings);
      if (resolvedPost === null) return null;
      const payload: BlogBySlugResponse = { kind: 'post', post: resolvedPost };
      if (this.cache) await this.cache.set(cacheKey, payload);
      return this.withSlugAuthors(payload, language, channelDefault);
    }

    const categoryRows =
      resolved.found.kind === 'category'
        ? ((await em.execute('select c.* from blog_categories c where c.id = ?', [resolved.found.id])) as CategoryRow[])
        : [];

    if (categoryRows[0]) {
      const category = categoryRows[0];
      const page = Math.max(1, input.page ?? 1);
      const cacheKey = BlogCacheService.composeCategoryKey(
        channel.code,
        language,
        slug,
        page,
      );
      if (this.cache) {
        const cached = await this.cache.get<BlogBySlugResponse>(cacheKey);
        if (cached) return this.withSlugAuthors(cached, language, channelDefault);
      }

      const offset = (page - 1) * settings.postsPerPage;
      const totalRows = (await em.execute(
        `select count(*)::int as n
           from blog_posts p
           join blog_post_categories pc on pc.blog_post_id = p.id
           join blog_post_sales_channels psc on psc.blog_post_id = p.id
          where p.deleted_at is null
            and p.active = true
            and p.status = 'published'
            and pc.blog_category_id = ?
            and psc.sales_channel_id = ?
            and psc.deleted_at is null
            and ${POST_IN_LANGUAGE}`,
        [category.id, channel.id, language],
      )) as Array<{ n: number }>;
      const totalItems = totalRows[0]?.n ?? 0;

      const pageRows = (await em.execute(
        `select p.*
           from blog_posts p
           join blog_post_categories pc on pc.blog_post_id = p.id
           join blog_post_sales_channels psc on psc.blog_post_id = p.id
          where p.deleted_at is null
            and p.active = true
            and p.status = 'published'
            and pc.blog_category_id = ?
            and psc.sales_channel_id = ?
            and psc.deleted_at is null
            and ${POST_IN_LANGUAGE}
          order by p.published_at desc nulls last, p.created_at desc, p.id desc
          limit ${settings.postsPerPage} offset ${offset}`,
        [category.id, channel.id, language],
      )) as PostRow[];

      const childRows = (await em.execute(
        `select c.*
           from blog_categories c
           join blog_category_sales_channels csc on csc.blog_category_id = c.id
          where c.deleted_at is null
            and c.enabled = true
            and c.parent_id = ?
            and csc.sales_channel_id = ?
            and csc.deleted_at is null
            and ${CATEGORY_IN_LANGUAGE}
          order by c.position asc, c.slug asc`,
        [category.id, channel.id, language],
      )) as CategoryRow[];

      const categoryKey = await this.keyOf(em, 'category', category.id, category.slug, language);
      const resolvedCategory: BlogResolvedCategory = {
        id: category.id,
        name: this.pickName(category.name, language, channelDefault) ?? category.slug,
        slug: category.slug,
        mainImageUrl: await this.maybeAssetUrl(category.main_image_asset_id),
        description: this.normaliseDescription(category.description),
        metaTitle: this.pickLanguage(category.meta_title, language, channelDefault),
        metaDescription: this.pickLanguage(category.meta_description, language, channelDefault),
        metaKeywords: this.pickLanguage(category.meta_keywords, language, channelDefault),
        childCategories: await Promise.all(
          childRows.map((r) => this.toCategoryTile(em, r, language, channelDefault, urls)),
        ),
        breadcrumb: [
          { name: 'Blog', url: urls.index() },
          { name: this.pickName(category.name, language, channelDefault) ?? category.slug, url: urls.entry(categoryKey) },
        ],
        url: urls.entry(categoryKey),
        alternates: await this.alternatesOf(em, { kind: 'category', id: category.id }, category.slug, input.resolvedChannel, settings),
      };

      const payload: BlogBySlugResponse = {
        kind: 'category',
        category: resolvedCategory,
        posts: {
          data: await Promise.all(
            pageRows.map((r) => this.toPostCard(em, r, language, channelDefault, urls)),
          ),
          pagination: {
            page,
            perPage: settings.postsPerPage,
            totalPages: Math.max(1, Math.ceil(totalItems / settings.postsPerPage)),
            totalItems,
          },
        },
      };
      if (this.cache) await this.cache.set(cacheKey, payload);
      return this.withSlugAuthors(payload, language, channelDefault);
    }

    return null;
  }

  async getTagByCode(
    code: string,
    input: { resolvedChannel: ResolvedChannel; language?: string | undefined; page?: number },
  ): Promise<BlogTagByCodeResponse | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = resolveScopeLanguage(input.resolvedChannel, input.language ?? channel.default_language);
    const settings = await this.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;
    const channelDefault = channel.default_language;
    const urls = this.urlsFor(input.resolvedChannel, language, prefixFor(settings, language));

    const tagRows = (await em.execute(
      `select id::text as id, code, name, description from blog_tags where code = ? and deleted_at is null limit 1`,
      [code],
    )) as Array<{
      id: string;
      code: string;
      name: Record<string, string>;
      description: Record<string, string> | null;
    }>;
    if (tagRows.length === 0) return null;
    const tag = tagRows[0]!;

    const page = Math.max(1, input.page ?? 1);
    const cacheKey = BlogCacheService.composeTagKey(
      channel.code,
      language,
      code,
      page,
    );
    if (this.cache) {
      const cached = await this.cache.get<BlogTagByCodeResponse>(cacheKey);
      if (cached) return this.withTagAuthors(cached, language, channelDefault);
    }

    const offset = (page - 1) * settings.postsPerPage;
    const totalRows = (await em.execute(
      `select count(*)::int as n
         from blog_posts p
         join blog_post_tags pt on pt.blog_post_id = p.id
         join blog_post_sales_channels psc on psc.blog_post_id = p.id
        where p.deleted_at is null
          and p.active = true
          and p.status = 'published'
          and pt.blog_tag_id = ?
          and psc.sales_channel_id = ?
          and psc.deleted_at is null
          and ${POST_IN_LANGUAGE}`,
      [tag.id, channel.id, language],
    )) as Array<{ n: number }>;
    const totalItems = totalRows[0]?.n ?? 0;

    const pageRows = (await em.execute(
      `select p.*
         from blog_posts p
         join blog_post_tags pt on pt.blog_post_id = p.id
         join blog_post_sales_channels psc on psc.blog_post_id = p.id
        where p.deleted_at is null
          and p.active = true
          and p.status = 'published'
          and pt.blog_tag_id = ?
          and psc.sales_channel_id = ?
          and psc.deleted_at is null
          and ${POST_IN_LANGUAGE}
        order by p.published_at desc nulls last, p.created_at desc, p.id desc
        limit ${settings.postsPerPage} offset ${offset}`,
      [tag.id, channel.id, language],
    )) as PostRow[];

    const tagName = this.pickLanguage(tag.name, language, channelDefault) ?? tag.code;
    const payload: BlogTagByCodeResponse = {
      tag: {
        id: tag.id,
        code: tag.code,
        name: tagName,
        description: this.pickLanguage(tag.description, language, channelDefault),
        url: urls.tag(tag.code),
      },
      posts: {
        data: await Promise.all(
          pageRows.map((r) => this.toPostCard(em, r, language, channelDefault, urls)),
        ),
        pagination: {
          page,
          perPage: settings.postsPerPage,
          totalPages: Math.max(1, Math.ceil(totalItems / settings.postsPerPage)),
          totalItems,
        },
      },
      breadcrumb: [
        { name: 'Blog', url: urls.index() },
        { name: tagName, url: urls.tag(tag.code) },
      ],
    };

    if (this.cache) await this.cache.set(cacheKey, payload);
    return this.withTagAuthors(payload, language, channelDefault);
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  /**
   * The paths of the blog in the request language. The request language is first
   * matched to the channel's own (`en` → `en-US`), because a path names a language
   * of the channel or none.
   */
  private urlsFor(channel: ResolvedChannel, language: string, prefix: string): BlogUrls {
    const base = { languageCode: resolveScopeLanguage(channel, language), channel, prefix };
    return {
      index: () => blogPath({ ...base, view: 'index' }),
      entry: (key) => blogPath({ ...base, view: 'entry', key }),
      tag: (code) => blogPath({ ...base, view: 'tag', code }),
    };
  }

  /**
   * Language-fallback rule (FR-019 / R12 / per feature 005): pick the
   * requested language; fall back to the channel's default language; if
   * neither exists, return null. The caller decides whether `null`
   * means "skip this field" or "404 the page" depending on context.
   */
  private pickLanguage(
    map: Record<string, string> | null | undefined,
    language: string,
    channelDefault: string,
  ): string | null {
    if (!map) return null;
    if (map[language]) return map[language] ?? null;
    if (map[channelDefault]) return map[channelDefault] ?? null;
    return null;
  }

  /**
   * Resolve a human-readable name for a published entity. Applies the
   * standard language fallback (requested → channel default) and, when that
   * is exhausted, falls back to the first language actually authored on the
   * entity rather than giving up.
   *
   * This keeps a *published* post/category viewable even when its content
   * was authored only in a language other than the channel's default — the
   * alternative (returning null) made the post-detail resolver 404 while the
   * index/category resolvers still listed the post (via their `?? slug`
   * fallback), an inconsistency that surfaced as "the post is in the list but
   * its page 404s". A published entity is always reachable; only its display
   * language degrades.
   */
  private pickName(
    map: Record<string, string> | null | undefined,
    language: string,
    channelDefault: string,
  ): string | null {
    const resolved = this.pickLanguage(map, language, channelDefault);
    if (resolved !== null) return resolved;
    if (!map) return null;
    for (const value of Object.values(map)) {
      if (value) return value;
    }
    return null;
  }

  private async toPostCard(
    em: EntityManager,
    row: PostRow,
    language: string,
    channelDefault: string,
    urls: BlogUrls,
  ): Promise<BlogPostCard> {
    // Pull the primary category slug if any (the first one assigned).
    const catRows = (await em.execute(
      `select c.slug, c.name
         from blog_post_categories pc
         join blog_categories c on c.id = pc.blog_category_id
        where pc.blog_post_id = ?
          and c.deleted_at is null
          and ${CATEGORY_IN_LANGUAGE}
        order by c.is_system desc, c.position asc, c.slug asc
        limit 1`,
      [row.id, language],
    )) as Array<{ slug: string; name: Record<string, string> | null }>;
    const primaryCategorySlug = catRows[0]?.slug ?? null;
    const primaryCategoryName = catRows[0]
      ? (this.pickName(catRows[0].name, language, channelDefault) ?? catRows[0].slug)
      : null;

    const name = this.pickName(row.name, language, channelDefault) ?? row.slug;
    const excerpt =
      this.pickLanguage(row.meta_description, language, channelDefault) ??
      this.firstParagraph(row.content, language, channelDefault);

    return {
      id: row.id,
      slug: row.slug,
      name,
      publishedAt: this.toIso(row.published_at),
      excerpt,
      mainImageUrl: await this.maybeAssetUrl(row.main_image_asset_id),
      primaryCategorySlug,
      primaryCategoryName,
      url: urls.entry(await this.keyOf(em, 'post', row.id, row.slug, language)),
      authorId: row.author_admin_user_id ?? null,
    };
  }

  private async toCategoryTile(
    em: EntityManager,
    row: CategoryRow,
    language: string,
    channelDefault: string,
    urls: BlogUrls,
  ): Promise<BlogCategoryTile> {
    return {
      id: row.id,
      name: this.pickName(row.name, language, channelDefault) ?? row.slug,
      slug: row.slug,
      mainImageUrl: await this.maybeAssetUrl(row.main_image_asset_id),
      url: urls.entry(await this.keyOf(em, 'category', row.id, row.slug, language)),
    };
  }

  private async toResolvedPost(
    em: EntityManager,
    post: PostRow,
    resolvedChannel: ResolvedChannel,
    language: string,
    channelDefault: string,
    urls: BlogUrls,
    settings: ResolvedBlogSettings,
  ): Promise<BlogResolvedPost | null> {
    const channel = toChannelRow(resolvedChannel);
    // A published post is always reachable; fall back to any authored
    // language (then the slug) rather than 404 when the channel default is
    // missing. Keeps the post-detail page consistent with the index/category
    // listings, which already surface the post via their own slug fallback.
    const name =
      this.pickName(post.name, language, channelDefault) ?? post.slug;

    // Tags (ordered).
    const tagRows = (await em.execute(
      `select t.id::text as id, t.code, t.name
         from blog_post_tags pt
         join blog_tags t on t.id = pt.blog_tag_id and t.deleted_at is null
        where pt.blog_post_id = ?
        order by pt.position`,
      [post.id],
    )) as Array<{ id: string; code: string; name: Record<string, string> }>;

    // Related posts (filtered to available ones in scope).
    const relatedPostRows = (await em.execute(
      `select p.*
         from blog_post_related_posts r
         join blog_posts p on p.id = r.related_post_id
         join blog_post_sales_channels psc on psc.blog_post_id = p.id
        where r.parent_post_id = ?
          and p.deleted_at is null
          and p.active = true
          and p.status = 'published'
          and psc.sales_channel_id = ?
          and psc.deleted_at is null
          and ${POST_IN_LANGUAGE}
        order by r.position`,
      [post.id, channel.id, language],
    )) as PostRow[];
    const relatedPosts = await Promise.all(
      relatedPostRows.map((r) => this.toPostCard(em, r, language, channelDefault, urls)),
    );

    // Related products, by id and in the editor's order (issue #590). The
    // storefront reads them from the catalogue listing as the viewer, which is
    // where availability and the viewer's price are decided; this payload is
    // cached for every visitor and so carries nothing about one.
    const relatedProductRows = (await em.execute(
      `select product_id::text as id
         from blog_post_related_products
        where blog_post_id = ?
        order by position`,
      [post.id],
    )) as Array<{ id: string }>;
    const relatedProductIds = relatedProductRows.map((r) => r.id);
    // Deprecated (issue #590): filled only when a composition passes
    // `resolveProductCard`, which none in this repository does.
    const relatedProducts: BlogProductCard[] = [];
    if (this.deps.resolveProductCard) {
      for (const r of relatedProductRows) {
        const card = await this.deps.resolveProductCard(r.id, channel.id, language);
        if (card) relatedProducts.push(card);
      }
    }

    // Categories (used in breadcrumb + the resolved-post categories list).
    const categoryRows = (await em.execute(
      `select c.id::text as id, c.slug, c.name
         from blog_post_categories pc
         join blog_categories c on c.id = pc.blog_category_id and c.deleted_at is null
        where pc.blog_post_id = ?
          and ${CATEGORY_IN_LANGUAGE}
        order by c.is_system desc, c.position asc, c.slug asc`,
      [post.id, language],
    )) as Array<{ id: string; slug: string; name: Record<string, string> }>;

    const categories = categoryRows.map((c) => ({
      id: c.id,
      name: this.pickName(c.name, language, channelDefault) ?? c.slug,
      slug: c.slug,
    }));

    const tags: BlogResolvedTagRef[] = tagRows.map((t) => ({
      id: t.id,
      code: t.code,
      name: this.pickLanguage(t.name, language, channelDefault) ?? t.code,
      url: urls.tag(t.code),
    }));

    const postKey = await this.keyOf(em, 'post', post.id, post.slug, language);
    const firstCategoryKey = categories[0]
      ? await this.keyOf(em, 'category', categories[0].id, categories[0].slug, language)
      : null;
    const breadcrumb = [
      { name: 'Blog', url: urls.index() },
      ...(categories[0] && firstCategoryKey ? [{ name: categories[0].name, url: urls.entry(firstCategoryKey) }] : []),
      { name, url: urls.entry(postKey) },
    ];

    return {
      id: post.id,
      name,
      slug: post.slug,
      publishedAt: this.toIso(post.published_at),
      metaTitle: this.pickLanguage(post.meta_title, language, channelDefault),
      metaDescription: this.pickLanguage(post.meta_description, language, channelDefault),
      metaKeywords: this.pickLanguage(post.meta_keywords, language, channelDefault),
      content: this.normaliseContent(post.content),
      tags,
      relatedPosts,
      relatedProducts,
      relatedProductIds,
      categories,
      breadcrumb,
      url: urls.entry(postKey),
      alternates: await this.alternatesOf(em, { kind: 'post', id: post.id }, post.slug, resolvedChannel, settings),
      authorId: post.author_admin_user_id ?? null,
    };
  }

  /**
   * Feature 171 (US7, research R10) — the authors of these cards, read per request
   * after the cache: the cached payload carries the id only, so a profile edit shows
   * at once. A deleted administrator, or none, is `null`.
   */
  private async attachAuthors(cards: BlogPostCard[], language: string, channelDefault: string): Promise<void> {
    const ids = cards.map((card) => card.authorId).filter((id): id is string => typeof id === 'string');
    const authors = this.deps.authors && ids.length > 0
      ? await this.deps.authors.forStorefront(ids, language, channelDefault)
      : new Map<string, { id: string; name: string; avatarUrl: string | null }>();
    for (const card of cards) {
      const author = card.authorId ? authors.get(card.authorId) : undefined;
      card.author = author ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl } : null;
    }
  }

  private async withIndexAuthors(index: BlogIndexResponse, language: string, channelDefault: string): Promise<BlogIndexResponse> {
    await this.attachAuthors(index.latestPosts, language, channelDefault);
    if (index.posts) await this.attachAuthors(index.posts.data, language, channelDefault);
    return index;
  }

  private async withTagAuthors(
    payload: BlogTagByCodeResponse,
    language: string,
    channelDefault: string,
  ): Promise<BlogTagByCodeResponse> {
    await this.attachAuthors(payload.posts.data, language, channelDefault);
    return payload;
  }

  private async withSlugAuthors(
    payload: BlogBySlugResponse,
    language: string,
    channelDefault: string,
  ): Promise<BlogBySlugResponse> {
    if (payload.kind === 'category') await this.attachAuthors(payload.posts.data, language, channelDefault);
    if (payload.kind === 'post') {
      await this.attachAuthors(payload.post.relatedPosts, language, channelDefault);
      const id = payload.post.authorId;
      payload.post.author =
        id && this.deps.authors
          ? ((await this.deps.authors.forStorefront([id], language, channelDefault)).get(id) ?? null)
          : null;
    }
    return payload;
  }

  /** The effective key of one entity in a language (feature 171, US4). */
  private async keyOf(
    em: EntityManager,
    kind: BlogEntityRef['kind'],
    id: string,
    slug: string,
    language: string,
  ): Promise<string> {
    return (await effectiveKeys(em, kind, [{ id, slug }], language)).get(id) ?? slug;
  }

  /** Whether an entity is served at (channel, language): published or enabled, in both. */
  private async isServed(em: EntityManager, ref: BlogEntityRef, channelId: string, language: string): Promise<boolean> {
    const rows = (await em.execute(
      ref.kind === 'post'
        ? `select 1 from blog_posts p
             join blog_post_sales_channels psc on psc.blog_post_id = p.id
            where p.id = ? and p.deleted_at is null and p.active = true and p.status = 'published'
              and psc.sales_channel_id = ? and psc.deleted_at is null and ${POST_IN_LANGUAGE}`
        : `select 1 from blog_categories c
             join blog_category_sales_channels csc on csc.blog_category_id = c.id
            where c.id = ? and c.deleted_at is null and c.enabled = true
              and csc.sales_channel_id = ? and csc.deleted_at is null and ${CATEGORY_IN_LANGUAGE}`,
      [ref.id, channelId, language],
    )) as unknown[];
    return rows.length > 0;
  }

  /**
   * The entity in the channel's other languages — its effective key under each
   * language's blog prefix — for `hreflang` and the language switcher (FR-034).
   * Only the languages the entity is in; `xDefault` is the unprefixed URL of the
   * channel's default language when the entity is in it.
   */
  private async alternatesOf(
    em: EntityManager,
    ref: BlogEntityRef,
    slug: string,
    channel: ResolvedChannel,
    settings: ResolvedBlogSettings,
  ): Promise<BlogAlternates> {
    const table = ref.kind === 'post' ? 'blog_post_languages' : 'blog_category_languages';
    const fk = ref.kind === 'post' ? 'blog_post_id' : 'blog_category_id';
    const assigned = ((await em.execute(`select language from ${table} where ${fk} = ?`, [ref.id])) as Array<{
      language: string;
    }>).map((r) => r.language.toLowerCase());
    // A category assigned no language is in every one (the seeded `Default`).
    const isIn = (language: string) => assigned.length === 0 || assigned.includes(language.toLowerCase());
    const languages: Record<string, string> = {};
    for (const languageCode of channel.languages) {
      if (!isIn(languageCode)) continue;
      const key = await this.keyOf(em, ref.kind, ref.id, slug, languageCode);
      languages[languageCode] = blogPath({ view: 'entry', key, languageCode, channel, prefix: prefixFor(settings, languageCode) });
    }
    const xDefault = isIn(channel.defaultLanguage)
      ? blogDefaultPath({
          view: 'entry',
          key: await this.keyOf(em, ref.kind, ref.id, slug, channel.defaultLanguage),
          prefix: prefixFor(settings, channel.defaultLanguage),
        })
      : null;
    return { languages, xDefault };
  }

  private async maybeAssetUrl(assetId: string | null): Promise<string | null> {
    if (!assetId) return null;
    if (!this.deps.resolveAssetUrl) return null;
    return this.deps.resolveAssetUrl(assetId);
  }

  private normaliseDescription(
    raw: { schema_version?: number; languages?: Record<string, unknown> } | null,
  ): { schema_version: number; languages: Record<string, unknown> } | null {
    if (!raw || typeof raw !== 'object') return null;
    return {
      schema_version: typeof raw.schema_version === 'number' ? raw.schema_version : 1,
      languages: raw.languages ?? {},
    };
  }

  private normaliseContent(
    raw: { schema_version?: number; languages?: Record<string, unknown> } | null,
  ): { schema_version: number; languages: Record<string, unknown> } {
    if (!raw || typeof raw !== 'object') return { schema_version: 1, languages: {} };
    return {
      schema_version: typeof raw.schema_version === 'number' ? raw.schema_version : 1,
      languages: raw.languages ?? {},
    };
  }

  /**
   * Best-effort excerpt extraction — picks the first text-bearing node
   * in the resolved language's tree. Falls back to the channel default
   * language. Returns null when nothing usable is found.
   */
  private firstParagraph(
    raw: { languages?: Record<string, unknown> } | null,
    language: string,
    channelDefault: string,
  ): string | null {
    if (!raw || typeof raw !== 'object' || !raw.languages) return null;
    const tree = raw.languages[language] ?? raw.languages[channelDefault];
    if (!tree) return null;
    return extractText(tree, 160);
  }

  private toIso(value: Date | string | null): string | null {
    if (value === null || value === undefined) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}

/**
 * Recursively walks a Page Builder tree node and collects up to `max`
 * characters of text from `props.text` / `props.value` fields. Used as a
 * fallback excerpt when no `meta_description` is set.
 */
function extractText(node: unknown, max: number): string | null {
  const acc: string[] = [];
  const walk = (n: unknown): void => {
    if (acc.join(' ').length >= max) return;
    if (!n || typeof n !== 'object') return;
    const obj = n as Record<string, unknown>;
    const props = obj['props'] as Record<string, unknown> | undefined;
    if (props) {
      if (typeof props['text'] === 'string') acc.push(props['text']);
      if (typeof props['value'] === 'string') acc.push(props['value']);
    }
    const children = obj['children'];
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    }
  };
  walk(node);
  if (acc.length === 0) return null;
  const s = acc.join(' ').trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** The blog prefix of a language in a channel (feature 171, US5): its own, else the channel's. */
export function prefixFor(settings: ResolvedBlogSettings, languageCode: string): string {
  const wanted = languageCode.toLowerCase();
  const own = Object.entries(settings.urlPrefixByLanguage).find(([language]) => language.toLowerCase() === wanted);
  return own?.[1] ?? settings.urlPrefix;
}
