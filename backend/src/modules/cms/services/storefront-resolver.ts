import type { EntityManager } from '@mikro-orm/postgresql';
import type { CmsResolvedBlock, CmsResolvedHook, CmsResolvedPage } from '@b2b/contracts';

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

type HookRow = {
  id: string;
  code: string;
  active: boolean;
};

export class StorefrontResolver {
  constructor(private readonly emFactory: () => EntityManager) {}

  async resolvePageBySlug(input: {
    salesChannelCode?: string | undefined;
    language?: string | undefined;
    slug: string;
  }): Promise<CmsResolvedPage | null> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, input.salesChannelCode);
    if (!channel) return null;

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

    return {
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
        data: page.content.languages?.[language] ?? {},
      },
      embeds: { blocks: {}, templates: {} },
      assets: {},
    };
  }

  async resolveBlockByCode(input: {
    salesChannelCode?: string | undefined;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedBlock | null> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, input.salesChannelCode);
    if (!channel) return null;

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

    return {
      id: block.id,
      code: block.code,
      language,
      content: {
        schemaVersion: block.content.schema_version ?? 1,
        data: block.content.languages?.[language] ?? {},
      },
    };
  }

  async resolveHookByCode(input: {
    salesChannelCode?: string | undefined;
    language?: string | undefined;
    code: string;
  }): Promise<CmsResolvedHook | null> {
    const em = this.emFactory();
    const channel = await this.resolveChannel(em, input.salesChannelCode);
    if (!channel) return null;

    const hookRows = (await em.getConnection().execute(
      `select id::text, code, active
       from cms_hooks
       where code = ?
       limit 1`,
      [input.code],
    )) as HookRow[];
    const hook = hookRows[0];
    if (!hook) return null;
    if (!hook.active) return { hookCode: hook.code, blocks: [] };

    const scopedRows = (await em.getConnection().execute(
      `select 1
       from cms_hook_sales_channels
       where hook_id = ? and sales_channel_id = ?
       limit 1`,
      [hook.id, channel.id],
    )) as Array<{ '?column?': number }>;
    if (scopedRows.length === 0) return { hookCode: hook.code, blocks: [] };

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

    return { hookCode: hook.code, blocks };
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
