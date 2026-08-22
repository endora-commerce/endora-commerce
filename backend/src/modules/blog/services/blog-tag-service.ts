import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type BlogPostInboundReference,
  type BlogTagDetail,
  type BlogTagInboundReferencesResponse,
  type CreateBlogTagRequest,
  type PatchBlogTagRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { BlogCacheService } from './blog-cache.js';

type TagRow = {
  id: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  code: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * BlogTagService — feature 016 / T065.
 *
 * CRUD over `blog_tags` with global `code` uniqueness (R14) and block-
 * on-delete (FR-018): deletion is refused with 409 BLOG_TAG_IN_USE
 * (listing the first 25 referencing posts) when at least one
 * `blog_post_tags` row references the tag.
 *
 * Tag → Post attachment (`replaceForPost`) is owned by `BlogPostService`
 * already (`setTags` keeps the ordered list per Post + bumps the post's
 * version); this service exposes `getInboundReferences` to drive the
 * admin's confirmation dialog before the operator commits a delete.
 */
export class BlogTagService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: BlogCacheService,
  ) {}

  async list(filters: {
    q?: string | undefined;
    page?: number | undefined;
    perPage?: number | undefined;
  }): Promise<{
    data: BlogTagDetail[];
    pagination: { page: number; perPage: number; totalPages: number; totalItems: number };
  }> {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(100, Math.max(1, filters.perPage ?? 50));
    const em = this.emFactory();

    const where: string[] = ['deleted_at is null'];
    const params: unknown[] = [];
    if (filters.q) {
      where.push(`(name::text ilike ? or code ilike ?)`);
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const whereSql = `where ${where.join(' and ')}`;

    const totalRows = (await em.execute(
      `select count(*)::int as n from blog_tags ${whereSql}`,
      params,
    )) as Array<{ n: number }>;
    const totalItems = totalRows[0]?.n ?? 0;

    const offset = (page - 1) * perPage;
    const rows = (await em.execute(
      `select * from blog_tags ${whereSql}
        order by code asc
        limit ${perPage} offset ${offset}`,
      params,
    )) as TagRow[];

    return {
      data: rows.map((r) => this.toDetail(r)),
      pagination: {
        page,
        perPage,
        totalPages: Math.max(1, Math.ceil(totalItems / perPage)),
        totalItems,
      },
    };
  }

  async getById(id: string): Promise<BlogTagDetail> {
    const row = await this.findRow(this.emFactory(), id);
    if (!row) {
      throw new HttpError(404, ERROR_CODES.BLOG_TAG_NOT_FOUND, 'Blog tag not found.');
    }
    return this.toDetail(row);
  }

  async create(input: CreateBlogTagRequest): Promise<BlogTagDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();

    return em.transactional(async (tx) => {
      // Probe for friendly 409 before the partial-unique index fires.
      await this.assertCodeAvailable(tx, input.code);
      await tx.execute(
        `insert into blog_tags (id, name, description, code, version, created_at, updated_at)
           values (?, ?::jsonb, ?::jsonb, ?, 1, ?, ?)`,
        [
          id,
          JSON.stringify(input.name),
          input.description ? JSON.stringify(input.description) : null,
          input.code,
          now,
          now,
        ],
      );
      const row = await this.findRow(tx, id);
      return this.toDetail(row!);
    });
  }

  async patch(id: string, input: PatchBlogTagRequest): Promise<BlogTagDetail> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_TAG_NOT_FOUND, 'Blog tag not found.');
      }
      this.assertVersion(existing.version, input.version);

      const codeChange = input.code !== undefined && input.code !== existing.code;
      if (codeChange) {
        await this.assertCodeAvailable(tx, input.code!, id);
      }

      const sets: string[] = ['version = version + 1', 'updated_at = now()'];
      const params: unknown[] = [];
      if (input.name !== undefined) {
        sets.push('name = ?::jsonb');
        params.push(JSON.stringify(input.name));
      }
      if (input.description !== undefined) {
        sets.push('description = ?::jsonb');
        params.push(input.description ? JSON.stringify(input.description) : null);
      }
      if (input.code !== undefined) {
        sets.push('code = ?');
        params.push(input.code);
      }

      params.push(id);
      await tx.execute(
        `update blog_tags set ${sets.join(', ')} where id = ?`,
        params,
      );
      const row = await this.findRow(tx, id);
      const detail = this.toDetail(row!);
      // Tag rename ⇒ blow the storefront cache (URLs change).
      if (codeChange && this.cache) await this.cache.invalidateAll();
      return detail;
    });
  }

  async softDelete(id: string, version: number | undefined): Promise<void> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const existing = await this.findRow(tx, id);
      if (!existing) {
        throw new HttpError(404, ERROR_CODES.BLOG_TAG_NOT_FOUND, 'Blog tag not found.');
      }
      this.assertVersion(existing.version, version);

      const refRows = (await tx.execute(
        `select count(*)::int as n from blog_post_tags where blog_tag_id = ?`,
        [id],
      )) as Array<{ n: number }>;
      if ((refRows[0]?.n ?? 0) > 0) {
        // Build a useful details list (first 25 referencing posts).
        const posts = (await tx.execute(
          `select p.id::text as id, p.name, p.slug
             from blog_post_tags pt
             join blog_posts p on p.id = pt.blog_post_id and p.deleted_at is null
            where pt.blog_tag_id = ?
            order by p.slug
            limit 25`,
          [id],
        )) as Array<{ id: string; name: Record<string, string>; slug: string }>;
        throw new HttpError(
          409,
          ERROR_CODES.BLOG_TAG_IN_USE,
          'Tag is attached to one or more posts; detach it before deletion.',
          posts.map((p) => ({
            path: 'tagId',
            issue: `attached to post id=${p.id} slug=${p.slug}`,
          })),
        );
      }

      await tx.execute(
        `update blog_tags set deleted_at = now(), updated_at = now() where id = ?`,
        [id],
      );
      if (this.cache) await this.cache.invalidateAll();
    });
  }

  async getInboundReferences(id: string): Promise<BlogTagInboundReferencesResponse> {
    const em = this.emFactory();
    const totalRows = (await em.execute(
      `select count(*)::int as n from blog_post_tags where blog_tag_id = ?`,
      [id],
    )) as Array<{ n: number }>;
    const totalPosts = totalRows[0]?.n ?? 0;

    const rows = (await em.execute(
      `select p.id::text as id, p.name, p.slug
         from blog_post_tags pt
         join blog_posts p on p.id = pt.blog_post_id and p.deleted_at is null
        where pt.blog_tag_id = ?
        order by p.slug
        limit 25`,
      [id],
    )) as Array<{ id: string; name: Record<string, string>; slug: string }>;
    const posts: BlogPostInboundReference[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
    }));
    return { posts, totalPosts };
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private async findRow(em: EntityManager, id: string): Promise<TagRow | null> {
    const rows = (await em.execute(
      `select * from blog_tags where id = ? and deleted_at is null limit 1`,
      [id],
    )) as TagRow[];
    return rows[0] ?? null;
  }

  private async assertCodeAvailable(
    em: EntityManager,
    code: string,
    excludeId?: string,
  ): Promise<void> {
    const args: unknown[] = [code];
    let sql = `select 1 from blog_tags where code = ? and deleted_at is null`;
    if (excludeId) {
      sql += ` and id <> ?`;
      args.push(excludeId);
    }
    sql += ` limit 1`;
    const rows = (await em.execute(sql, args)) as Array<unknown>;
    if (rows.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.BLOG_TAG_CODE_TAKEN,
        `A blog tag with code "${code}" already exists.`,
      );
    }
  }

  private assertVersion(have: number, sent: number | undefined): void {
    if (sent !== undefined && sent !== have) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        `Blog tag was updated concurrently (have v${have}, request v${sent}).`,
      );
    }
  }

  private toDetail(row: TagRow): BlogTagDetail {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      code: row.code,
      version: row.version,
      createdAt: this.toIso(row.created_at),
      updatedAt: this.toIso(row.updated_at),
    };
  }

  private toIso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
