import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  firstSlugSegment,
  type CmsPageDetail,
  type CmsPageSummary,
  type CmsPageTranslations,
  type CreateCmsPageRequest,
  type PatchCmsPageRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditState, CommandBus } from '@endora-commerce/platform/commands';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { walkBlockEmbeds, walkUnknownComponents } from './content-tree-walker.js';
import { assertAnchors } from './anchor-guard.js';
import type { CmsContentInvalidator } from './cms-content-invalidator.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';
import { addressesOf, anyNested, duplicatePath, loadChannelPageNodes } from './page-paths.js';

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
  parent_page_id: string | null;
  breadcrumbs_visible: boolean;
  breadcrumbs_scheme: 'light' | 'muted' | 'dark';
  share_image_asset_id: string | null;
  /** R19D — absent on a row read before the migration ran. */
  parent_path_in_url?: boolean | null;
  /** R21H (T355): the trail over the first section. */
  breadcrumbs_overlay?: boolean | null;
  /** R24: name, slug and description per language; absent before the migration ran. */
  translations?: CmsPageTranslations | null;
};

const emptyContent = { languages: {} };

/**
 * The deepest page tree a parent write may produce, counted in levels with the
 * root as level one (feature 163, research R-18). The storefront trail of a
 * level-eight page therefore names at most seven ancestors, and the resolver's
 * own walk stays bounded by the same number.
 */
export const CMS_PAGE_TREE_MAX_DEPTH = 8;

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

/**
 * The per-language overrides as they are stored (R24): a blank field is an
 * inherited one, so it is not written, and a language left with no field is
 * not written either. One spelling of "inherits" — absent — keeps the stored
 * map comparable across saves and its audit entries free of noise.
 */
export function normalizeTranslations(translations: CmsPageTranslations): CmsPageTranslations {
  const out: CmsPageTranslations = {};
  for (const [language, entry] of Object.entries(translations)) {
    const kept: CmsPageTranslations[string] = {};
    if (entry.name !== undefined && entry.name.trim().length > 0) kept.name = entry.name.trim();
    if (entry.slug !== undefined && entry.slug.trim().length > 0) kept.slug = entry.slug.trim();
    if (entry.description !== undefined && entry.description.trim().length > 0) kept.description = entry.description;
    if (Object.keys(kept).length > 0) out[language] = kept;
  }
  return out;
}

/**
 * The audit `objectType` of every Page write. One value, so the trail of one
 * page is one query whichever of the seven actions wrote the row.
 */
const PAGE_OBJECT_TYPE = 'cms_page';

const TRANSITION_ACTIONS = {
  published: 'cms_page.publish',
  archived: 'cms_page.archive',
  draft: 'cms_page.unarchive',
} as const;

