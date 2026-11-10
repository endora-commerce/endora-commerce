import type { EntityManager } from '@mikro-orm/postgresql';
import {
  cmsLocalizedPage,
  cmsPageUrl,
  type ChannelUrlFacts,
  type CmsAssetEmbedResolution,
  type CmsPageIndexEntry,
  type CmsPageTranslations,
  type CmsResolvedBlock,
  type CmsResolvedBlockByCode,
  type CmsResolvedHook,
  type CmsResolvedPage,
  type CmsResolvedTemplate,
} from '@endora-commerce/contracts';
import { rewritePageLinkSlugs, walkAssetIds, walkBlockEmbeds, walkTemplateEmbeds } from './content-tree-walker.js';
import {
  channelLanguages,
  channelPaths,
  languageSlug,
  loadChannelPageNodes,
  type ChannelPageNode,
} from './page-paths.js';
import { CmsCache } from './cms-cache.js';

/**
 * The embed details of these asset ids, in one call per tree rather than one per
 * asset (issue #685); an id that resolves to nothing is absent from the map.
 */
export type CmsAssetResolver = (assetIds: readonly string[]) => Promise<Map<string, CmsAssetEmbedResolution>>;

/**
 * The asset id `cms.default_share_image_asset_id` holds for one sales channel,
 * or `null` when it is empty (feature 163, FR-033). Late-bound, like the asset
 * resolver: the setting is read through the settings store per request.
 */
export type CmsDefaultShareImageResolver = (salesChannelId: string) => Promise<string | null>;

/** Recursion depth cap for InsertBlock/InsertTemplate inlining (per data-model.md / T082). */
const EMBED_DEPTH_CAP = 3;

/**
 * How many published pages one channel's index answers with.
 *
 * A bound rather than a page size: the caller is a sitemap, Google's own
 * ceiling is 50 000 URLs per file, and the storefront already caps its product
 * enumeration at 5 000 for the same reason. A shop with more CMS pages than
 * this has a sitemap-index problem rather than a listing problem, and adding a
 * cursor before one exists would be a paging protocol with no reader.
 */
const PAGE_INDEX_LIMIT = 5000;

type PageRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** R24; optional for a row read before the column existed. */
  translations?: CmsPageTranslations | null;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  content: { languages?: Record<string, unknown> };
  languages: string[];
  parent_page_id: string | null;
  breadcrumbs_visible: boolean;
  breadcrumbs_scheme: 'light' | 'muted' | 'dark';
  /** R21H (T355); optional for a row read before the column existed. */
  breadcrumbs_overlay?: boolean | null;
  share_image_asset_id: string | null;
};

type BreadcrumbTrail = CmsResolvedPage['breadcrumbs']['trail'];

/**
 * How far up the parent chain the trail walks — the write-side limit
 * (`CMS_PAGE_TREE_MAX_DEPTH`, research R-18), so a well-formed tree is always
 * walked whole and a stored loop still terminates.
 */
const TRAIL_MAX_DEPTH = 8;

type ChannelRow = {
  id: string;
  code: string;
  default_language: string;
};

/**
 * The request's resolved sales channel, handed in by the route from the
 * canonical resolver, read via `getResolvedChannel()` — feature 053 / FR-002. The
 * service no longer re-resolves the channel from the raw header.
 */
export type ResolvedChannel = {
  id: string;
  code: string;
  defaultLanguage: string;
  /**
   * Feature 167 — the channel's languages and *prefix the default language* setting,
   * for the language prefix on every CMS URL answered. Optional for callers that
   * predate them: the default language alone, prefixed (the column default).
   */
  languages?: readonly string[];
  prefixDefaultLanguage?: boolean;
};

/** The URL-language facts of a resolved channel (feature 167). */
function channelUrlFactsOf(channel: ResolvedChannel): ChannelUrlFacts {
  return {
    languages: channel.languages && channel.languages.length > 0 ? channel.languages : [channel.defaultLanguage],
    defaultLanguage: channel.defaultLanguage,
    prefixDefaultLanguage: channel.prefixDefaultLanguage ?? true,
  };
}

/** Whether the channel serves `language` — only those get a URL (feature 167, FR-005). */
function servesLanguage(facts: ChannelUrlFacts, language: string): boolean {
  return (
    facts.defaultLanguage === language || facts.languages.some((l) => l.toLowerCase() === language.toLowerCase())
  );
}

