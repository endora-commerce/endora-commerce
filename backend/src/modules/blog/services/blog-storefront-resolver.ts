import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  BlogBySlugResponse,
  BlogCategoryTile,
  BlogIndexResponse,
  BlogPostCard,
  BlogPostStatus,
  BlogProductCard,
  BlogResolvedCategory,
  BlogResolvedPost,
  BlogResolvedTagRef,
  BlogTagByCodeResponse,
} from '@endora-commerce/contracts';
import { BlogCacheService } from './blog-cache.js';
import type { BlogSettingsResolver } from './blog-settings-resolver.js';

/**
 * Cross-module surfaces the storefront resolver delegates to. Each is a
 * narrow port (Constitution I) — the resolver does not import the
 * upstream module's internals.
 */
export interface BlogStorefrontDeps {
  /**
   * Resolves a Library Asset id to a CDN-ready URL. Returns null when
   * the asset is missing, soft-deleted, or otherwise unavailable.
   */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  /**
   * Resolves a Catalog Product id to a card payload (or null when the
   * product is soft-deleted / out-of-channel — handled at the upstream
   * port, not here). Optional: when omitted, related-products lists
   * always render as empty (R6 storefront-filter contract).
   */
  resolveProductCard?: (
    productId: string,
    salesChannelId: string,
    language: string,
  ) => Promise<BlogProductCard | null>;
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
export type ResolvedChannel = { id: string; code: string; defaultLanguage: string };

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
  }): Promise<BlogIndexResponse | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = input.language ?? channel.default_language;
    const settings = await this.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;

    const cacheKey = BlogCacheService.composeIndexKey(channel.code, language);
    if (this.cache) {
      const cached = await this.cache.get<BlogIndexResponse>(cacheKey);
      if (cached) return cached;
    }

    const latestRows = (await em.execute(
      `select p.*
         from blog_posts p
         join blog_post_sales_channels psc on psc.blog_post_id = p.id
        where p.deleted_at is null
          and p.active = true
          and p.status = 'published'
          and psc.sales_channel_id = ?
          and psc.deleted_at is null
        order by p.published_at desc nulls last, p.created_at desc
        limit ?`,
      [channel.id, settings.latestCount],
    )) as PostRow[];

    const topLevelRows = (await em.execute(
      `select c.*
         from blog_categories c
         join blog_category_sales_channels csc on csc.blog_category_id = c.id
        where c.deleted_at is null
          and c.enabled = true
          and c.parent_id is null
          and csc.sales_channel_id = ?
          and csc.deleted_at is null
        order by c.position asc, c.slug asc`,
      [channel.id],
    )) as CategoryRow[];

    const channelDefault = channel.default_language;
    const latestPosts: BlogPostCard[] = await Promise.all(
      latestRows.map((r) => this.toPostCard(em, r, language, channelDefault)),
    );
    const topLevelCategories: BlogCategoryTile[] = await Promise.all(
      topLevelRows.map((r) => this.toCategoryTile(r, language, channelDefault)),
    );

    const out: BlogIndexResponse = {
      urlPrefix: settings.urlPrefix,
      latestPosts,
      topLevelCategories,
    };
    if (this.cache) await this.cache.set(cacheKey, out);
    return out;
  }

  async getBySlug(
    slug: string,
    input: { resolvedChannel: ResolvedChannel; language?: string | undefined; page?: number },
  ): Promise<BlogBySlugResponse | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = input.language ?? channel.default_language;
    const settings = await this.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;
    const channelDefault = channel.default_language;


    // Probe the post side first — by-(channel, slug) covered by the partial-unique index.
    const postRows = (await em.execute(
      `select p.*
         from blog_posts p
         join blog_post_sales_channels psc on psc.blog_post_id = p.id
        where p.deleted_at is null
          and p.active = true
          and p.status = 'published'
          and psc.sales_channel_id = ?
          and psc.slug = ?
          and psc.deleted_at is null
        limit 1`,
      [channel.id, slug],
    )) as PostRow[];

    if (postRows[0]) {
      const post = postRows[0];
      const cacheKey = BlogCacheService.composePostKey(channel.code, language, slug);
      if (this.cache) {
        const cached = await this.cache.get<BlogBySlugResponse>(cacheKey);
        if (cached) return cached;
      }
      const resolved = await this.toResolvedPost(em, post, channel, language, channelDefault, settings.urlPrefix);
      if (resolved === null) return null;
      const payload: BlogBySlugResponse = { kind: 'post', post: resolved };
      if (this.cache) await this.cache.set(cacheKey, payload);
      return payload;
    }

    // Probe the category side.
    const categoryRows = (await em.execute(
      `select c.*
         from blog_categories c
         join blog_category_sales_channels csc on csc.blog_category_id = c.id
        where c.deleted_at is null
          and c.enabled = true
          and csc.sales_channel_id = ?
          and csc.slug = ?
          and csc.deleted_at is null
        limit 1`,
      [channel.id, slug],
    )) as CategoryRow[];

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
        if (cached) return cached;
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
            and psc.deleted_at is null`,
        [category.id, channel.id],
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
          order by p.published_at desc nulls last, p.created_at desc
          limit ${settings.postsPerPage} offset ${offset}`,
        [category.id, channel.id],
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
          order by c.position asc, c.slug asc`,
        [category.id, channel.id],
      )) as CategoryRow[];

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
          childRows.map((r) => this.toCategoryTile(r, language, channelDefault)),
        ),
        breadcrumb: [
          { name: 'Blog', url: `/${settings.urlPrefix}` },
          { name: this.pickName(category.name, language, channelDefault) ?? category.slug, url: `/${settings.urlPrefix}/${category.slug}` },
        ],
      };

      const payload: BlogBySlugResponse = {
        kind: 'category',
        category: resolvedCategory,
        posts: {
          data: await Promise.all(
            pageRows.map((r) => this.toPostCard(em, r, language, channelDefault)),
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
      return payload;
    }

    return null;
  }

  async getTagByCode(
    code: string,
    input: { resolvedChannel: ResolvedChannel; language?: string | undefined; page?: number },
  ): Promise<BlogTagByCodeResponse | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);
    const language = input.language ?? channel.default_language;
    const settings = await this.settingsResolver.getResolved(channel.id);
    if (!settings.enabled) return null;
    const channelDefault = channel.default_language;

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
      if (cached) return cached;
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
          and psc.deleted_at is null`,
      [tag.id, channel.id],
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
        order by p.published_at desc nulls last, p.created_at desc
        limit ${settings.postsPerPage} offset ${offset}`,
      [tag.id, channel.id],
    )) as PostRow[];

    const tagName = this.pickLanguage(tag.name, language, channelDefault) ?? tag.code;
    const payload: BlogTagByCodeResponse = {
      tag: {
        id: tag.id,
        code: tag.code,
        name: tagName,
        description: this.pickLanguage(tag.description, language, channelDefault),
      },
      posts: {
        data: await Promise.all(
          pageRows.map((r) => this.toPostCard(em, r, language, channelDefault)),
        ),
        pagination: {
          page,
          perPage: settings.postsPerPage,
          totalPages: Math.max(1, Math.ceil(totalItems / settings.postsPerPage)),
          totalItems,
        },
      },
      breadcrumb: [
        { name: 'Blog', url: `/${settings.urlPrefix}` },
        { name: tagName, url: `/${settings.urlPrefix}/tag/${tag.code}` },
      ],
    };

    if (this.cache) await this.cache.set(cacheKey, payload);
    return payload;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

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
  ): Promise<BlogPostCard> {
    // Pull the primary category slug if any (the first one assigned).
    const catRows = (await em.execute(
      `select c.slug
         from blog_post_categories pc
         join blog_categories c on c.id = pc.blog_category_id
        where pc.blog_post_id = ?
          and c.deleted_at is null
        order by c.is_system desc, c.position asc, c.slug asc
        limit 1`,
      [row.id],
    )) as Array<{ slug: string }>;
    const primaryCategorySlug = catRows[0]?.slug ?? null;

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
    };
  }

  private async toCategoryTile(
    row: CategoryRow,
    language: string,
    channelDefault: string,
  ): Promise<BlogCategoryTile> {
    return {
      id: row.id,
      name: this.pickName(row.name, language, channelDefault) ?? row.slug,
      slug: row.slug,
      mainImageUrl: await this.maybeAssetUrl(row.main_image_asset_id),
    };
  }

  private async toResolvedPost(
    em: EntityManager,
    post: PostRow,
    channel: ChannelRow,
    language: string,
    channelDefault: string,
    urlPrefix: string,
  ): Promise<BlogResolvedPost | null> {
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
        order by r.position`,
      [post.id, channel.id],
    )) as PostRow[];
    const relatedPosts = await Promise.all(
      relatedPostRows.map((r) => this.toPostCard(em, r, language, channelDefault)),
    );

    // Related products via the optional port.
    const relatedProductIds = (await em.execute(
      `select product_id::text as id
         from blog_post_related_products
        where blog_post_id = ?
        order by position`,
      [post.id],
    )) as Array<{ id: string }>;
    const relatedProducts: BlogProductCard[] = [];
    if (this.deps.resolveProductCard) {
      for (const r of relatedProductIds) {
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
        order by c.is_system desc, c.position asc, c.slug asc`,
      [post.id],
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
    }));

    const breadcrumb = [
      { name: 'Blog', url: `/${urlPrefix}` },
      ...(categories[0]
        ? [{ name: categories[0].name, url: `/${urlPrefix}/${categories[0].slug}` }]
        : []),
      { name, url: `/${urlPrefix}/${post.slug}` },
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
      categories,
      breadcrumb,
    };
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
