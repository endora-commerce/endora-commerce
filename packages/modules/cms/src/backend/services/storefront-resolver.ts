import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CmsAssetEmbedResolution,
  CmsPageIndexEntry,
  CmsResolvedBlock,
  CmsResolvedHook,
  CmsResolvedPage,
  CmsResolvedTemplate,
} from '@endora-commerce/contracts';
import { walkAssetIds, walkBlockEmbeds, walkTemplateEmbeds } from './content-tree-walker.js';
import type { CmsCache } from './cms-cache.js';

export type CmsAssetResolver = (assetId: string) => Promise<CmsAssetEmbedResolution | null>;

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
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  content: { languages?: Record<string, unknown> };
  languages: string[];
};

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
};

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

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: CmsCache,
  ) {}

  setAssetResolver(resolver: CmsAssetResolver | null): void {
    this.assetResolver = resolver;
  }

  private async resolveAssetsForTrees(trees: unknown[]): Promise<Record<string, CmsAssetEmbedResolution>> {
    const resolver = this.assetResolver;
    if (!resolver) return {};

    const ids = new Set<string>();
    for (const tree of trees) walkAssetIds(tree, ids);
    if (ids.size === 0) return {};

    const assets: Record<string, CmsAssetEmbedResolution> = {};
    await Promise.all(
      Array.from(ids).map(async (assetId) => {
        const resolved = await resolver(assetId);
        if (resolved) assets[assetId] = resolved;
      }),
    );
    return assets;
  }

  async resolvePageBySlug(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    slug: string;
  }): Promise<CmsResolvedPage | null> {
    const em = this.emFactory();
    const channel = toChannelRow(input.resolvedChannel);

    const cacheLanguage = input.language ?? channel.default_language;
    if (this.cache) {
      const cached = await this.cache.getPage(input.slug, channel.code, cacheLanguage);
      if (cached) return cached;
    }

    const rows = (await em.execute(
      `select p.*
       from cms_pages p
       join cms_page_sales_channels cpsc on cpsc.page_id = p.id
       where cpsc.sales_channel_id = ?
         and cpsc.slug = ?
         and p.status = 'published'
         and p.active = true
       limit 1`,
      [channel.id, input.slug],
    )) as PageRow[];
    const page = rows[0];
    if (!page) return null;

    const language = this.resolveLanguage(page, input.language, channel.default_language);
    if (!language) return null;

    const data = page.content.languages?.[language] ?? {};
    const embeds = await this.inlineEmbeds(em, channel, language, data);
    const embedTrees = [
      data,
      ...Object.values(embeds.blocks).map((b) => b.content.data),
      ...Object.values(embeds.templates).map((t) => t.content.data),
    ];
    const assets = await this.resolveAssetsForTrees(embedTrees);

    const resolved: CmsResolvedPage = {
      id: page.id,
      slug: page.slug,
      name: page.name,
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
    };
    if (this.cache) {
      await this.cache.setPage(input.slug, channel.code, cacheLanguage, resolved);
    }
    return resolved;
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
    const rows = (await em.execute(
      `select cpsc.slug as slug, p.updated_at as updated_at
       from cms_pages p
       join cms_page_sales_channels cpsc on cpsc.page_id = p.id
       where cpsc.sales_channel_id = ?
         and p.status = 'published'
         and p.active = true
       order by cpsc.slug asc
       limit ${PAGE_INDEX_LIMIT}`,
      [input.resolvedChannel.id],
    )) as Array<{ slug: string; updated_at: Date | string }>;

    return rows.map((row) => ({
      slug: row.slug,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async resolveBlockByCode(input: {
    resolvedChannel: ResolvedChannel;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedBlock | null> {
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

    const resolved: CmsResolvedBlock = {
      id: block.id,
      code: block.code,
      language,
      content: {
        data: block.content.languages?.[language] ?? {},
      },
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

    const resolved: CmsResolvedHook = { hookCode: hook.code, blocks };
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