function toChannelRow(channel: ResolvedChannel): ChannelRow {
  return { id: channel.id, code: channel.code, default_language: channel.defaultLanguage };
}

type BlockRow = {
  id: string;
  code: string;
  content: { languages?: Record<string, unknown> };
  languages: string[];
};

type TemplateRow = {
  id: string;
  code: string;
  content: { languages?: Record<string, unknown> };
  languages: string[];
};

type HookRow = {
  id: string;
  code: string;
  active: boolean;
};

export class StorefrontResolver {
  private assetResolver: CmsAssetResolver | null = null;
  private defaultShareImageResolver: CmsDefaultShareImageResolver | null = null;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: CmsCache,
  ) {}

  setAssetResolver(resolver: CmsAssetResolver | null): void {
    this.assetResolver = resolver;
  }

  setDefaultShareImageResolver(resolver: CmsDefaultShareImageResolver | null): void {
    this.defaultShareImageResolver = resolver;
  }

  /**
   * One asset as a sharing image: its URL when it resolves and is public —
   * a crawler fetching `og:image` carries no session — else `null`.
   */
  private async shareImageUrl(assetId: string | null): Promise<string | null> {
    if (!assetId || !this.assetResolver) return null;
    const resolved = (await this.assetResolver([assetId])).get(assetId);
    return resolved && resolved.visibility === 'public' ? resolved.url : null;
  }

  /**
   * The deployment default applied to a page without a sharing image of its
   * own (feature 163, FR-033). Applied after the page cache rather than stored
   * in it: the page's own image is part of the page, invalidated with it, while
   * the default is a setting whose change no page write announces. The read is
   * for the request's channel (Constitution XII).
   */
  private async withDefaultShareImage(cached: CmsResolvedPage, channel: ChannelRow): Promise<CmsResolvedPage> {
    // An entry cached before feature 163 carries neither field.
    const partial = cached as Partial<Pick<CmsResolvedPage, 'share' | 'languages' | 'path'>>;
    const page: CmsResolvedPage = {
      ...cached,
      // An entry cached before R19D carries no path: it was served at its slug.
      path: partial.path ?? cached.slug,
      // Guarded: an entry cached before feature 163 carries no breadcrumbs.
      ...(cached.breadcrumbs
        ? {
            breadcrumbs: {
              ...cached.breadcrumbs,
              trail: cached.breadcrumbs.trail.map((crumb) => ({ ...crumb, path: crumb.path ?? crumb.slug })),
            },
          }
        : {}),
      share: partial.share ?? { imageUrl: null },
      languages: partial.languages ?? [cached.language],
    };
    if (page.share.imageUrl || !this.defaultShareImageResolver) return page;
    const assetId = await this.defaultShareImageResolver(channel.id);
    const imageUrl = await this.shareImageUrl(assetId);
    return imageUrl ? { ...page, share: { imageUrl } } : page;
  }

  private async resolveAssetsForTrees(trees: unknown[]): Promise<Record<string, CmsAssetEmbedResolution>> {
    const resolver = this.assetResolver;
    if (!resolver) return {};

    const ids = new Set<string>();
    for (const tree of trees) walkAssetIds(tree, ids);
    if (ids.size === 0) return {};

    return Object.fromEntries(await resolver([...ids]));
  }

  async resolvePageBySlug(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    slug: string;
  }): Promise<CmsResolvedPage | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);

    const cacheLanguage = input.language ?? channel.default_language;
    // Feature 167 — the answer carries URLs under the channel's language prefixes, so
    // the cache entry is keyed by the facts they are derived from too: a flipped
    // *prefix the default language* or a changed language list misses it.
    const urlFacts = channelUrlFactsOf(input.resolvedChannel);
    const cacheChannel = CmsCache.pageChannel(channel.code, urlFacts);
    if (this.cache) {
      const cached = await this.cache.getPage(input.slug, cacheChannel, cacheLanguage);
      if (cached) return this.withDefaultShareImage(cached, channel);
    }

    // R19D (T282): the address is a path computed from this channel's tree —
    // a page's own slug, or its parent's path and its slug when it opts in.
    // The whole path is matched first; a nested page's flat slug still
    // resolves after it, answering its canonical `path` for the storefront to
    // redirect to. With no nested page in the channel both are the slug match
    // this read has always been.
    const nodes = await loadChannelPageNodes(em, [channel.id]);
    const match = findPageByAddress(nodes, channel, input.slug, input.language);
    if (!match) return null;

    const rows = (await em.execute('select p.* from cms_pages p where p.id = ? limit 1', [match.id])) as PageRow[];
    const page = rows[0];
    if (!page) return null;

    const language = this.resolveLanguage(page, input.language, channel.default_language);
    if (!language) return null;

    // R24: the tree of the served language — its slugs, and so its paths. The
    // `path` answered is the page's address in it, which is how a reader who
    // switched language is sent to the page's slug in the new one.
    const paths = channelPaths(nodes, channel.id, language);
    const localized = cmsLocalizedPage(localizable(page), language);
    const path = paths.get(page.id) ?? localized.slug;

    // A link of kind `page` stores its target's flat slug; it is rewritten to
    // the path the target is served at here, so it needs no redirect (T283) —
    // in the served language (R24).
    const linkPaths = languageLinkPaths(nodes, paths, language);
    const data = rewritePageLinkSlugs(page.content.languages?.[language] ?? {}, linkPaths);
    const embeds = rewriteEmbedLinks(await this.inlineEmbeds(em, channel, language, data), linkPaths);
    const embedTrees = [
      data,
      ...Object.values(embeds.blocks).map((b) => b.content.data),
      ...Object.values(embeds.templates).map((t) => t.content.data),
    ];
    const assets = await this.resolveAssetsForTrees(embedTrees);
    const languages = this.servableLanguages(page, language);
    // Feature 167 — every URL under the language's path prefix; a language the
    // channel does not serve has no URL there, so it is not an alternate, and a page
    // served in one is addressed in the channel default language.
    const urlIn = (lang: string, langPath: string): string =>
      cmsPageUrl({
        path: langPath,
        languageCode: servesLanguage(urlFacts, lang) ? lang : urlFacts.defaultLanguage,
        channel: urlFacts,
      });

    const resolved: CmsResolvedPage = {
      id: page.id,
      slug: page.slug,
      path,
      url: urlIn(language, path),
      alternates: languages.filter((lang) => servesLanguage(urlFacts, lang)).map((lang) => ({
        language: lang,
        url: urlIn(
          lang,
          channelPaths(nodes, channel.id, lang).get(page.id) ?? cmsLocalizedPage(localizable(page), lang).slug,
        ),
      })),
      name: localized.name,
      language,
      meta: {
        title: page.meta_title?.[language] ?? null,
        description: page.meta_description?.[language] ?? null,
        keywords: page.meta_keywords?.[language] ?? null,
      },
      content: {
        data,
      },
      embeds,
      assets,
      breadcrumbs: {
        visible: page.breadcrumbs_visible,
        scheme: page.breadcrumbs_scheme,
        // R21H (T355): only when on, so a page with the band answers as before.
        ...(page.breadcrumbs_overlay === true ? { overlay: true } : {}),
        trail: await this.resolveTrail(em, channel, page, paths, language),
      },
      share: { imageUrl: await this.shareImageUrl(page.share_image_asset_id) },
      languages,
    };
    if (this.cache) {
      await this.cache.setPage(input.slug, cacheChannel, cacheLanguage, resolved);
    }
    return this.withDefaultShareImage(resolved, channel);
  }

  /**
   * The languages the page carries content for, among those it declares — the
   * ones a reader could be served (feature 163, FR-034) — with the served
   * language always among them.
   */
  private servableLanguages(page: Pick<PageRow, 'content' | 'languages'>, served: string): string[] {
    const available = page.content.languages ?? {};
    const languages = page.languages.filter((language) => available[language] !== undefined);
    return languages.includes(served) ? languages : [served, ...languages];
  }

  /**
   * The breadcrumb trail of one page for one channel (feature 163,
   * data-model §5; FR-030, FR-030a): its ancestors root-first, without Home
   * and without the page itself.
   *
   * An ancestor's link is the slug **this channel** serves it under, read off
   * `cms_page_sales_channels` (Constitution XII) — never the page row's own
   * `slug`, which is one value shared by every channel. An ancestor this
   * channel does not serve, published and active, keeps its place in the trail
   * as text (`slug: null`): the hierarchy is still true, there is just no page
   * here to link to.
   *
   * The name is the ancestor's page name, as the current page's own crumb is
   * (R19C, T270): one source for every crumb. Until R19C an ancestor was named
   * by its meta title, so a trail mixed browser titles and page names.
   */
  private async resolveTrail(
    em: EntityManager,
    channel: ChannelRow,
    page: Pick<PageRow, 'id' | 'parent_page_id'>,
    paths: ReadonlyMap<string, string>,
    language: string,
  ): Promise<BreadcrumbTrail> {
    if (!page.parent_page_id) return [];
    const rows = (await em.execute(
      `with recursive chain(id, parent_page_id, depth) as (
         select id, parent_page_id, 1 from cms_pages where id = ?
         union all
         select p.id, p.parent_page_id, c.depth + 1
         from cms_pages p join chain c on p.id = c.parent_page_id
         where c.depth < ?
       )
       select c.id::text as id, c.depth, p.name, p.languages, p.translations,
              case when p.status = 'published' and p.active = true then cpsc.slug end as slug
       from chain c
       join cms_pages p on p.id = c.id
       left join cms_page_sales_channels cpsc
         on cpsc.page_id = c.id and cpsc.sales_channel_id = ?
       order by c.depth desc`,
      [page.parent_page_id, TRAIL_MAX_DEPTH, channel.id],
    )) as Array<{
      id: string;
      depth: number;
      name: string;
      languages: string[] | null;
      translations?: CmsPageTranslations | null;
      slug: string | null;
    }>;
    // A stored loop through the page itself would otherwise repeat it.
    const seen = new Set<string>([page.id]);
    const trail: BreadcrumbTrail = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      // R24: the ancestor's name and slug in the served language.
      const localized = cmsLocalizedPage(
        { name: row.name, slug: row.slug ?? '', languages: row.languages ?? [], translations: row.translations ?? {} },
        language,
      );
      const slug = row.slug === null ? null : localized.slug;
      trail.push({
        name: localized.name,
        slug,
        // R19D (T282): the link is the ancestor's public path in this channel.
        path: slug === null ? null : (paths.get(row.id) ?? slug),
      });
    }
    return trail;
  }

  /**
   * Every published page of one sales channel, at the slug that channel serves
   * it under (feature 105, FR-021; `contracts/cms-page-url.md` §4.1).
   *
   * The join is `resolvePageBySlug`'s, minus the slug predicate: same table,
   * same three conditions — the channel binding, `status = 'published'` and
   * `active = true` — so a page this answer names is a page that endpoint
   * serves, and a page it omits is one that would 404. A sitemap built from a
   * looser query would advertise a URL the shop refuses, which is the state §4.1
   * exists to make unreachable.
   *
   * The slug comes off `cms_page_sales_channels`, never off `cms_pages`: the
   * address is per channel (Constitution XII), and the page row's own column is
   * one value shared by all of them.
   *
   * Uncached, deliberately. `CmsCache` keys a page by `(slug, channel, language)`
   * and is invalidated per slug on write, so an index cached beside it would
   * survive every invalidation the module performs and go stale on the first
   * publish. The read is one indexed join per sitemap build, which Next's own
   * route cache already sits in front of.
   */
  async listPublishedPages(input: {
    resolvedChannel: ResolvedChannel;
  }): Promise<CmsPageIndexEntry[]> {
    const em = this.emFactory();
    const channel = input.resolvedChannel;
    // R24: the languages each page can be served in — declared and carrying
    // content, as `servableLanguages` reads them — so every one gets its URL.
    const rows = (await em.execute(
      `select p.id::text as id, cpsc.slug as slug, p.updated_at as updated_at,
              coalesce(
                (select jsonb_agg(l.value) from jsonb_array_elements_text(p.languages) as l(value)
                 where jsonb_exists(coalesce(p.content -> 'languages', '{}'::jsonb), l.value)),
                '[]'::jsonb
              ) as servable_languages
       from cms_pages p
       join cms_page_sales_channels cpsc on cpsc.page_id = p.id
       where cpsc.sales_channel_id = ?
         and p.status = 'published'
         and p.active = true
       order by cpsc.slug asc
       limit ${PAGE_INDEX_LIMIT}`,
      [channel.id],
    )) as Array<{ id: string; slug: string; updated_at: Date | string; servable_languages: string[] | null }>;

    // R19D (T282): the address a crawler is given is the page's public path —
    // R24: in each language the page is served in, its default first.
    const nodes = await loadChannelPageNodes(em, [channel.id]);
    const pathsByLanguage = new Map<string | undefined, Map<string, string>>();
    const pathIn = (pageId: string, language: string | undefined): string | undefined => {
      let paths = pathsByLanguage.get(language);
      if (!paths) {
        paths = channelPaths(nodes, channel.id, language);
        pathsByLanguage.set(language, paths);
      }
      return paths.get(pageId);
    };
    const urlFacts = channelUrlFactsOf(channel);
    return rows.map((row) => {
      // Feature 167 — only the languages the channel serves have a URL here.
      const languages = (row.servable_languages ?? []).filter((language) => servesLanguage(urlFacts, language));
      const primary = languages.includes(channel.defaultLanguage) ? channel.defaultLanguage : languages[0];
      const urlIn = (language: string) =>
        cmsPageUrl({
          path: pathIn(row.id, language) ?? row.slug,
          languageCode: language,
          channel: urlFacts,
        });
      return {
        slug: row.slug,
        path: (primary !== undefined ? pathIn(row.id, primary) : pathIn(row.id, undefined)) ?? row.slug,
        ...(primary !== undefined
          ? {
              url: urlIn(primary),
              alternates: [primary, ...languages.filter((language) => language !== primary)].map((language) => ({
                language,
                url: urlIn(language),
              })),
            }
          : {}),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    });
  }

  async resolveBlockByCode(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedBlockByCode | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);

    const cacheLanguage = input.language ?? channel.default_language;
    if (this.cache) {
      const cached = await this.cache.getBlock(input.code, channel.code, cacheLanguage);
      if (cached) return cached;
    }

    const rows = (await em.execute(
      `select b.*
       from cms_blocks b
       join cms_block_sales_channels cbsc on cbsc.block_id = b.id
       where cbsc.sales_channel_id = ?
         and cbsc.code = ?
         and b.active = true
       limit 1`,
      [channel.id, input.code],
    )) as BlockRow[];
    const block = rows[0];
    if (!block) return null;

    const language = this.resolveLanguage(block, input.language, channel.default_language);
    if (!language) return null;

    const data = block.content.languages?.[language] ?? {};
    const resolved: CmsResolvedBlockByCode = {
      id: block.id,
      code: block.code,
      language,
      content: { data },
      assets: await this.resolveAssetsForTrees([data]),
    };
    if (this.cache) {
      await this.cache.setBlock(input.code, channel.code, cacheLanguage, resolved);
    }
    return resolved;
  }

  async resolveHookByCode(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedHook | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);

    const cacheLanguage = input.language ?? channel.default_language;
    if (this.cache) {
      const cached = await this.cache.getHook(input.code, channel.code, cacheLanguage);
      if (cached) return cached;
    }

    const hookRows = (await em.execute(
      `select id::text, code, active
       from cms_hooks
       where code = ?
       limit 1`,
      [input.code],
    )) as HookRow[];
    const hook = hookRows[0];
    if (!hook) return null;
    if (!hook.active) {
      const empty: CmsResolvedHook = { hookCode: hook.code, blocks: [] };
      if (this.cache) await this.cache.setHook(input.code, channel.code, cacheLanguage, empty);
      return empty;
    }

    const scopedRows = (await em.execute(
      `select 1
       from cms_hook_sales_channels
       where hook_id = ? and sales_channel_id = ?
       limit 1`,
      [hook.id, channel.id],
    )) as Array<{ '?column?': number }>;
    if (scopedRows.length === 0) {
      const empty: CmsResolvedHook = { hookCode: hook.code, blocks: [] };
      if (this.cache) await this.cache.setHook(input.code, channel.code, cacheLanguage, empty);
      return empty;
    }

    const blockRows = (await em.execute(
      `select b.*
       from cms_hook_block_attachments a
       join cms_blocks b on b.id = a.block_id
       join cms_block_sales_channels cbsc on cbsc.block_id = b.id
       where a.hook_id = ?
         and cbsc.sales_channel_id = ?
         and b.active = true
       order by a.position asc, a.block_id asc`,
      [hook.id, channel.id],
    )) as BlockRow[];

    const blocks: CmsResolvedBlock[] = [];
    for (const block of blockRows) {
      const language = this.resolveLanguage(block, input.language, channel.default_language);
      if (!language) continue;
      blocks.push({
        id: block.id,
        code: block.code,
        language,
        content: {
          data: block.content.languages?.[language] ?? {},
        },
      });
    }

    // One batch for every block's tree (issue #685), never a read per block or per image.
    const assets = await this.resolveAssetsForTrees(blocks.map((block) => block.content.data));
    const resolved: CmsResolvedHook = { hookCode: hook.code, blocks, assets };
    if (this.cache) {
      await this.cache.setHook(input.code, channel.code, cacheLanguage, resolved);
    }
    return resolved;
  }

  /**
   * Recursively inlines InsertBlock / InsertTemplate references found in the
   * supplied Page Builder data tree. Capped at EMBED_DEPTH_CAP levels —
   * cycles or deeper graphs degrade to placeholders rendered admin-side.
   */
  private async inlineEmbeds(
    em: EntityManager,
    channel: ChannelRow,
    language: string,
    rootData: unknown,
  ): Promise<{
    blocks: Record<string, CmsResolvedBlock>;
    templates: Record<string, CmsResolvedTemplate>;
  }> {
    const resolvedBlocks: Record<string, CmsResolvedBlock> = {};
    const resolvedTemplates: Record<string, CmsResolvedTemplate> = {};

    const visit = async (data: unknown, depth: number): Promise<void> => {
      if (depth > EMBED_DEPTH_CAP) return;

      const blockCodes = Array.from(walkBlockEmbeds(data)).filter(
        (code) => !(code in resolvedBlocks),
      );
      const templateCodes = Array.from(walkTemplateEmbeds(data)).filter(
        (code) => !(code in resolvedTemplates),
      );

      const blocks = blockCodes.length > 0
        ? await this.fetchBlocksByCodes(em, channel, blockCodes)
        : [];
      const templates = templateCodes.length > 0
        ? await this.fetchTemplatesByCodes(em, channel, templateCodes)
        : [];

      const nextLayer: unknown[] = [];

      for (const block of blocks) {
        const blockLanguage = this.resolveLanguage(block, language, channel.default_language);
        if (!blockLanguage) continue;
        const blockData = block.content.languages?.[blockLanguage] ?? {};
        resolvedBlocks[block.code] = {
          id: block.id,
          code: block.code,
          language: blockLanguage,
          content: {
            data: blockData,
          },
        };
        nextLayer.push(blockData);
      }

      for (const template of templates) {
        const templateLanguage = this.resolveLanguage(
          template,
          language,
          channel.default_language,
        );
        if (!templateLanguage) continue;
        const templateData = template.content.languages?.[templateLanguage] ?? {};
        resolvedTemplates[template.code] = {
          id: template.id,
          code: template.code,
          language: templateLanguage,
          content: {
            data: templateData,
          },
        };
        nextLayer.push(templateData);
      }

      for (const child of nextLayer) {
        await visit(child, depth + 1);
      }
    };

    await visit(rootData, 1);
    return { blocks: resolvedBlocks, templates: resolvedTemplates };
  }

  private async fetchBlocksByCodes(
    em: EntityManager,
    channel: ChannelRow,
    codes: string[],
  ): Promise<BlockRow[]> {
    if (codes.length === 0) return [];
    const placeholders = codes.map(() => '?').join(', ');
    return (await em.execute(
      `select b.*
       from cms_blocks b
       join cms_block_sales_channels cbsc on cbsc.block_id = b.id
       where cbsc.sales_channel_id = ?
         and cbsc.code in (${placeholders})
         and b.active = true`,
      [channel.id, ...codes],
    )) as BlockRow[];
  }

  private async fetchTemplatesByCodes(
    em: EntityManager,
    channel: ChannelRow,
    codes: string[],
  ): Promise<TemplateRow[]> {
    if (codes.length === 0) return [];
    const placeholders = codes.map(() => '?').join(', ');
    return (await em.execute(
      `select t.*
       from cms_templates t
       join cms_template_sales_channels ctsc on ctsc.template_id = t.id
       where ctsc.sales_channel_id = ?
         and ctsc.code in (${placeholders})`,
      [channel.id, ...codes],
    )) as TemplateRow[];
  }

  private resolveLanguage(
    page: Pick<PageRow, 'content' | 'languages'>,
    requested: string | undefined,
    channelDefault: string,
  ): string | null {
    const available = page.content.languages ?? {};
    const hasContent = (lang: string): boolean =>
      page.languages.includes(lang) && available[lang] !== undefined;
    if (requested && hasContent(requested)) {
      return requested;
    }
    if (hasContent(channelDefault)) {
      return channelDefault;
    }
    // Final fallback: render in whatever language actually carries content so a
    // published, channel-assigned page still resolves instead of 404-ing. This
    // covers pages authored only in a non-default language (e.g. en-US content
    // on a pl-PL-default channel) — without it, selecting such a page as the
    // storefront home page silently falls back to the built-in landing page.
    const firstDeclaredWithContent = page.languages.find(
      (lang) => available[lang] !== undefined,
    );
    if (firstDeclaredWithContent) {
      return firstDeclaredWithContent;
    }
    // Last resort for legacy data whose content keys are not mirrored in the
    // `languages` array: fall back to the first populated content language.
    return Object.keys(available)[0] ?? null;
  }
}

