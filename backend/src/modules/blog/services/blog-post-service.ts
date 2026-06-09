import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  type BlogPostDetail,
  type BlogPostInboundReferencesResponse,
  type BlogPostStatus,
  type BlogPostSummary,
  type CreateBlogPostRequest,
  type DictionaryValidator,
  type PatchBlogPostRequest,
  type PutBlogPostContentRequest,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { assertSlugAvailable } from './blog-slug-collision.js';
import type { BlogCacheService } from './blog-cache.js';

type PostRow = {
  id: string;
  name: Record<string, string>;
  slug: string;
  active: boolean;
  status: BlogPostStatus;
  published_at: Date | string | null;
  description: string | null;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  content: { schema_version?: number; languages?: Record<string, unknown> } | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PostListFilters = {
  q?: string | undefined;
  status?: BlogPostStatus | undefined;
  salesChannelId?: string | undefined;
  categoryId?: string | undefined;
  tagId?: string | undefined;
  language?: string | undefined;
  page?: number | undefined;
  perPage?: number | undefined;
};

/**
 * BlogPostService — feature 016 / T033.
 *
 * Owns the full BlogPost CRUD + lifecycle + relations contract documented
 * in `contracts/blog-admin-http.contract.md`. The service runs every
 * write inside an `em.transactional(...)` block; the slug-collision
 * helper acquires per-(channel, slug) advisory locks so a concurrent
 * write cannot squeeze a duplicate past the partial unique indexes.
 *
 * The status state machine is documented in `data-model.md` § State
 * transitions: draft → published (sets published_at if null), published
 * → draft (preserves published_at), published ↔ archived. softDelete
 * additionally detaches every blog_post_related_posts row where
 * related_post_id = id (FR-028 / R5) so deleting an article does not
 * orphan a parent post's strip — the storefront just sees a shorter
 * list and the admin's confirmation dialog has already surfaced the
 * affected parents.
 */
export class BlogPostService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: BlogCacheService,
    private readonly dictionaryValidator?: DictionaryValidator,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────────────────────────────

  async list(filters: PostListFilters): Promise<{
    data: BlogPostSummary[];
    pagination: { page: number; perPage: number; totalPages: number; totalItems: number };
  }> {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));
    const conn = this.emFactory().getConnection();

    const where: string[] = ['p.deleted_at is null'];
    const params: unknown[] = [];
    if (filters.q) {
      where.push(`(p.name::text ilike ? or p.slug ilike ?)`);
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.status) {
      where.push('p.status = ?');
      params.push(filters.status);
    }
    if (filters.salesChannelId) {
      where.push(
        'exists (select 1 from blog_post_sales_channels s where s.blog_post_id = p.id and s.sales_channel_id = ?)',
      );
      params.push(filters.salesChannelId);
    }
    if (filters.categoryId) {
      where.push(
        'exists (select 1 from blog_post_categories c where c.blog_post_id = p.id and c.blog_category_id = ?)',
      );
      params.push(filters.categoryId);
    }
    if (filters.tagId) {
      where.push(
        'exists (select 1 from blog_post_tags t where t.blog_post_id = p.id and t.blog_tag_id = ?)',
      );
      params.push(filters.tagId);
    }
    if (filters.language) {
      where.push(
        'exists (select 1 from blog_post_languages l where l.blog_post_id = p.id and l.language = ?)',
      );
      params.push(filters.language);
    }
    const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';

    const totalRows = (await conn.execute(
      `select count(*)::int as n from blog_posts p ${whereSql}`,
      params,
    )) as Array<{ n: number }>;
    const totalItems = totalRows[0]?.n ?? 0;

    const offset = (page - 1) * perPage;
    const rows = (await conn.execute(
      `select p.* from blog_posts p
        ${whereSql}
        order by p.updated_at desc
        limit ${perPage} offset ${offset}`,
      params,
    )) as PostRow[];

    const data = await Promise.all(rows.map((r) => this.toSummary(r)));
    return {
      data,
      pagination: {
        page,
        perPage,
        totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
        totalItems,
      },
    };
  }

  async create(input: CreateBlogPostRequest): Promise<BlogPostDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();

    return em.transactional(async (tx) => {
      // Slug-collision guard runs first so we don't pollute the post row
      // when the slug is already taken.
      await assertSlugAvailable(tx, {
        slug: input.slug,
        salesChannelIds: input.salesChannelIds,
        kind: 'post',
      });
      await this.validateLanguages(input.languages);

      // Auto-fill the seeded Default category when none supplied (FR-011).
      let categoryIds = input.categoryIds ?? [];
      if (categoryIds.length === 0) {
        const defaultRows = (await tx.getConnection().execute(
          `select id::text as id from blog_categories where is_system = true and deleted_at is null limit 1`,
        )) as Array<{ id: string }>;
        if (defaultRows.length === 0) {
          throw new HttpError(
            500,
            ERROR_CODES.INTERNAL,
            'Seeded Default blog category is missing. Run the boot reconciler.',
          );
        }
        categoryIds = [defaultRows[0]!.id];
      }

      const conn = tx.getConnection();
      await conn.execute(
        `insert into blog_posts
           (id, name, slug, active, status, published_at, description,
            meta_title, meta_description, meta_keywords, content,
            version, created_at, updated_at)
           values (?, ?::jsonb, ?, ?, 'draft', null, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1, ?, ?)`,
        [
          id,
          JSON.stringify(input.name),
          input.slug,
          input.active ?? true,
          input.description ?? null,
          input.metaTitle ? JSON.stringify(input.metaTitle) : null,
          input.metaDescription ? JSON.stringify(input.metaDescription) : null,
          input.metaKeywords ? JSON.stringify(input.metaKeywords) : null,
          input.content ? JSON.stringify(input.content) : '{}',
          now,
          now,
        ],
      );

      for (const channelId of input.salesChannelIds) {
        await conn.execute(
          `insert into blog_post_sales_channels (blog_post_id, sales_channel_id, slug)
             values (?, ?, ?)`,
          [id, channelId, input.slug],
        );
      }

      for (const language of input.languages) {
        await conn.execute(
          `insert into blog_post_languages (blog_post_id, language) values (?, ?)`,
          [id, language],
        );
      }

      for (const categoryId of categoryIds) {
        await conn.execute(
          `insert into blog_post_categories (blog_post_id, blog_category_id) values (?, ?)`,
          [id, categoryId],
        );
      }

      for (let i = 0; i < (input.tagIds ?? []).length; i++) {
        await conn.execute(
          `insert into blog_post_tags (blog_post_id, blog_tag_id, position) values (?, ?, ?)`,
          [id, input.tagIds![i], i],
        );
      }

      return this.getByIdInTx(tx, id);
    });
  }

  async getById(id: string): Promise<BlogPostDetail> {
    return this.getByIdInTx(this.emFactory(), id);
  }

  async patch(id: string, input: PatchBlogPostRequest): Promise<BlogPostDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, input.version);

      const slugChange = input.slug !== undefined && input.slug !== existing.slug;
      const channelChange = input.salesChannelIds !== undefined;

      // Slug-collision guard whenever slug or channel scope changes.
      if (slugChange || channelChange) {
        const targetSlug = input.slug ?? existing.slug;
        const targetChannels =
          input.salesChannelIds ?? (await this.loadChannelIds(tx, id));
        await assertSlugAvailable(tx, {
          slug: targetSlug,
          salesChannelIds: targetChannels,
          kind: 'post',
          excludeId: id,
        });
      }

      const sets: string[] = ['version = version + 1', 'updated_at = now()'];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?::jsonb');
        params.push(JSON.stringify(input.name));
      }
      if (input.slug !== undefined) {
        sets.push('slug = ?');
        params.push(input.slug);
      }
      if (input.active !== undefined) {
        sets.push('active = ?');
        params.push(input.active);
      }
      if (input.description !== undefined) {
        sets.push('description = ?');
        params.push(input.description);
      }
      if (input.metaTitle !== undefined) {
        sets.push('meta_title = ?::jsonb');
        params.push(input.metaTitle ? JSON.stringify(input.metaTitle) : null);
      }
      if (input.metaDescription !== undefined) {
        sets.push('meta_description = ?::jsonb');
        params.push(input.metaDescription ? JSON.stringify(input.metaDescription) : null);
      }
      if (input.metaKeywords !== undefined) {
        sets.push('meta_keywords = ?::jsonb');
        params.push(input.metaKeywords ? JSON.stringify(input.metaKeywords) : null);
      }

      if (sets.length > 2) {
        // there's at least one field beyond the two bookkeeping sets
        params.push(id);
        await tx.getConnection().execute(
          `update blog_posts set ${sets.join(', ')} where id = ?`,
          params,
        );
      }

      // Sync the slug mirror onto the scope rows whenever the slug changes.
      if (slugChange) {
        await tx.getConnection().execute(
          `update blog_post_sales_channels set slug = ? where blog_post_id = ?`,
          [input.slug, id],
        );
      }

      // Sync sales-channel scope.
      if (channelChange) {
        await this.replaceChannels(tx, id, input.salesChannelIds!, input.slug ?? existing.slug);
      }
      // Sync language scope.
      if (input.languages !== undefined) {
        const currentLanguages = await this.loadLanguages(tx, id);
        await this.validateLanguages(input.languages, currentLanguages);
        await this.replaceLanguages(tx, id, input.languages);
      }
      // Sync categories.
      if (input.categoryIds !== undefined) {
        const catIds = input.categoryIds.length > 0
          ? input.categoryIds
          : await this.fallbackToDefaultCategory(tx);
        await this.replaceCategories(tx, id, catIds);
      }
      // Sync tags (ordered).
      if (input.tagIds !== undefined) {
        await this.replaceTags(tx, id, input.tagIds);
      }

      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCacheForPost(existing.slug, detail.slug);
      return detail;
    });
  }

  async setContent(
    id: string,
    input: PutBlogPostContentRequest,
  ): Promise<BlogPostDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, input.version);
      await tx.getConnection().execute(
        `update blog_posts
            set content = ?::jsonb,
                version = version + 1,
                updated_at = now()
          where id = ?`,
        [JSON.stringify(input.content), id],
      );
      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCacheForPost(existing.slug, detail.slug);
      return detail;
    });
  }

  async setTags(id: string, tagIds: string[], version: number): Promise<BlogPostDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, version);
      await this.replaceTags(tx, id, tagIds);
      await tx.getConnection().execute(
        `update blog_posts set version = version + 1, updated_at = now() where id = ?`,
        [id],
      );
      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCacheForPost(existing.slug, detail.slug);
      return detail;
    });
  }

  async setRelatedPosts(
    id: string,
    relatedPostIds: string[],
    version: number,
  ): Promise<BlogPostDetail> {
    if (relatedPostIds.includes(id)) {
      throw new HttpError(
        422,
        ERROR_CODES.BLOG_RELATED_POST_SELF_REFERENCE,
        'A post cannot list itself as a Related Post.',
      );
    }
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, version);
      const conn = tx.getConnection();
      await conn.execute(
        `delete from blog_post_related_posts where parent_post_id = ?`,
        [id],
      );
      for (let i = 0; i < relatedPostIds.length; i++) {
        await conn.execute(
          `insert into blog_post_related_posts (parent_post_id, related_post_id, position)
             values (?, ?, ?)`,
          [id, relatedPostIds[i], i],
        );
      }
      await conn.execute(
        `update blog_posts set version = version + 1, updated_at = now() where id = ?`,
        [id],
      );
      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCacheForPost(existing.slug, detail.slug);
      return detail;
    });
  }

  async setRelatedProducts(
    id: string,
    productIds: string[],
    version: number,
  ): Promise<BlogPostDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, version);
      const conn = tx.getConnection();
      await conn.execute(
        `delete from blog_post_related_products where blog_post_id = ?`,
        [id],
      );
      for (let i = 0; i < productIds.length; i++) {
        await conn.execute(
          `insert into blog_post_related_products (blog_post_id, product_id, position)
             values (?, ?, ?)`,
          [id, productIds[i], i],
        );
      }
      await conn.execute(
        `update blog_posts set version = version + 1, updated_at = now() where id = ?`,
        [id],
      );
      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCacheForPost(existing.slug, detail.slug);
      return detail;
    });
  }

  async publish(id: string, version: number): Promise<BlogPostDetail> {
    return this.transitionStatus(id, version, 'published', { setPublishedAt: true });
  }

  async unpublish(id: string, version: number): Promise<BlogPostDetail> {
    return this.transitionStatus(id, version, 'draft', { setPublishedAt: false });
  }

  async archive(id: string, version: number): Promise<BlogPostDetail> {
    return this.transitionStatus(id, version, 'archived', { setPublishedAt: false });
  }

  async softDelete(id: string, version: number): Promise<{ detachedFromParents: string[] }> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, version);
      const conn = tx.getConnection();

      // Capture parents that reference this post as related so the
      // response can list them (R5).
      const parents = (await conn.execute(
        `select parent_post_id::text as id from blog_post_related_posts where related_post_id = ?`,
        [id],
      )) as Array<{ id: string }>;
      const parentIds = parents.map((p) => p.id);

      // Detach the inbound related-post references atomically.
      if (parentIds.length > 0) {
        await conn.execute(
          `delete from blog_post_related_posts where related_post_id = ?`,
          [id],
        );
      }

      // Soft-delete the post + sync the deleted_at mirror onto the
      // scope rows so the partial-unique slug index releases the slug.
      await conn.execute(
        `update blog_posts set deleted_at = now(), updated_at = now() where id = ?`,
        [id],
      );
      await conn.execute(
        `update blog_post_sales_channels set deleted_at = now() where blog_post_id = ?`,
        [id],
      );

      await this.invalidateCacheForPost(existing.slug, existing.slug);
      return { detachedFromParents: parentIds };
    });
  }

  async getInboundReferences(id: string): Promise<BlogPostInboundReferencesResponse> {
    const conn = this.emFactory().getConnection();
    const rows = (await conn.execute(
      `select p.id::text as id, p.name, p.slug
         from blog_post_related_posts r
         join blog_posts p on p.id = r.parent_post_id
        where r.related_post_id = ?
          and p.deleted_at is null
        order by p.slug`,
      [id],
    )) as Array<{ id: string; name: Record<string, string>; slug: string }>;
    return {
      asRelatedPostBy: rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug })),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async transitionStatus(
    id: string,
    version: number,
    nextStatus: BlogPostStatus,
    opts: { setPublishedAt: boolean },
  ): Promise<BlogPostDetail> {
    const em = this.emFactory();
    const detail = await em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
      }
      this.assertVersion(existing.version, version);
      const sets: string[] = ['status = ?', 'version = version + 1', 'updated_at = now()'];
      const params: unknown[] = [nextStatus];
      if (opts.setPublishedAt && existing.published_at === null) {
        sets.push('published_at = now()');
      }
      params.push(id);
      await tx.getConnection().execute(
        `update blog_posts set ${sets.join(', ')} where id = ?`,
        params,
      );
      return this.getByIdInTx(tx, id);
    });
    // Invalidate AFTER the transaction commits. Doing it inside the
    // transaction (before commit) opens a race: a concurrent storefront read
    // can repopulate the cache with the pre-commit row — e.g. the still-draft
    // version excluded from published listings — and that stale entry then
    // survives until the TTL, so a freshly published post stays invisible on
    // the blog list. Publishing is exactly the transition users report here.
    await this.invalidateCacheForPost(detail.slug, detail.slug);
    return detail;
  }

  private async findRow(em: EntityManager, id: string): Promise<PostRow | null> {
    const rows = (await em.getConnection().execute(
      `select * from blog_posts where id = ? and deleted_at is null limit 1`,
      [id],
    )) as PostRow[];
    return rows[0] ?? null;
  }

  private assertVersion(have: number, sent: number | undefined): void {
    if (sent !== undefined && sent !== have) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        `Blog post was updated concurrently (have v${have}, request v${sent}).`,
      );
    }
  }

  private async getByIdInTx(em: EntityManager, id: string): Promise<BlogPostDetail> {
    const row = await this.findRow(em, id);
    if (!row) {
      throw new HttpError(404, ERROR_CODES.BLOG_POST_NOT_FOUND, 'Blog post not found.');
    }
    const conn = em.getConnection();

    const [channels, languages, categories, tags, relatedPosts, relatedProducts] =
      (await Promise.all([
        conn.execute(
          `select sales_channel_id::text as id from blog_post_sales_channels where blog_post_id = ? and deleted_at is null`,
          [id],
        ),
        conn.execute(
          `select language from blog_post_languages where blog_post_id = ?`,
          [id],
        ),
        conn.execute(
          `select blog_category_id::text as id from blog_post_categories where blog_post_id = ?`,
          [id],
        ),
        conn.execute(
          `select t.id::text as id, t.code, bpt.position
             from blog_post_tags bpt
             join blog_tags t on t.id = bpt.blog_tag_id and t.deleted_at is null
            where bpt.blog_post_id = ?
            order by bpt.position`,
          [id],
        ),
        conn.execute(
          `select related_post_id::text as id from blog_post_related_posts where parent_post_id = ? order by position`,
          [id],
        ),
        conn.execute(
          `select product_id::text as id from blog_post_related_products where blog_post_id = ? order by position`,
          [id],
        ),
      ])) as [
        Array<{ id: string }>,
        Array<{ language: string }>,
        Array<{ id: string }>,
        Array<{ id: string; code: string; position: number }>,
        Array<{ id: string }>,
        Array<{ id: string }>,
      ];

    const detail: BlogPostDetail = {
      id: row.id,
      name: row.name,
      slug: row.slug,
      active: row.active,
      status: row.status,
      publishedAt: this.toIso(row.published_at),
      description: row.description,
      metaTitle: row.meta_title,
      metaDescription: row.meta_description,
      metaKeywords: row.meta_keywords,
      meta: null, // legacy field not used; consumers read metaTitle/metaDescription/metaKeywords
      content: this.normaliseContent(row.content),
      version: row.version,
      createdAt: this.toIsoNonNull(row.created_at),
      updatedAt: this.toIsoNonNull(row.updated_at),
      salesChannelIds: channels.map((c) => c.id),
      languages: languages.map((l) => l.language),
      categoryIds: categories.map((c) => c.id),
      tagIds: tags.map((t) => t.id),
      tags: tags.map((t) => ({ id: t.id, code: t.code, position: t.position })),
      relatedPostIds: relatedPosts.map((r) => r.id),
      relatedProductIds: relatedProducts.map((p) => p.id),
    };
    return detail;
  }

  private async toSummary(row: PostRow): Promise<BlogPostSummary> {
    const conn = this.emFactory().getConnection();
    const [channels, languages, categories, tags] = (await Promise.all([
      conn.execute(
        `select sales_channel_id::text as id from blog_post_sales_channels where blog_post_id = ? and deleted_at is null`,
        [row.id],
      ),
      conn.execute(
        `select language from blog_post_languages where blog_post_id = ?`,
        [row.id],
      ),
      conn.execute(
        `select blog_category_id::text as id from blog_post_categories where blog_post_id = ?`,
        [row.id],
      ),
      conn.execute(
        `select blog_tag_id::text as id from blog_post_tags where blog_post_id = ?`,
        [row.id],
      ),
    ])) as [
      Array<{ id: string }>,
      Array<{ language: string }>,
      Array<{ id: string }>,
      Array<{ id: string }>,
    ];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      active: row.active,
      publishedAt: this.toIso(row.published_at),
      description: row.description,
      version: row.version,
      createdAt: this.toIsoNonNull(row.created_at),
      updatedAt: this.toIsoNonNull(row.updated_at),
      salesChannelIds: channels.map((c) => c.id),
      languages: languages.map((l) => l.language),
      categoryIds: categories.map((c) => c.id),
      tagIds: tags.map((t) => t.id),
    };
  }

  private normaliseContent(
    raw: { schema_version?: number; languages?: Record<string, unknown> } | null,
  ): { schema_version: number; languages: Record<string, unknown> } {
    if (!raw || typeof raw !== 'object') {
      return { schema_version: 1, languages: {} };
    }
    return {
      schema_version: typeof raw.schema_version === 'number' ? raw.schema_version : 1,
      languages: raw.languages ?? {},
    };
  }

  private toIso(value: Date | string | null): string | null {
    if (value === null || value === undefined) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private toIsoNonNull(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private async loadChannelIds(em: EntityManager, postId: string): Promise<string[]> {
    const rows = (await em.getConnection().execute(
      `select sales_channel_id::text as id from blog_post_sales_channels where blog_post_id = ? and deleted_at is null`,
      [postId],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  private async loadLanguages(em: EntityManager, postId: string): Promise<string[]> {
    const rows = (await em.getConnection().execute(
      `select language from blog_post_languages where blog_post_id = ?`,
      [postId],
    )) as Array<{ language: string }>;
    return rows.map((r) => r.language);
  }

  private async validateLanguages(
    languages: string[],
    currentLanguages: string[] = [],
  ): Promise<void> {
    if (!this.dictionaryValidator) return;
    const current = new Set(currentLanguages);
    for (const language of languages) {
      try {
        await this.dictionaryValidator.validateLanguageCode(
          language,
          current.has(language) ? 'unchanged' : 'create-or-change',
        );
      } catch (err) {
        if (err instanceof DictionaryReferenceError) {
          throw new HttpError(
            409,
            err.code,
            err.code === 'DICTIONARY_ENTRY_INACTIVE'
              ? `Language code ${err.entryCode} is no longer available for blog posts.`
              : `Language code ${err.entryCode} is not recognised.`,
            [{ path: 'languages', issue: err.code }],
          );
        }
        throw err;
      }
    }
  }

  private async replaceChannels(
    em: EntityManager,
    postId: string,
    channelIds: string[],
    slug: string,
  ): Promise<void> {
    const conn = em.getConnection();
    await conn.execute(`delete from blog_post_sales_channels where blog_post_id = ?`, [postId]);
    for (const id of channelIds) {
      await conn.execute(
        `insert into blog_post_sales_channels (blog_post_id, sales_channel_id, slug) values (?, ?, ?)`,
        [postId, id, slug],
      );
    }
  }

  private async replaceLanguages(
    em: EntityManager,
    postId: string,
    languages: string[],
  ): Promise<void> {
    const conn = em.getConnection();
    await conn.execute(`delete from blog_post_languages where blog_post_id = ?`, [postId]);
    for (const lang of languages) {
      await conn.execute(
        `insert into blog_post_languages (blog_post_id, language) values (?, ?)`,
        [postId, lang],
      );
    }
  }

  private async replaceCategories(
    em: EntityManager,
    postId: string,
    categoryIds: string[],
  ): Promise<void> {
    const conn = em.getConnection();
    await conn.execute(`delete from blog_post_categories where blog_post_id = ?`, [postId]);
    for (const id of categoryIds) {
      await conn.execute(
        `insert into blog_post_categories (blog_post_id, blog_category_id) values (?, ?)`,
        [postId, id],
      );
    }
  }

  private async replaceTags(
    em: EntityManager,
    postId: string,
    tagIds: string[],
  ): Promise<void> {
    const conn = em.getConnection();
    await conn.execute(`delete from blog_post_tags where blog_post_id = ?`, [postId]);
    for (let i = 0; i < tagIds.length; i++) {
      await conn.execute(
        `insert into blog_post_tags (blog_post_id, blog_tag_id, position) values (?, ?, ?)`,
        [postId, tagIds[i], i],
      );
    }
  }

  private async fallbackToDefaultCategory(em: EntityManager): Promise<string[]> {
    const rows = (await em.getConnection().execute(
      `select id::text as id from blog_categories where is_system = true and deleted_at is null limit 1`,
    )) as Array<{ id: string }>;
    if (rows.length === 0) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Seeded Default blog category is missing.',
      );
    }
    return [rows[0]!.id];
  }

  private async invalidateCacheForPost(oldSlug: string, newSlug: string): Promise<void> {
    if (!this.cache) return;
    // Cache is per-channel; we invalidate all channels coarsely. Future
    // refinement: track the specific channel scope and invalidate only
    // those keys. Until then, the catastrophic invalidation is correct
    // and the rate of writes is low (operator-driven, not customer-driven).
    await this.cache.invalidateAll();
    void oldSlug;
    void newSlug;
  }
}
