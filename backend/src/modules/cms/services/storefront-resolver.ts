import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CmsResolvedBlock,
  CmsResolvedHook,
  CmsResolvedPage,
  CmsResolvedTemplate,
} from '@b2b/contracts';
import { walkBlockEmbeds, walkTemplateEmbeds } from './content-tree-walker.js';
import type { CmsCache } from './cms-cache.js';

/** Recursion depth cap for InsertBlock/InsertTemplate inlining (per data-model.md / T082). */
const EMBED_DEPTH_CAP = 3;

type PageRow = {
  id: string;
  name: string;
  slug: string;
  meta_title: Record<string, string> | null;
  meta_description: Record<string, string> | null;
  meta_keywords: Record<string, string> | null;
  content: { schema_version?: number; languages?: Record<string, unknown> };
  languages: string[];
};

type ChannelRow = {
  id: string;
  code: string;
  default_language: string;
};

type BlockRow = {
  id: string;
  code: string;
  content: { schema_version?: number; languages?: Record<string, unknown> };
  languages: string[];
};

type TemplateRow = {
  id: string;
  code: string;
  content: { schema_version?: number; languages?: Record<string, unknown> };
  languages: string[];
};

type HookRow = {
  id: string;
  code: string;
  active: boolean;
};

export class StorefrontResolver {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: CmsCache,
  ) {}

  async resolvePageBySlug(input: {
    salesChannelCode?: string | undefined;
    language?: string | undefined;
    slug: string;
  }): Promise<CmsResolvedPage | null> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, input.salesChannelCode);
    if (!channel) return null;

    const cacheLanguage = input.language ?? channel.default_language;
    if (this.cache) {
      const cached = await this.cache.getPage(input.slug, channel.code, cacheLanguage);
      if (cached) return cached;
    }

    const rows = (await em.getConnection().execute(
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
        schemaVersion: page.content.schema_version ?? 1,
        data,
      },
      embeds,
      assets: {},
    };
    if (this.cache) {
      await this.cache.setPage(input.slug, channel.code, cacheLanguage, resolved);
    }
    return resolved;
  }

  async resolveBlockByCode(input: {
    salesChannelCode?: string | undefined;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedBlock | null> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, input.salesChannelCode);
    if (!channel) return null;

    const cacheLanguage = input.language ?? channel.default_language;
    if (this.cache) {
      const cached = await this.cache.getBlock(input.code, channel.code, cacheLanguage);
      if (cached) return cached;
    }

    const rows = (await em.getConnection().execute(
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
        schemaVersion: block.content.schema_version ?? 1,
        data: block.content.languages?.[language] ?? {},
      },
    };
    if (this.cache) {
      await this.cache.setBlock(input.code, channel.code, cacheLanguage, resolved);
    }
    return resolved;
  }

  async resolveHookByCode(input: {
    salesChannelCode?: string | undefined;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedHook | null> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, input.salesChannelCode);
    if (!channel) return null;

    const cacheLanguage = input.language ?? channel.default_language;
    if (this.cache) {
      const cached = await this.cache.getHook(input.code, channel.code, cacheLanguage);
      if (cached) return cached;
    }

    const hookRows = (await em.getConnection().execute(
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

    const scopedRows = (await em.getConnection().execute(
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

    const blockRows = (await em.getConnection().execute(
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
          schemaVersion: block.content.schema_version ?? 1,
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
            schemaVersion: block.content.schema_version ?? 1,
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
            schemaVersion: template.content.schema_version ?? 1,
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
    return (await em.getConnection().execute(
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
    return (await em.getConnection().execute(
      `select t.*
       from cms_templates t
       join cms_template_sales_channels ctsc on ctsc.template_id = t.id
       where ctsc.sales_channel_id = ?
         and ctsc.code in (${placeholders})`,
      [channel.id, ...codes],
    )) as TemplateRow[];
  }

  private async resolveChannel(
    em: EntityManager,
    code: string | undefined,
  ): Promise<ChannelRow | null> {
    const rows = (await em.getConnection().execute(
      code
        ? `select id::text, code, default_language from sales_channels where code = ? and active = true limit 1`
        : `select id::text, code, default_language from sales_channels where system_default = true limit 1`,
      code ? [code] : [],
    )) as ChannelRow[];
    return rows[0] ?? null;
  }

  private resolveLanguage(
    page: Pick<PageRow, 'content' | 'languages'>,
    requested: string | undefined,
    channelDefault: string,
  ): string | null {
    const available = page.content.languages ?? {};
    if (requested && page.languages.includes(requested) && available[requested] !== undefined) {
      return requested;
    }
    if (page.languages.includes(channelDefault) && available[channelDefault] !== undefined) {
      return channelDefault;
    }
    return null;
  }
}