/** What `cmsLocalizedPage` reads of a stored page row. */
function localizable(page: Pick<PageRow, 'name' | 'slug' | 'description' | 'languages' | 'translations'>) {
  return {
    name: page.name,
    slug: page.slug,
    description: page.description,
    languages: page.languages,
    translations: page.translations ?? {},
  };
}

function flatSlug(slug: string): string {
  return slug.split('/').filter((segment) => segment.length > 0).join('/');
}

/**
 * The page an address names in one channel (R19D; R24), among the published
 * and active ones, or `null`.
 *
 * An address is unique within one channel and one language, so the requested
 * language's tree is asked first — its whole paths, then its flat slugs — then
 * the channel default's, then every other language the channel's pages
 * declare. A reader who switched language therefore still finds the page by
 * the slug of the language they left. The page's own slug, the identity a
 * stored link, the home-page setting and the mega menu name a page by, answers
 * last, so it still resolves when every language overrides it.
 */
function findPageByAddress(
  nodes: readonly ChannelPageNode[],
  channel: ChannelRow,
  address: string,
  requested: string | undefined,
): ChannelPageNode | null {
  const servable = nodes.filter((node) => node.status === 'published' && node.active);
  const languages = [
    ...new Set([requested, channel.default_language, ...channelLanguages(nodes, channel.id)].filter(
      (language): language is string => language !== undefined,
    )),
  ];
  for (const language of [...languages, undefined]) {
    const paths = channelPaths(nodes, channel.id, language);
    const slugOf = (node: ChannelPageNode) => (language === undefined ? node.slug : languageSlug(node, language));
    const match =
      servable.find((node) => paths.get(node.id) === address) ??
      servable.find((node) => slugOf(node) === address);
    if (match) return match;
  }
  return null;
}