/**
 * Every write below runs as a Command (Constitution XIII): `CommandBus.run`
 * opens the transaction, derives the actor from the ambient TenantContext and
 * records exactly one audit entry beside the write, so a rolled-back write
 * leaves no entry and a committed one cannot skip it. The statements are raw
 * SQL and stay so — what changed is the EntityManager they run on, which is the
 * Command's and no longer one this service opened for itself.
 *
 * What stays **outside** the Command is what is not part of the write: the
 * reserved-segment refusal (a settings read), the storefront cache invalidation
 * (Redis, and only meaningful once the row is committed) and the response read.
 */
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
    /**
     * Required, with no un-audited fallback: an optional bus is a write path
     * whose absent form audits nothing, which is the defect this parameter
     * exists to remove.
     */
    private readonly commandBus: CommandBus,
    private readonly knownComponentNames: () => Iterable<string>,
    private readonly invalidator?: CmsContentInvalidator,
    private readonly references?: CmsReferenceRegistry,
  ) {}

  setReservedSegmentsResolver(resolver: ReservedSlugSegmentsResolver | null): void {
    this.reservedSegmentsResolver = resolver;
  }

  /**
   * Feature 167 (FR-040, FR-041) — every sales channel's storefront language
   * prefixes and split aliases, each with the codes of the channels using it. Read
   * through the kernel's channel port (`sales_channels` is non-deactivatable); absent
   * until `registerModule` installs it, which reserves nothing.
   */
  private languagePrefixesResolver: (() => Promise<ReadonlyMap<string, readonly string[]>>) | null = null;

  setLanguagePrefixesResolver(resolver: (() => Promise<ReadonlyMap<string, readonly string[]>>) | null): void {
    this.languagePrefixesResolver = resolver;
  }

  /**
   * Feature 171 (research R5) — first segments other modules serve in the given
   * channels (the blog's prefixes), each with the module that claims it. Absent
   * until `registerModule` installs it, which claims nothing.
   */
  private claimedSegmentsResolver:
    | ((salesChannelIds: readonly string[]) => Promise<ReadonlyMap<string, string>>)
    | null = null;

  setClaimedSegmentsResolver(
    resolver: ((salesChannelIds: readonly string[]) => Promise<ReadonlyMap<string, string>>) | null,
  ): void {
    this.claimedSegmentsResolver = resolver;
  }

  /** The channels' language prefixes → channel codes (feature 167). */
  async languagePrefixes(): Promise<ReadonlyMap<string, readonly string[]>> {
    return this.languagePrefixesResolver ? this.languagePrefixesResolver() : new Map();
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
  private async assertSlugNotReserved(slug: string, salesChannelIds: readonly string[]): Promise<void> {
    const segment = firstSlugSegment(slug);
    if (segment.length === 0) return;
    // Feature 171 — a segment another module serves in one of the page's channels
    // (the blog's prefix) is that module's address there, never the page's.
    const claimedBy = this.claimedSegmentsResolver
      ? (await this.claimedSegmentsResolver(salesChannelIds)).get(segment)
      : undefined;
    if (claimedBy !== undefined) {
      throw new HttpError(
        409,
        ERROR_CODES.CMS_SLUG_RESERVED,
        `The first path segment "${segment}" is served by the ${claimedBy} module in this sales channel.`,
        { segment, claimedBy },
      );
    }
    const reserved = await this.reservedSegments();
    // Feature 167 (FR-040, OR-5, OR-12) — a language prefix of any channel is the
    // storefront's too: the URL `/<prefix>/…` is that language's page, never the
    // CMS page. A prefix of a language no channel serves is an ordinary segment.
    const languagePrefix = (await this.languagePrefixes()).has(segment.toLowerCase());
    if (!reserved.includes(segment) && !languagePrefix) return;
    throw new HttpError(
      409,
      ERROR_CODES.CMS_SLUG_RESERVED,
      `The first path segment "${segment}" is reserved by this storefront.`,
      { segment },
    );
  }

  /**
   * R24: an override is written only for a language the page declares. A
   * stored one whose language was removed stays, and stops counting
   * (`cmsLocalizedPage`); a *request* naming such a language is a mistake the
   * operator should hear about.
   */
  private assertTranslationsInLanguages(translations: CmsPageTranslations, languages: readonly string[]): void {
    const undeclared = Object.keys(translations).find((language) => !languages.includes(language));
    if (undeclared) {
      throw new HttpError(
        400,
        ERROR_CODES.CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE,
        `CMS Page language "${undeclared}" is not assigned to this page.`,
      );
    }
  }

  /** The page's slug and every language slug the request writes (R24) — what the reserved-segment refusal reads. */
  private requestedSlugs(slug: string | undefined, translations: CmsPageTranslations | undefined): string[] {
    const slugs = slug !== undefined ? [slug] : [];
    for (const entry of Object.values(translations ?? {})) if (entry.slug) slugs.push(entry.slug);
    return slugs;
  }

  private async invalidateForPageId(
    pageId: string,
    options: { withDescendants?: boolean } = {},
  ): Promise<void> {
    if (!this.invalidator) return;
    const em = this.emFactory();
    const slugs = await this.slugsOf(pageId, em);
    const ids = new Set([pageId]);
    if (options.withDescendants) {
      slugs.push(...(await this.descendantSlugs(pageId, em)));
      for (const descendant of await this.descendantIds(pageId, em)) ids.add(descendant);
    }
    // R19D: the computed paths too — a nested page is cached under its path.
    const { addresses } = await this.addressSnapshot(em, ids);
    await this.invalidateForSlugs([...slugs, ...addresses]);
  }

  /** Every slug a page is served under — its own and each channel's. */
  private async slugsOf(pageId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.execute(
      `select slug from cms_page_sales_channels where page_id = ?
       union
       select slug from cms_pages where id = ?`,
      [pageId, pageId],
    )) as Array<{ slug: string }>;
    return rows.map((r) => r.slug);
  }

  /**
   * What an audit entry keeps of a Page: the facts an operator sets, and not
   * the content tree. A page's tree is routinely hundreds of kilobytes and is
   * saved many times in one editing session, so carrying it on both sides of
   * every entry would make the audit table the largest copy of the CMS. A
   * content save records which language changed and the version it produced.
   */
  private async auditState(em: EntityManager, row: PageRow): Promise<NonNullable<AuditState>> {
    return {
      name: row.name,
      slug: row.slug,
      status: row.status,
      active: row.active,
      description: row.description,
      languages: row.languages,
      translations: row.translations ?? {},
      salesChannelIds: await this.channelIdsFor(row.id, em),
      meta: this.combineMeta(row),
      parentPageId: row.parent_page_id,
      breadcrumbsVisible: row.breadcrumbs_visible,
      breadcrumbsScheme: row.breadcrumbs_scheme,
      breadcrumbsOverlay: row.breadcrumbs_overlay === true,
      shareImageAssetId: row.share_image_asset_id,
      parentPathInUrl: row.parent_path_in_url === true,
      version: row.version,
    };
  }

  /**
   * Feature 163 (FR-030, FR-032; data-model §6): refuse a parent that would make
   * the page its own ancestor, or a tree deeper than `CMS_PAGE_TREE_MAX_DEPTH`.
   *
   * Runs inside the `cms_page.update` Command, so a refusal rolls back before
   * anything is written and the bus records no entry. The transaction-scoped
   * advisory lock serialises parent writes: two concurrent patches (A under B,
   * B under A) would otherwise each pass against the other's pre-image.
   *
   * Depth counts both directions: the levels above the new parent, plus the
   * height of the subtree this page brings with it.
   */
  private async assertParentAllowed(
    em: EntityManager,
    pageId: string,
    parentPageId: string,
  ): Promise<void> {
    const refuse = (message: string): never => {
      throw new HttpError(422, ERROR_CODES.CMS_PAGE_PARENT_CYCLE, message);
    };
    if (parentPageId === pageId) refuse('A CMS Page cannot be its own parent.');

    await em.execute("select pg_advisory_xact_lock(hashtext('cms_pages.parent_page_id'))");

    const parent = await this.findRow(parentPageId, em);
    if (!parent) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'Parent CMS Page not found.');

    // The parent and its ancestors, bounded one level past the limit so a
    // chain that is already too deep (or a stored loop) still terminates.
    const chain = (await em.execute(
      `with recursive chain(id, parent_page_id, depth) as (
         select id, parent_page_id, 1 from cms_pages where id = ?
         union all
         select p.id, p.parent_page_id, c.depth + 1
         from cms_pages p join chain c on p.id = c.parent_page_id
         where c.depth <= ?
       )
       select id::text as id from chain`,
      [parentPageId, CMS_PAGE_TREE_MAX_DEPTH],
    )) as Array<{ id: string }>;
    if (chain.some((row) => row.id === pageId)) {
      refuse('This parent would make the CMS Page its own ancestor.');
    }

    const below = (await em.execute(
      `with recursive subtree(id, depth) as (
         select id, 1 from cms_pages where id = ?
         union all
         select p.id, s.depth + 1
         from cms_pages p join subtree s on p.parent_page_id = s.id
         where s.depth <= ?
       )
       select max(depth)::int as height from subtree`,
      [pageId, CMS_PAGE_TREE_MAX_DEPTH],
    )) as Array<{ height: number | null }>;
    const height = below[0]?.height ?? 1;
    if (chain.length + height > CMS_PAGE_TREE_MAX_DEPTH) {
      refuse(`A CMS Page tree may be at most ${CMS_PAGE_TREE_MAX_DEPTH} levels deep.`);
    }
  }

  /**
   * The slugs of every page below this one. A page's name, status
   * and channel scope appear in its descendants' breadcrumb trails, so a write
   * to it must drop their cached answers as well as its own.
   */
  private async descendantSlugs(pageId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.execute(
      `with recursive subtree(id, depth) as (
         select id, 0 from cms_pages where parent_page_id = ?
         union all
         select p.id, s.depth + 1
         from cms_pages p join subtree s on p.parent_page_id = s.id
         where s.depth < ?
       )
       select cpsc.slug from cms_page_sales_channels cpsc
       where cpsc.page_id in (select id from subtree)
       union
       select p.slug from cms_pages p where p.id in (select id from subtree)`,
      [pageId, CMS_PAGE_TREE_MAX_DEPTH],
    )) as Array<{ slug: string }>;
    return rows.map((row) => row.slug);
  }

  private async invalidateForSlugs(slugs: Iterable<string>, options: { addressesMoved?: boolean } = {}): Promise<void> {
    await this.invalidator?.pagesChanged(slugs, options);
  }

  /** The ids of every page below this one, bounded like every tree walk here. */
  private async descendantIds(pageId: string, em: EntityManager): Promise<string[]> {
    const rows = (await em.execute(
      `with recursive subtree(id, depth) as (
         select id, 0 from cms_pages where parent_page_id = ?
         union all
         select p.id, s.depth + 1
         from cms_pages p join subtree s on p.parent_page_id = s.id
         where s.depth < ?
       )
       select distinct id::text as id from subtree`,
      [pageId, CMS_PAGE_TREE_MAX_DEPTH],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id).filter((id) => id !== pageId);
  }

  /** The channels any of the given pages is served in. */
  private async channelsOfPages(em: EntityManager, pageIds: ReadonlySet<string>): Promise<string[]> {
    if (pageIds.size === 0) return [];
    const placeholders = [...pageIds].map(() => '?').join(', ');
    const rows = (await em.execute(
      `select distinct sales_channel_id::text as id from cms_page_sales_channels where page_id in (${placeholders})`,
      [...pageIds],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  /**
   * The public addresses of a page and its descendants in every channel they
   * are served in (R19D, T282) — each channel slug and each computed path — and
   * whether any of them is nested. Read before and after a write, so the
   * invalidation names the addresses a page had as well as the ones it has.
   */
  private async addressSnapshot(
    em: EntityManager,
    pageIds: ReadonlySet<string>,
  ): Promise<{ addresses: Set<string>; nested: boolean }> {
    if (pageIds.size === 0) return { addresses: new Set(), nested: false };
    const nodes = await loadChannelPageNodes(em, await this.channelsOfPages(em, pageIds));
    return { addresses: addressesOf(nodes, pageIds), nested: anyNested(nodes, pageIds) };
  }

  /**
   * R19D (T282): refuse a write after which two pages of one channel share a
   * public path, where one of them is the page written or one of its
   * descendants. Runs inside the Command after the write, so a refusal rolls
   * the write back and the bus records no entry; the advisory lock serialises
   * the writes that can move a path, as the parent lock does for the tree.
   */
  private async assertPathsUnique(em: EntityManager, pageIds: ReadonlySet<string>): Promise<void> {
    await em.execute("select pg_advisory_xact_lock(hashtext('cms_pages.public_path'))");
    const nodes = await loadChannelPageNodes(em, await this.channelsOfPages(em, pageIds));
    const duplicate = duplicatePath(nodes, pageIds);
    if (duplicate) {
      throw new HttpError(
        409,
        ERROR_CODES.CMS_SLUG_CONFLICT,
        `Another CMS Page is already served at "/${duplicate.path}".`,
        // R24: the language whose address is taken, when it is a language's.
        { path: duplicate.path, ...(duplicate.language ? { language: duplicate.language } : {}) },
      );
    }
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
      // R24: a page is found by its name or slug in any language too.
      where.push('(lower(p.name) like ? or lower(p.slug) like ? or lower(p.translations::text) like ?)');
      params.push(`%${filters.q.toLowerCase()}%`);
      params.push(`%${filters.q.toLowerCase()}%`);
    }

    const rows = (await em.execute(
      `select p.* from cms_pages p
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by p.updated_at desc
       limit 50`,
      params,
    )) as PageRow[];

    const summaries = await Promise.all(rows.map((row) => this.toSummary(row)));
    // Feature 167 (FR-041) — mark a page shadowed by a channel language prefix.
    const prefixes = await this.languagePrefixes();
    const data = summaries.map((page) => {
      // The page's own slug and every per-language slug (R24): any of them may be the
      // one a language prefix hides.
      const slugs = [page.slug, ...Object.values(page.translations ?? {}).map((t) => t.slug ?? '')];
      for (const slug of slugs) {
        const segment = firstSlugSegment(slug).toLowerCase();
        const channelCodes = segment === '' ? undefined : prefixes.get(segment);
        if (channelCodes) return { ...page, shadowedByLanguagePrefix: { prefix: segment, channelCodes: [...channelCodes] } };
      }
      return page;
    });
    return { data, nextCursor: null };
  }

  async create(input: CreateCmsPageRequest): Promise<CmsPageDetail> {
    // Before the transaction, deliberately: this is a judgement on the input
    // against the deployment's configuration and touches no row, so opening a
    // transaction to refuse it would hold a connection for the length of a
    // settings read.
    for (const slug of this.requestedSlugs(input.slug, input.translations)) {
      await this.assertSlugNotReserved(slug, input.salesChannelIds);
    }
    const translations = normalizeTranslations(input.translations ?? {});
    this.assertTranslationsInLanguages(translations, input.languages);
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
    const createdAddresses = new Set<string>([input.slug]);

    await this.commandBus.run<void>({
      action: 'cms_page.create',
      objectType: PAGE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        await this.assertLanguagesInChannelScope(tx, input.languages, input.salesChannelIds);
        await this.assertSlugAvailable(tx, input.slug, input.salesChannelIds);
        if (input.parentPageId) await this.assertParentAllowed(tx, id, input.parentPageId);
        await tx.execute(
          `insert into cms_pages
            (id, path, status, title, body, published_at, archived_at, created_at, updated_at,
             name, slug, active, description, meta_title, meta_description, meta_keywords,
             content, languages, version,
             parent_page_id, breadcrumbs_visible, breadcrumbs_scheme, share_image_asset_id,
             parent_path_in_url, breadcrumbs_overlay, translations)
           values (?, ?, 'draft', ?::jsonb, ?::jsonb, null, null, ?, ?,
             ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, 1,
             ?, ?, ?, ?, ?, ?, ?::jsonb)`,
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
            input.parentPageId ?? null,
            input.breadcrumbsVisible ?? true,
            input.breadcrumbsScheme ?? 'light',
            input.shareImageAssetId ?? null,
            input.parentPathInUrl ?? false,
            input.breadcrumbsOverlay ?? false,
            JSON.stringify(translations),
          ],
        );
        await this.replaceChannelScope(tx, id, input.salesChannelIds, input.slug);
        await this.assertPathsUnique(tx, new Set([id]));
        for (const address of (await this.addressSnapshot(tx, new Set([id]))).addresses) {
          createdAddresses.add(address);
        }
        const created = await this.findRow(id, tx);
        return {
          result: undefined,
          before: null,
          after: created ? await this.auditState(tx, created) : null,
        };
      },
    });

    await this.invalidateForSlugs(createdAddresses);
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
    const requested = this.requestedSlugs(input.slug, input.translations);
    if (requested.length > 0) {
      const channelIds = input.salesChannelIds ?? (await this.channelIdsFor(id));
      for (const slug of requested) await this.assertSlugNotReserved(slug, channelIds);
    }
    const translations = input.translations !== undefined ? normalizeTranslations(input.translations) : undefined;
    const slugsToInvalidate = new Set<string>();
    let addressesMoved = false;
    await this.commandBus.run<void>({
      action: 'cms_page.update',
      objectType: PAGE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        const row = await this.findRow(id, tx);
        if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
        this.assertVersion(row, input.version);
        slugsToInvalidate.add(row.slug);
        const before = await this.auditState(tx, row);

        const nextSlug = input.slug ?? row.slug;
        const nextChannels = input.salesChannelIds ?? (await this.channelIdsFor(id, tx));
        const nextLanguages = input.languages ?? row.languages;
        await this.assertLanguagesInChannelScope(tx, nextLanguages, nextChannels);
        if (translations) this.assertTranslationsInLanguages(translations, nextLanguages);
        if (input.slug || input.salesChannelIds) {
          await this.assertSlugAvailable(tx, nextSlug, nextChannels, id);
        }

        if (input.parentPageId && input.parentPageId !== row.parent_page_id) {
          await this.assertParentAllowed(tx, id, input.parentPageId);
        }

        // R19D: a write that can move a public path — its own and its nested
        // descendants' — is checked for a duplicate after it is made, and both
        // sets of addresses are invalidated.
        // R24: a language slug moves an address, and so does a language
        // added or removed, since an override counts only while its language
        // is declared.
        const movesPaths =
          input.slug !== undefined ||
          input.salesChannelIds !== undefined ||
          input.parentPageId !== undefined ||
          input.parentPathInUrl !== undefined ||
          input.languages !== undefined ||
          translations !== undefined;
        // Every write snapshots the subtree's addresses (R24): a name — the
        // page's or a language's — is in the descendants' trails, and they are
        // cached under their language addresses as well as their slugs.
        const subtree = new Set([id, ...(await this.descendantIds(id, tx))]);
        const pathsBefore = await this.addressSnapshot(tx, subtree);

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
        if (input.parentPageId !== undefined) set('parent_page_id = ?', input.parentPageId);
        if (input.breadcrumbsVisible !== undefined) set('breadcrumbs_visible = ?', input.breadcrumbsVisible);
        if (input.breadcrumbsScheme !== undefined) set('breadcrumbs_scheme = ?', input.breadcrumbsScheme);
        if (input.breadcrumbsOverlay !== undefined) set('breadcrumbs_overlay = ?', input.breadcrumbsOverlay);
        if (input.shareImageAssetId !== undefined) set('share_image_asset_id = ?', input.shareImageAssetId);
        if (input.parentPathInUrl !== undefined) set('parent_path_in_url = ?', input.parentPathInUrl);
        if (translations !== undefined) set('translations = ?::jsonb', JSON.stringify(translations));
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
        const rescoped = Boolean(input.salesChannelIds || input.slug);
        if (rescoped) {
          await this.replaceChannelScope(tx, id, nextChannels, nextSlug);
        }
        slugsToInvalidate.add(nextSlug);
        for (const slug of await this.descendantSlugs(id, tx)) slugsToInvalidate.add(slug);
        if (movesPaths) await this.assertPathsUnique(tx, subtree);
        const pathsAfter = await this.addressSnapshot(tx, subtree);
        for (const address of [...pathsBefore.addresses, ...pathsAfter.addresses]) slugsToInvalidate.add(address);
        if (movesPaths) addressesMoved = pathsBefore.nested || pathsAfter.nested;

        // A patch that named no field wrote no row, so it leaves no entry: "no
        // write, no audit row" is the bus's own rule and `skipAudit` its spelling.
        if (sets.length === 0 && !rescoped) return { result: undefined, skipAudit: true };
        const updated = await this.findRow(id, tx);
        return {
          result: undefined,
          before,
          after: updated ? await this.auditState(tx, updated) : null,
        };
      },
    });

    await this.invalidateForSlugs(slugsToInvalidate, { addressesMoved });
    return this.get(id);
  }

  async setContent(id: string, language: string, data: unknown, version: number): Promise<CmsPageDetail> {
    await this.commandBus.run<void>({
      action: 'cms_page.set_content',
      objectType: PAGE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        const row = await this.findRow(id, tx);
        if (!row) throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
        this.assertVersion(row, version);
        // One anchor names one place in this language's tree (feature 163, R-8).
        assertAnchors({ [language]: data });

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
        return {
          result: undefined,
          before: { language, version: row.version },
          after: { language, version: row.version + 1 },
        };
      },
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
    // Read inside the Command, before the row goes: the channel rows that carry
    // the slugs cascade with it. Invalidated after the commit, so a storefront
    // read racing the delete cannot re-cache a page that is about to be gone.
    let slugs: string[] = [];
    let movedOnDelete = false;
    await this.commandBus.run<void>({
      action: 'cms_page.delete',
      objectType: PAGE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em }) => {
        const row = await this.findRow(id, em);
        // Deleting a page that is not there has always answered success, and
        // still does — it removed nothing, so it records nothing.
        if (!row) return { result: undefined, skipAudit: true };
        const before = await this.auditState(em, row);
        // The children lose this page as their parent (`on delete set null`),
        // so their trails change with it.
        slugs = [...(await this.slugsOf(id, em)), ...(await this.descendantSlugs(id, em))];
        // R19D: and the paths, which move for every nested descendant.
        const snapshot = await this.addressSnapshot(em, new Set([id, ...(await this.descendantIds(id, em))]));
        slugs.push(...snapshot.addresses);
        movedOnDelete = snapshot.nested;
        await em.execute('delete from cms_pages where id = ?', [id]);
        return { result: undefined, before, after: null };
      },
    });
    await this.invalidateForSlugs(slugs, { addressesMoved: movedOnDelete });
  }

  private async transition(
    id: string,
    status: 'draft' | 'published' | 'archived',
  ): Promise<CmsPageDetail> {
    await this.commandBus.run<void>({
      action: TRANSITION_ACTIONS[status],
      objectType: PAGE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em }) => {
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
        return {
          result: undefined,
          before: { status: row.status, version: row.version },
          after: { status, version: row.version + 1 },
        };
      },
    });
    await this.invalidateForPageId(id, { withDescendants: true });
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
      parentPageId: row.parent_page_id,
      parentPathInUrl: row.parent_path_in_url === true,
      translations: row.translations ?? {},
    };
  }

  private async toDetail(row: PageRow): Promise<CmsPageDetail> {
    return {
      ...(await this.toSummary(row)),
      meta: this.combineMeta(row),
      content: {
        languages: row.content.languages ?? {},
      },
      breadcrumbsVisible: row.breadcrumbs_visible,
      breadcrumbsScheme: row.breadcrumbs_scheme,
      breadcrumbsOverlay: row.breadcrumbs_overlay === true,
      shareImageAssetId: row.share_image_asset_id,
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
