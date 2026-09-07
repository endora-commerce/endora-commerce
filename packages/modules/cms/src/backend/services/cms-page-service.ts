import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  firstSlugSegment,
  type CmsPageDetail,
  type CmsPageSummary,
  type CreateCmsPageRequest,
  type PatchCmsPageRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
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
  content: { languages?: Record<string, unknown> };
  languages: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const emptyContent = { languages: {} };

/**
 * Answers the deployment's reserved first path segments
 * (`specs/105-cms-root-page-urls/` FR-032).
 *
 * A function rather than a value because the answer is a Setting an operator
 * may edit while the platform runs, and because reading it is the *module's*
 * job: the resolver is installed in `backend/index.ts`, which is where every
 * other settings-backed value of this module is wired, so no composition root
 * owns a knob on this module's behalf (composition checklist item 6).
 *
 * It answers `unknown` rather than `string[]`, and that is the design: the value
 * is free-form JSON an operator edits, so judging an entry belongs in
 * `normalizeReservedSegments` below — one entry at a time, dropping what it
 * cannot use — and not in a schema whose failure would take every page save down
 * because somebody typed a number into a list.
 */
export type ReservedSlugSegmentsResolver = () => Promise<unknown>;

/**
 * The reserved set as the refusal reads it, from the value an operator typed.
 *
 * The Setting is free-form JSON, so this is forgiving in the three ways an
 * operator's list is likely to be wrong and in no other: `"/cart"` and
 * `"Cart"` and `"checkout/pay"` all mean the segment `cart`, `cart` and
 * `checkout`. A non-string entry is dropped rather than stringified — an
 * operator who typed `["cart", 7]` reserved one segment, not two, and
 * `"7"` reserving a path is a rule nobody wrote.
 */
export function normalizeReservedSegments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const segment = firstSlugSegment(entry.trim());
    if (segment.length > 0) out.add(segment);
  }
  return [...out];
}

export class CmsPageService {
  /**
   * Absent until `registerModule` installs it, and absent means "nothing is
   * reserved". That is the manifest's own default (`defaultValue: []`), so an
   * unwired service and a deployment that reserves nothing answer alike — and
   * a *failing* read is not this state: it propagates, see `reservedSegments`.
   */
  private reservedSegmentsResolver: ReservedSlugSegmentsResolver | null = null;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly knownComponentNames: () => Iterable<string>,
    private readonly cache?: CmsCache,
    private readonly references?: CmsReferenceRegistry,
  ) {}

  setReservedSegmentsResolver(resolver: ReservedSlugSegmentsResolver | null): void {
    this.reservedSegmentsResolver = resolver;
  }

  /**
   * The deployment's reserved first path segments — the **one** value the
   * save-time refusal below and the editor's inline warning both read
   * (FR-033). Two lists would be two answers waiting to disagree, and a warning
   * that disagrees with a refusal is worse than no warning.
   */
  async reservedSegments(): Promise<string[]> {
    if (!this.reservedSegmentsResolver) return [];
    return normalizeReservedSegments(await this.reservedSegmentsResolver());
  }

  /**
   * FR-031 — refuse a slug whose first segment the deployment reserves.
   *
   * Nothing here creates precedence and nothing may (`contracts/cms-page-url.md`
   * §5.0): the storefront's route already wins, measured, with no mechanism.
   * What this removes is the **silence** — a page that saves, publishes and is
   * never served while the operator is told nothing, which is a defect
   * indistinguishable from a legitimate state because the URL answers 200 with
   * somebody else's content.
   *
   * The offending segment travels in `details` so the envelope can fill the
   * `{segment}` placeholder in the operator's own language (§5.4): the code for
   * a consumer to branch on, the sentence for the operator to read.
   */
  private async assertSlugNotReserved(slug: string): Promise<void> {
    const segment = firstSlugSegment(slug);
    if (segment.length === 0) return;
    const reserved = await this.reservedSegments();
    if (!reserved.includes(segment)) return;
    throw new HttpError(
      409,
      ERROR_CODES.CMS_SLUG_RESERVED,
      `The first path segment "${segment}" is reserved by this storefront.`,
      { segment },
    );
  }

  private async invalidateForPageId(pageId: string): Promise<void> {
    if (!this.cache) return;
    const rows = (await this.emFactory().execute(
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

    const rows = (await em.execute(
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
    // Before the transaction, deliberately: this is a judgement on the input
    // against the deployment's configuration and touches no row, so opening a
    // transaction to refuse it would hold a connection for the length of a
    // settings read.
    await this.assertSlugNotReserved(input.slug);
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
      await tx.execute(
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
    // Only when the request **writes** a slug. A patch that renames a page or
    // edits its meta description is not choosing an address, and refusing it
    // would make every page whose slug predates the deployment's reserved set
    // uneditable — a rule that punishes the operator for a decision somebody
    // else made later.
    if (input.slug !== undefined) await this.assertSlugNotReserved(input.slug);
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
        await tx.execute(
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
        languages: {
          ...(row.content.languages ?? {}),
          [language]: data,
        },
      };
      if (!row.languages.includes(language)) {
        throw new HttpError(
          400,
          ERROR_CODES.CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE,
          `CMS Page language "${language}" is not assigned to this page.`,
        );
      }

      await tx.execute(
        `update cms_pages
         set content = ?::jsonb, version = version + 1, updated_at = now()
         where id = ?`,
        [JSON.stringify(content), id],
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
    await this.emFactory().execute('delete from cms_pages where id = ?', [id]);
  }

  private async transition(
    id: string,
    status: 'draft' | 'published' | 'archived',
  ): Promise<CmsPageDetail> {
    const em = this.emFactory();
    const row = await this.findRow(id, em);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');

    await em.execute(
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
    const rows = (await em.execute('select * from cms_pages where id = ?', [
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
    const rows = (await em.execute(
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

  private channelLanguageCodes(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        return [];
      }
    }
    return [];
  }

  private resolvedChannelLanguageCodes(languages: unknown, defaultLanguage: unknown): string[] {
    const codes = this.channelLanguageCodes(languages);
    if (codes.length > 0) return codes;
    if (typeof defaultLanguage === 'string' && defaultLanguage.length > 0) {
      return [defaultLanguage];
    }
    return [];
  }

  private async assertLanguagesInChannelScope(
    em: EntityManager,
    languages: string[],
    salesChannelIds: string[],
  ): Promise<void> {
    if (languages.length === 0 || salesChannelIds.length === 0) return;

    /**
     * The kernel's own entity, not `select languages, default_language from
     * sales_channels` (feature 075, D-87). `sales_channels` is the kernel's
     * table since feature 072 moved the resolution machinery there, and a
     * module relating into the kernel by ORM is the sanctioned access. The read
     * stays on the caller's `em` so it still sees the transaction the write is
     * being validated inside.
     */
    const channels = await em.find(SalesChannel, { id: { $in: salesChannelIds } });
    const allowed = new Set(
      channels.flatMap((channel) =>
        this.resolvedChannelLanguageCodes(channel.languages, channel.defaultLanguage),
      ),
    );
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
    await em.execute('delete from cms_page_sales_channels where page_id = ?', [
      pageId,
    ]);
    for (const salesChannelId of salesChannelIds) {
      await em.execute(
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
    const rows = (await em.execute(
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
    const rows = (await em.execute(
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
