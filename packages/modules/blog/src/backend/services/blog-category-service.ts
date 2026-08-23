import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  type BlogCategoryDetail,
  type BlogCategoryTreeMove,
  type BlogCategoryTreeNode,
  type CreateBlogCategoryRequest,
  type DictionaryValidator,
  type PatchBlogCategoryRequest,
  type PutBlogCategoryDescriptionRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertSlugAvailable } from './blog-slug-collision.js';
import type { BlogCacheService } from './blog-cache.js';

type CategoryRow = {
  id: string;
  parent_id: string | null;
  position: number;
  name: Record<string, string>;
  slug: string;
  enabled: boolean;
  description:
    | { schema_version?: number; languages?: Record<string, unknown> }
    | null;
  main_image_asset_id: string | null;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  is_system: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * BlogCategoryService — feature 016 / T042.
 *
 * Owns the full BlogCategory CRUD + tree-mutation contract documented in
 * `contracts/blog-admin-http.contract.md`. The service runs every write
 * inside an `em.transactional(...)` block; the slug-collision helper
 * acquires per-(channel, slug) advisory locks so a concurrent write
 * cannot squeeze a duplicate past the partial unique indexes.
 *
 * The deletion-protection contract (FR-005 / FR-006 / FR-007 / R11) is
 * enforced in `softDelete`:
 *   - is_system=true → 409 BLOG_CATEGORY_PROTECTED;
 *   - has at least one referencing Post → 409 BLOG_CATEGORY_IN_USE;
 *   - has at least one child Category → 409 BLOG_CATEGORY_HAS_CHILDREN.
 *
 * Cycle prevention runs on every save by walking parent_id up to root
 * and refusing if the target id already appears on the path.
 */
export class BlogCategoryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: BlogCacheService,
    private readonly dictionaryValidator?: DictionaryValidator,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  // CRUD + tree
  // ────────────────────────────────────────────────────────────────────

  async getTree(): Promise<{ tree: BlogCategoryTreeNode[] }> {
    const em = this.emFactory();
    const rows = (await em.execute(
      `select * from blog_categories where deleted_at is null order by parent_id nulls first, position`,
    )) as CategoryRow[];

    const channelsByCategory = await this.loadChannelsByCategory(rows.map((r) => r.id));
    const languagesByCategory = await this.loadLanguagesByCategory(rows.map((r) => r.id));

    const nodes = new Map<string, BlogCategoryTreeNode>();
    const tree: BlogCategoryTreeNode[] = [];

    for (const r of rows) {
      const node: BlogCategoryTreeNode = {
        id: r.id,
        parentId: r.parent_id,
        position: r.position,
        name: r.name,
        slug: r.slug,
        enabled: r.enabled,
        isSystem: r.is_system,
        salesChannelIds: channelsByCategory.get(r.id) ?? [],
        languages: languagesByCategory.get(r.id) ?? [],
        mainImageAssetId: r.main_image_asset_id,
        version: r.version,
        children: [],
      };
      nodes.set(r.id, node);
    }
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      if (r.parent_id === null) {
        tree.push(node);
      } else {
        const parent = nodes.get(r.parent_id);
        if (parent) parent.children.push(node);
      }
    }
    return { tree };
  }

  async getById(id: string): Promise<BlogCategoryDetail> {
    return this.getByIdInTx(this.emFactory(), id);
  }

  async create(input: CreateBlogCategoryRequest): Promise<BlogCategoryDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();

    return em.transactional(async (tx) => {
      // Slug-collision guard runs first so we don't pollute the row.
      await assertSlugAvailable(tx, {
        slug: input.slug,
        salesChannelIds: input.salesChannelIds,
        kind: 'category',
      });
      await this.validateLanguages(input.languages);

      // Cycle check — when creating, parentId can only point at an
      // existing Category. The parent's own ancestry is fine; we only
      // need to verify the parent exists and is not soft-deleted.
      if (input.parentId !== null) {
        await this.assertParentExists(tx, input.parentId);
      }

      // Compute next position for the parent slot.
      const positionRows = (await tx.execute(
        `select coalesce(max(position) + 1, 0) as next_pos
           from blog_categories
          where deleted_at is null and ${input.parentId === null ? 'parent_id is null' : 'parent_id = ?'}`,
        input.parentId === null ? [] : [input.parentId],
      )) as Array<{ next_pos: number }>;
      const position = Number(positionRows[0]?.next_pos ?? 0);

      await tx.execute(
        `insert into blog_categories
           (id, parent_id, position, name, slug, enabled, description,
            main_image_asset_id, meta_title, meta_description, meta_keywords,
            is_system, version, created_at, updated_at)
           values (?, ?, ?, ?::jsonb, ?, ?, null, ?, ?::jsonb, ?::jsonb, ?::jsonb, false, 1, ?, ?)`,
        [
          id,
          input.parentId,
          position,
          JSON.stringify(input.name),
          input.slug,
          input.enabled ?? true,
          input.mainImageAssetId ?? null,
          input.metaTitle ? JSON.stringify(input.metaTitle) : null,
          input.metaDescription ? JSON.stringify(input.metaDescription) : null,
          input.metaKeywords ? JSON.stringify(input.metaKeywords) : null,
          now,
          now,
        ],
      );

      for (const channelId of input.salesChannelIds) {
        await tx.execute(
          `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug)
             values (?, ?, ?)`,
          [id, channelId, input.slug],
        );
      }
      for (const language of input.languages) {
        await tx.execute(
          `insert into blog_category_languages (blog_category_id, language) values (?, ?)`,
          [id, language],
        );
      }

      return this.getByIdInTx(tx, id);
    });
  }

  async patch(
    id: string,
    input: PatchBlogCategoryRequest,
  ): Promise<BlogCategoryDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(
          404,
          ERROR_CODES.BLOG_CATEGORY_NOT_FOUND,
          'Blog category not found.',
        );
      }
      this.assertVersion(existing.version, input.version);

      // Slug-collision guard whenever slug or channel scope changes.
      const slugChange = input.slug !== undefined && input.slug !== existing.slug;
      const channelChange = input.salesChannelIds !== undefined;
      if (slugChange || channelChange) {
        const targetSlug = input.slug ?? existing.slug;
        const targetChannels =
          input.salesChannelIds ?? (await this.loadChannelIds(tx, id));
        await assertSlugAvailable(tx, {
          slug: targetSlug,
          salesChannelIds: targetChannels,
          kind: 'category',
          excludeId: id,
        });
      }

      // parentId change → cycle check.
      if (input.parentId !== undefined && input.parentId !== existing.parent_id) {
        if (input.parentId !== null) {
          await this.assertParentExists(tx, input.parentId);
          await this.assertNoCycle(tx, id, input.parentId);
        }
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
      if (input.enabled !== undefined) {
        sets.push('enabled = ?');
        params.push(input.enabled);
      }
      if (input.mainImageAssetId !== undefined) {
        sets.push('main_image_asset_id = ?');
        params.push(input.mainImageAssetId);
      }
      if (input.parentId !== undefined) {
        sets.push('parent_id = ?');
        params.push(input.parentId);
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
        params.push(id);
        await tx.execute(
          `update blog_categories set ${sets.join(', ')} where id = ?`,
          params,
        );
      }
      if (slugChange) {
        await tx.execute(
          `update blog_category_sales_channels set slug = ? where blog_category_id = ?`,
          [input.slug, id],
        );
      }
      if (channelChange) {
        await this.replaceChannels(tx, id, input.salesChannelIds!, input.slug ?? existing.slug);
      }
      if (input.languages !== undefined) {
        const currentLanguages = await this.loadLanguages(tx, id);
        await this.validateLanguages(input.languages, currentLanguages);
        await this.replaceLanguages(tx, id, input.languages);
      }

      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCache(existing.slug, detail.slug);
      return detail;
    });
  }

  async setDescription(
    id: string,
    input: PutBlogCategoryDescriptionRequest,
  ): Promise<BlogCategoryDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(
          404,
          ERROR_CODES.BLOG_CATEGORY_NOT_FOUND,
          'Blog category not found.',
        );
      }
      this.assertVersion(existing.version, input.version);
      await tx.execute(
        `update blog_categories
            set description = ?::jsonb,
                version = version + 1,
                updated_at = now()
          where id = ?`,
        [input.description ? JSON.stringify(input.description) : null, id],
      );
      const detail = await this.getByIdInTx(tx, id);
      await this.invalidateCache(existing.slug, detail.slug);
      return detail;
    });
  }

  async applyTreeMoves(moves: BlogCategoryTreeMove[]): Promise<{ tree: BlogCategoryTreeNode[] }> {
    if (moves.length === 0) return this.getTree();
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      // Cycle prevention runs against the post-move state.
      // Load the current parent_id map so we can simulate the moves and
      // refuse the whole batch if any move introduces a cycle.
      const currentRows = (await tx.execute(
        `select id::text as id, parent_id::text as parent_id from blog_categories where deleted_at is null`,
      )) as Array<{ id: string; parent_id: string | null }>;
      const parentMap = new Map<string, string | null>();
      for (const r of currentRows) parentMap.set(r.id, r.parent_id);
      for (const m of moves) parentMap.set(m.id, m.parentId);
      for (const m of moves) {
        if (m.parentId === null) continue;
        // Walk up from the proposed parent looking for the moved id.
        let cursor: string | null = m.parentId;
        const visited = new Set<string>();
        while (cursor !== null) {
          if (cursor === m.id) {
            throw new HttpError(
              422,
              ERROR_CODES.BLOG_CATEGORY_CYCLE,
              `Move would introduce a cycle: ${m.id} cannot be its own ancestor.`,
            );
          }
          if (visited.has(cursor)) break;
          visited.add(cursor);
          cursor = parentMap.get(cursor) ?? null;
        }
      }

      for (const m of moves) {
        await tx.execute(
          `update blog_categories
              set parent_id = ?, position = ?, version = version + 1, updated_at = now()
            where id = ? and deleted_at is null`,
          [m.parentId, m.position, m.id],
        );
      }
    });
    if (this.cache) await this.cache.invalidateAll();
    return this.getTree();
  }

  async softDelete(id: string, version: number | undefined): Promise<void> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(
          404,
          ERROR_CODES.BLOG_CATEGORY_NOT_FOUND,
          'Blog category not found.',
        );
      }
      this.assertVersion(existing.version, version);
      if (existing.is_system) {
        throw new HttpError(
          409,
          ERROR_CODES.BLOG_CATEGORY_PROTECTED,
          'The seeded Default category cannot be deleted.',
        );
      }

      // Block on referencing Posts.
      const refRows = (await tx.execute(
        `select count(*)::int as n from blog_post_categories where blog_category_id = ?`,
        [id],
      )) as Array<{ n: number }>;
      if ((refRows[0]?.n ?? 0) > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.BLOG_CATEGORY_IN_USE,
          'Category has at least one referencing post; reassign or archive those posts before deletion.',
        );
      }

      // Block on child Categories.
      const childRows = (await tx.execute(
        `select count(*)::int as n from blog_categories where parent_id = ? and deleted_at is null`,
        [id],
      )) as Array<{ n: number }>;
      if ((childRows[0]?.n ?? 0) > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.BLOG_CATEGORY_HAS_CHILDREN,
          'Category has at least one child; reparent or delete children first.',
        );
      }

      await tx.execute(
        `update blog_categories set deleted_at = now(), updated_at = now() where id = ?`,
        [id],
      );
      await tx.execute(
        `update blog_category_sales_channels set deleted_at = now() where blog_category_id = ?`,
        [id],
      );
    });
    if (this.cache) await this.cache.invalidateAll();
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async findRow(em: EntityManager, id: string): Promise<CategoryRow | null> {
    const rows = (await em.execute(
      `select * from blog_categories where id = ? and deleted_at is null limit 1`,
      [id],
    )) as CategoryRow[];
    return rows[0] ?? null;
  }

  private async assertParentExists(em: EntityManager, parentId: string): Promise<void> {
    const rows = (await em.execute(
      `select 1 from blog_categories where id = ? and deleted_at is null limit 1`,
      [parentId],
    )) as Array<unknown>;
    if (rows.length === 0) {
      throw new HttpError(
        404,
        ERROR_CODES.BLOG_CATEGORY_NOT_FOUND,
        `Parent category ${parentId} not found.`,
      );
    }
  }

  private async assertNoCycle(
    em: EntityManager,
    selfId: string,
    parentId: string,
  ): Promise<void> {
    const rows = (await em.execute(
      `select id::text as id, parent_id::text as parent_id from blog_categories where deleted_at is null`,
    )) as Array<{ id: string; parent_id: string | null }>;
    const map = new Map<string, string | null>();
    for (const r of rows) map.set(r.id, r.parent_id);
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor !== null) {
      if (cursor === selfId) {
        throw new HttpError(
          422,
          ERROR_CODES.BLOG_CATEGORY_CYCLE,
          `Setting parent ${parentId} would create a cycle for category ${selfId}.`,
        );
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);
      cursor = map.get(cursor) ?? null;
    }
  }

  private assertVersion(have: number, sent: number | undefined): void {
    if (sent !== undefined && sent !== have) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        `Blog category was updated concurrently (have v${have}, request v${sent}).`,
      );
    }
  }

  private async getByIdInTx(em: EntityManager, id: string): Promise<BlogCategoryDetail> {
    const row = await this.findRow(em, id);
    if (!row) {
      throw new HttpError(
        404,
        ERROR_CODES.BLOG_CATEGORY_NOT_FOUND,
        'Blog category not found.',
      );
    }
    const [channels, languages] = (await Promise.all([
      em.execute(
        `select sales_channel_id::text as id from blog_category_sales_channels where blog_category_id = ? and deleted_at is null`,
        [id],
      ),
      em.execute(
        `select language from blog_category_languages where blog_category_id = ?`,
        [id],
      ),
    ])) as [Array<{ id: string }>, Array<{ language: string }>];

    return {
      id: row.id,
      parentId: row.parent_id,
      position: row.position,
      name: row.name,
      slug: row.slug,
      enabled: row.enabled,
      isSystem: row.is_system,
      salesChannelIds: channels.map((c) => c.id),
      languages: languages.map((l) => l.language),
      mainImageAssetId: row.main_image_asset_id,
      metaTitle: row.meta_title,
      metaDescription: row.meta_description,
      metaKeywords: row.meta_keywords,
      description: row.description
        ? {
            schema_version:
              typeof row.description.schema_version === 'number'
                ? row.description.schema_version
                : 1,
            languages: row.description.languages ?? {},
          }
        : null,
      version: row.version,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private async loadChannelIds(em: EntityManager, categoryId: string): Promise<string[]> {
    const rows = (await em.execute(
      `select sales_channel_id::text as id from blog_category_sales_channels where blog_category_id = ? and deleted_at is null`,
      [categoryId],
    )) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  private async loadLanguages(em: EntityManager, categoryId: string): Promise<string[]> {
    const rows = (await em.execute(
      `select language from blog_category_languages where blog_category_id = ?`,
      [categoryId],
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
              ? `Language code ${err.entryCode} is no longer available for blog categories.`
              : `Language code ${err.entryCode} is not recognised.`,
            [{ path: 'languages', issue: err.code }],
          );
        }
        throw err;
      }
    }
  }

  private async loadChannelsByCategory(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = (await this.emFactory().execute(
      `select blog_category_id::text as cid, sales_channel_id::text as id
         from blog_category_sales_channels
        where blog_category_id in (${placeholders})
          and deleted_at is null`,
      ids,
    )) as Array<{ cid: string; id: string }>;
    for (const r of rows) {
      const list = out.get(r.cid) ?? [];
      list.push(r.id);
      out.set(r.cid, list);
    }
    return out;
  }

  private async loadLanguagesByCategory(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = (await this.emFactory().execute(
      `select blog_category_id::text as cid, language
         from blog_category_languages
        where blog_category_id in (${placeholders})`,
      ids,
    )) as Array<{ cid: string; language: string }>;
    for (const r of rows) {
      const list = out.get(r.cid) ?? [];
      list.push(r.language);
      out.set(r.cid, list);
    }
    return out;
  }

  private async replaceChannels(
    em: EntityManager,
    categoryId: string,
    channelIds: string[],
    slug: string,
  ): Promise<void> {
    await em.execute(`delete from blog_category_sales_channels where blog_category_id = ?`, [
      categoryId,
    ]);
    for (const id of channelIds) {
      await em.execute(
        `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug) values (?, ?, ?)`,
        [categoryId, id, slug],
      );
    }
  }

  private async replaceLanguages(
    em: EntityManager,
    categoryId: string,
    languages: string[],
  ): Promise<void> {
    await em.execute(`delete from blog_category_languages where blog_category_id = ?`, [
      categoryId,
    ]);
    for (const lang of languages) {
      await em.execute(
        `insert into blog_category_languages (blog_category_id, language) values (?, ?)`,
        [categoryId, lang],
      );
    }
  }

  private async invalidateCache(_oldSlug: string, _newSlug: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.invalidateAll();
  }
}
