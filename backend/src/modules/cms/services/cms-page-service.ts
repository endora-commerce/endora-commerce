import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CmsPageDetail,
  type CmsPageSummary,
  type CreateCmsPageRequest,
  type PatchCmsPageRequest,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { walkBlockEmbeds, walkUnknownComponents } from './content-tree-walker.js';
import type { CmsCache } from './cms-cache.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';

type PageRow = {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'published' | 'archived';
  active: boolean;
  description: string | null;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  content: { schema_version?: number; languages?: Record<string, unknown> };
  languages: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const emptyContent = { schema_version: 1, languages: {} };

export class CmsPageService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly knownComponentNames: () => Iterable<string>,
    private readonly cache?: CmsCache,
    private readonly references?: CmsReferenceRegistry,
  ) {}

  private async invalidateForPageId(pageId: string): Promise<void> {
    if (!this.cache) return;
    const rows = (await this.emFactory().getConnection().execute(
      `select slug from cms_page_sales_channels where page_id = ?
       union
       select slug from cms_pages where id = ?`,
      [pageId, pageId],
    )) as Array<{ slug: string }>;
    const slugs = new Set(rows.map((r) => r.slug).filter((s) => s && s.length > 0));
    if (slugs.size > 0) await this.cache.invalidatePagesBySlug(slugs);
  }

  private async invalidateForSlugs(slugs: Iterable<string>): Promise<void> {
    if (!this.cache) return;
    const filtered = Array.from(slugs).filter((s) => s && s.length > 0);
    if (filtered.length > 0) await this.cache.invalidatePagesBySlug(filtered);
  }

  async list(filters: { salesChannelId?: string; status?: string; q?: string } = {}): Promise<{
    data: CmsPageSummary[];
    nextCursor: null;
  }> {
    const em = this.emFactory();
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.salesChannelId) {
      params.push(filters.salesChannelId);
      where.push(
        `exists (
          select 1 from cms_page_sales_channels cpsc
          where cpsc.page_id = p.id and cpsc.sales_channel_id = ?
        )`,
      );
    }
    if (filters.status) {
      params.push(filters.status);
      where.push('p.status = ?');
    }
    if (filters.q) {
      params.push(`%${filters.q.toLowerCase()}%`);
      where.push('(lower(p.name) like ? or lower(p.slug) like ?)');
      params.push(`%${filters.q.toLowerCase()}%`);
    }

    const rows = (await em.getConnection().execute(
      `select p.* from cms_pages p
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by p.updated_at desc
       limit 50`,
      params,
    )) as PageRow[];

    const data = await Promise.all(rows.map((row) => this.toSummary(row)));
    return { data, nextCursor: null };
  }

  async create(input: CreateCmsPageRequest): Promise<CmsPageDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();
    const meta = this.splitMeta(input.meta ?? null);
    const title = Object.fromEntries(
      input.languages.map((language) => [
        language,
        input.meta?.[language]?.title?.trim() || input.name,
      ]),
    );
    const body = Object.fromEntries(input.languages.map((language) => [language, '']));

    await em.transactional(async (tx) => {
      await this.assertLanguagesInChannelScope(tx, input.languages, input.salesChannelIds);
      await this.assertSlugAvailable(tx, input.slug, input.salesChannelIds);
      await tx.getConnection().execute(
        `insert into cms_pages
          (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
           name, slug, active, description, meta_title, meta_description, meta_keywords,
           content, languages, version)
         values (?, ?, 'draft', ?::jsonb, ?::jsonb, null, null, ?, ?,
           ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1)`,
        [
          id,
          this.legacyPath(input.slug, id),
          JSON.stringify(title),
          JSON.stringify(body),
          now,
          now,
          input.name,
          input.slug,
          input.active ?? true,
          input.description ?? null,
          JSON.stringify(meta.metaTitle),
          JSON.stringify(meta.metaDescription),
          JSON.stringify(meta.metaKeywords),
          JSON.stringify(emptyContent),
          JSON.stringify(input.languages),
        ],
      );
      await this.replaceChannelScope(tx, id, input.salesChannelIds, input.slug);
    });

    await this.invalidateForSlugs([input.slug]);
    return this.get(id);
  }

  async get(id: string): Promise<CmsPageDetail> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
    return this.toDetail(row);
  }

  async patch(id: string, input: PatchCmsPageRequest): Promise<CmsPageDetail> {
    const em = this.emFactory();
    const slugsToInvalidate = new Set<string>();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
      this.assertVersion(row, input.version);
      slugsToInvalidate.add(row.slug);

      const nextSlug = input.slug ?? row.slug;
      const nextChannels = input.salesChannelIds ?? (await this.channelIdsFor(id, tx));
      const nextLanguages = input.languages ?? row.languages;
      await this.assertLanguagesInChannelScope(tx, nextLanguages, nextChannels);
      if (input.slug || input.salesChannelIds) {
        await this.assertSlugAvailable(tx, nextSlug, nextChannels, id);
      }

      const meta = input.meta !== undefined ? this.splitMeta(input.meta ?? null) : null;
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (sql: string, value: unknown) => {
        sets.push(sql);
        params.push(value);
      };

      if (input.name !== undefined) set('name = ?', input.name);
      if (input.slug !== undefined) set('slug = ?', input.slug);
      if (input.active !== undefined) set('active = ?', input.active);
      if (input.description !== undefined) set('description = ?', input.description);
      if (input.languages !== undefined) set('languages = ?::jsonb', JSON.stringify(input.languages));
      if (meta) {
        set('meta_title = ?::jsonb', JSON.stringify(meta.metaTitle));
        set('meta_description = ?::jsonb', JSON.stringify(meta.metaDescription));
        set('meta_keywords = ?::jsonb', JSON.stringify(meta.metaKeywords));
      }

      if (sets.length > 0) {
        params.push(id);
        await tx.getConnection().execute(
          `update cms_pages
           set ${sets.join(', ')}, version = version + 1, updated_at = now()
           where id = ?`,
          params,
        );
      }
      if (input.salesChannelIds || input.slug) {
        await this.replaceChannelScope(tx, id, nextChannels, nextSlug);
      }
      slugsToInvalidate.add(nextSlug);
    });

    await this.invalidateForSlugs(slugsToInvalidate);
    return this.get(id);
  }

  async setContent(id: string, language: string, data: unknown, version: number): Promise<CmsPageDetail> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
      this.assertVersion(row, version);

      const unknown = walkUnknownComponents(data, new Set(this.knownComponentNames()));
      if (unknown.size > 0) {
        console.warn(
          `CMS page ${id} saved with unknown components: ${Array.from(unknown).join(', ')}`,
        );
      }
      await this.assertBlockEmbedsExist(tx, data, await this.channelIdsFor(id, tx));

      const content = {
        schema_version: row.content.schema_version ?? 1,
        languages: {
          ...(row.content.languages ?? {}),
          [language]: data,
        },
      };
      const languages = row.languages.includes(language) ? row.languages : [...row.languages, language];
      await this.assertLanguagesInChannelScope(tx, languages, await this.channelIdsFor(id, tx));

      await tx.getConnection().execute(
        `update cms_pages
         set content = ?::jsonb, languages = ?::jsonb, version = version + 1, updated_at = now()
         where id = ?`,
        [JSON.stringify(content), JSON.stringify(languages), id],
      );
    });

    await this.invalidateForPageId(id);
    return this.get(id);
  }

  async publish(id: string): Promise<CmsPageDetail> {
    return this.transition(id, 'published');
  }

  async archive(id: string): Promise<CmsPageDetail> {
    return this.transition(id, 'archived');
  }

  async unarchive(id: string): Promise<CmsPageDetail> {
    return this.transition(id, 'draft');
  }

  async delete(id: string): Promise<void> {
    if (this.references) {
      const refs = await this.references.findPageReferences(id);
      if (refs.length > 0) {
        throw new HttpError(409, ERROR_CODES.CMS_REFERENCED, 'CMS Page is referenced.');
      }
    }
    await this.invalidateForPageId(id);
    await this.emFactory().getConnection().execute('delete from cms_pages where id = ?', [id]);
  }

  private async transition(
    id: string,
    status: 'draft' | 'published' | 'archived',
  ): Promise<CmsPageDetail> {
    const em = this.emFactory();
    const row = await this.findRow(id, em);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');

    await em.getConnection().execute(
      `update cms_pages
       set status = ?,
           published_at = case when ? = 'published' then now() else published_at end,
           archived_at = case when ? = 'archived' then now() else null end,
           version = version + 1,
           updated_at = now()
       where id = ?`,
      [status, status, status, id],
    );
    await this.invalidateForPageId(id);
    return this.get(id);
  }

  private async findRow(id: string, em = this.emFactory()): Promise<PageRow | null> {
    const rows = (await em.getConnection().execute('select * from cms_pages where id = ?', [
      id,
    ])) as PageRow[];
    return rows[0] ?? null;
  }

  private async assertSlugAvailable(
    em: EntityManager,
    slug: string,
    salesChannelIds: string[],
    exceptPageId?: string,
  ): Promise<void> {
    if (salesChannelIds.length === 0) return;
    const placeholders = salesChannelIds.map(() => '?').join(', ');
    const rows = (await em.getConnection().execute(
      `select page_id from cms_page_sales_channels
       where slug = ? and sales_channel_id in (${placeholders})
       ${exceptPageId ? 'and page_id <> ?' : ''}
       limit 1`,
      exceptPageId ? [slug, ...salesChannelIds, exceptPageId] : [slug, ...salesChannelIds],
    )) as Array<{ page_id: string }>;
    if (rows.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_SLUG_CONFLICT, 'CMS Page slug already exists.');
    }
  }

  private async assertLanguagesInChannelScope(
    em: EntityManager,
    languages: string[],
    salesChannelIds: string[],
  ): Promise<void> {
    if (languages.length === 0 || salesChannelIds.length === 0) return;

    const placeholders = salesChannelIds.map(() => '?').join(', ');
    const rows = (await em.getConnection().execute(
      `select languages
       from sales_channels
       where id in (${placeholders})`,
      salesChannelIds,
    )) as Array<{ languages: string[] }>;
    const allowed = new Set(rows.flatMap((row) => row.languages));
    const unsupported = languages.find((language) => !allowed.has(language));
    if (unsupported) {
      throw new HttpError(
        400,
        ERROR_CODES.CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE,
        `CMS Page language "${unsupported}" is not configured for the assigned sales channels.`,
      );
    }
  }

  private async replaceChannelScope(
    em: EntityManager,
    pageId: string,
    salesChannelIds: string[],
    slug: string,
  ): Promise<void> {
    await em.getConnection().execute('delete from cms_page_sales_channels where page_id = ?', [
      pageId,
    ]);
    for (const salesChannelId of salesChannelIds) {
      await em.getConnection().execute(
        `insert into cms_page_sales_channels (page_id, sales_channel_id, slug)
         values (?, ?, ?)`,
        [pageId, salesChannelId, slug],
      );
    }
  }

  private async assertBlockEmbedsExist(
    em: EntityManager,
    data: unknown,
    salesChannelIds: string[],
  ): Promise<void> {
    const codes = Array.from(walkBlockEmbeds(data));
    if (codes.length === 0 || salesChannelIds.length === 0) return;

    const codePlaceholders = codes.map(() => '?').join(', ');
    const channelPlaceholders = salesChannelIds.map(() => '?').join(', ');
    const rows = (await em.getConnection().execute(
      `select distinct code
       from cms_block_sales_channels
       where code in (${codePlaceholders})
         and sales_channel_id in (${channelPlaceholders})`,
      [...codes, ...salesChannelIds],
    )) as Array<{ code: string }>;
    const found = new Set(rows.map((row) => row.code));
    const missing = codes.find((code) => !found.has(code));
    if (missing) {
      throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, `CMS Block "${missing}" not found.`);
    }
  }

  private async channelIdsFor(pageId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.getConnection().execute(
      'select sales_channel_id::text as id from cms_page_sales_channels where page_id = ?',
      [pageId],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private assertVersion(row: PageRow, version: number | undefined): void {
    if (version !== undefined && version !== row.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'CMS Page was updated concurrently.');
    }
  }

  private splitMeta(
    meta: CreateCmsPageRequest['meta'] | null,
  ): {
    metaTitle: Record<string, string>;
    metaDescription: Record<string, string>;
    metaKeywords: Record<string, string>;
  } {
    const metaTitle: Record<string, string> = {};
    const metaDescription: Record<string, string> = {};
    const metaKeywords: Record<string, string> = {};
    const entries = Object.entries(meta ?? {}) as Array<
      [
        string,
        {
          title?: string | undefined;
          description?: string | undefined;
          keywords?: string | undefined;
        },
      ]
    >;
    for (const [language, value] of entries) {
      if (value.title !== undefined) metaTitle[language] = value.title;
      if (value.description !== undefined) metaDescription[language] = value.description;
      if (value.keywords !== undefined) metaKeywords[language] = value.keywords;
    }
    return { metaTitle, metaDescription, metaKeywords };
  }

  private async toSummary(row: PageRow): Promise<CmsPageSummary> {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      active: row.active,
      description: row.description,
      salesChannelIds: await this.channelIdsFor(row.id),
      languages: row.languages,
      version: row.version,
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private async toDetail(row: PageRow): Promise<CmsPageDetail> {
    return {
      ...(await this.toSummary(row)),
      meta: this.combineMeta(row),
      content: {
        schema_version: row.content.schema_version ?? 1,
        languages: row.content.languages ?? {},
      },
    };
  }

  private combineMeta(row: PageRow): CmsPageDetail['meta'] {
    const languages = new Set([
      ...Object.keys(row.meta_title ?? {}),
      ...Object.keys(row.meta_description ?? {}),
      ...Object.keys(row.meta_keywords ?? {}),
    ]);
    if (languages.size === 0) return null;

    const meta: NonNullable<CmsPageDetail['meta']> = {};
    for (const language of languages) {
      meta[language] = {
        ...(row.meta_title?.[language] !== undefined
          ? { title: row.meta_title[language] }
          : {}),
        ...(row.meta_description?.[language] !== undefined
          ? { description: row.meta_description[language] }
          : {}),
        ...(row.meta_keywords?.[language] !== undefined
          ? { keywords: row.meta_keywords[language] }
          : {}),
      };
    }
    return meta;
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private legacyPath(slug: string, id: string): string {
    const suffix = id.slice(0, 8);
    return `${slug}-${suffix}`.slice(0, 180);
  }
}