/**
 * The slug → public path in one language of every page whose path is not that
 * slug — the links `rewritePageLinkSlugs` moves (T283). A link stores its
 * target's own slug; R24 keys the target's slug in the language too, so a
 * link typed with it is moved as well. Empty when no page of the channel is
 * nested or translated, which makes the rewrite a no-op returning the stored
 * tree.
 */
function languageLinkPaths(
  nodes: readonly ChannelPageNode[],
  paths: ReadonlyMap<string, string>,
  language: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const keyed = new Set<string>();
  // The own slugs first: a link names its target by it, so it wins a key a
  // language slug of another page happens to share.
  for (const slugOf of [(node: ChannelPageNode) => node.slug, (node: ChannelPageNode) => languageSlug(node, language)]) {
    for (const node of nodes) {
      const path = paths.get(node.id);
      const key = flatSlug(slugOf(node)).toLowerCase();
      if (path === undefined || keyed.has(key)) continue;
      keyed.add(key);
      if (path !== key) out.set(key, path);
    }
  }
  return out;
}

function rewriteEmbedLinks<T extends { blocks: Record<string, CmsResolvedBlock>; templates: Record<string, CmsResolvedTemplate> }>(
  embeds: T,
  linkPaths: ReadonlyMap<string, string>,
): T {
  if (linkPaths.size === 0) return embeds;
  const rewrite = <E extends { content: { data: unknown } }>(entry: E): E => {
    const data = rewritePageLinkSlugs(entry.content.data, linkPaths);
    return data === entry.content.data ? entry : { ...entry, content: { ...entry.content, data } };
  };
  return {
    ...embeds,
    blocks: Object.fromEntries(Object.entries(embeds.blocks).map(([code, block]) => [code, rewrite(block)])),
    templates: Object.fromEntries(Object.entries(embeds.templates).map(([code, template]) => [code, rewrite(template)])),
  };
}
