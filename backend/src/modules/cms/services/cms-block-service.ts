import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CmsBlockDetail,
  type CmsBlockSummary,
  type CreateCmsBlockRequest,
  type PatchCmsBlockRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { walkUnknownComponents } from './content-tree-walker.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';
import type { CmsCache } from './cms-cache.js';

type BlockRow = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  description: string | null;
  content: { languages?: Record<string, unknown> };
  languages: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const emptyContent = { languages: {} };

export class CmsBlockService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly knownComponentNames: () => Iterable<string>,
    private readonly references: CmsReferenceRegistry,
    private readonly cache?: CmsCache,
  ) {}

  /**
   * Invalidates the block's own cache entries plus the page-level
   * namespace, since we don't track which pages embed which block. The
   * page invalidation is coarse but safe: at platform scale (low
   * hundreds of pages) the next request rebuilds the cache trivially.
   */
  private async invalidateForBlockCode(code: string): Promise<void> {
    if (!this.cache) return;
    await this.cache.invalidateBlocksByCode([code]);
    await this.cache.invalidateAllPages();
  }

  async list(filters: { salesChannelId?: string } = {}): Promise<{
    data: CmsBlockSummary[];
    nextCursor: null;
  }> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.salesChannelId) {
      params.push(filters.salesChannelId);
      where.push(
        `exists (
          select 1 from cms_block_sales_channels cbsc
          where cbsc.block_id = b.id and cbsc.sales_channel_id = ?
        )`,
      );
    }

    const rows = (await this.emFactory().execute(
      `select b.* from cms_blocks b
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by b.updated_at desc
       limit 50`,
      params,
    )) as BlockRow[];
    return { data: await Promise.all(rows.map((row) => this.toSummary(row))), nextCursor: null };
  }

  async create(input: CreateCmsBlockRequest): Promise<CmsBlockDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();
    await em.transactional(async (tx) => {
      await this.assertCodeAvailable(tx, input.code, input.salesChannelIds);
      await tx.execute(
        `insert into cms_blocks
          (id, name, code, active, description, content, languages, version, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, 1, ?, ?)`,
        [
          id,
          input.name,
          input.code,
          input.active ?? true,
          input.description ?? null,
          JSON.stringify(emptyContent),
          JSON.stringify(input.languages),
          now,
          now,
        ],
      );
      await this.replaceChannelScope(tx, id, input.salesChannelIds, input.code);
    });
    await this.invalidateForBlockCode(input.code);
    return this.get(id);
  }

  async get(id: string): Promise<CmsBlockDetail> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
    return this.toDetail(row);
  }

  async patch(id: string, input: PatchCmsBlockRequest): Promise<CmsBlockDetail> {
    const em = this.emFactory();
    const codesToInvalidate = new Set<string>();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
      this.assertVersion(row, input.version);
      codesToInvalidate.add(row.code);

      const nextCode = input.code ?? row.code;
      const nextChannels = input.salesChannelIds ?? (await this.channelIdsFor(id, tx));
      if (input.code || input.salesChannelIds) {
        await this.assertCodeAvailable(tx, nextCode, nextChannels, id);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (sql: string, value: unknown) => {
        sets.push(sql);
        params.push(value);
      };
      if (input.name !== undefined) set('name = ?', input.name);
      if (input.code !== undefined) set('code = ?', input.code);
      if (input.active !== undefined) set('active = ?', input.active);
      if (input.description !== undefined) set('description = ?', input.description);
      if (input.languages !== undefined) set('languages = ?::jsonb', JSON.stringify(input.languages));

      if (sets.length > 0) {
        params.push(id);
        await tx.execute(
          `update cms_blocks
           set ${sets.join(', ')}, version = version + 1, updated_at = now()
           where id = ?`,
          params,
        );
      }
      if (input.salesChannelIds || input.code) {
        await this.replaceChannelScope(tx, id, nextChannels, nextCode);
      }
      codesToInvalidate.add(nextCode);
    });
    for (const code of codesToInvalidate) await this.invalidateForBlockCode(code);
    return this.get(id);
  }

  async setContent(id: string, language: string, data: unknown, version: number): Promise<CmsBlockDetail> {
    const em = this.emFactory();
    let invalidatedCode: string | null = null;
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
      this.assertVersion(row, version);
      invalidatedCode = row.code;

      const unknown = walkUnknownComponents(data, new Set(this.knownComponentNames()));
      if (unknown.size > 0) {
        console.warn(
          `CMS block ${id} saved with unknown components: ${Array.from(unknown).join(', ')}`,
        );
      }
      const content = {
        languages: { ...(row.content.languages ?? {}), [language]: data },
      };
      const languages = row.languages.includes(language) ? row.languages : [...row.languages, language];
      await tx.execute(
        `update cms_blocks
         set content = ?::jsonb, languages = ?::jsonb, version = version + 1, updated_at = now()
         where id = ?`,
        [JSON.stringify(content), JSON.stringify(languages), id],
      );
    });
    if (invalidatedCode) await this.invalidateForBlockCode(invalidatedCode);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
    const refs = await this.references.findBlockReferences(row.id, row.code);
    if (refs.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_REFERENCED, 'CMS Block is referenced.');
    }
    await this.emFactory().execute('delete from cms_blocks where id = ?', [id]);
    await this.invalidateForBlockCode(row.code);
  }

  private async findRow(id: string, em = this.emFactory()): Promise<BlockRow | null> {
    const rows = (await em.execute('select * from cms_blocks where id = ?', [
      id,
    ])) as BlockRow[];
    return rows[0] ?? null;
  }

  private async assertCodeAvailable(
    em: EntityManager,
    code: string,
    salesChannelIds: string[],
    exceptBlockId?: string,
  ): Promise<void> {
    if (salesChannelIds.length === 0) return;
    const placeholders = salesChannelIds.map(() => '?').join(', ');
    const rows = (await em.execute(
      `select block_id from cms_block_sales_channels
       where code = ? and sales_channel_id in (${placeholders})
       ${exceptBlockId ? 'and block_id <> ?' : ''}
       limit 1`,
      exceptBlockId ? [code, ...salesChannelIds, exceptBlockId] : [code, ...salesChannelIds],
    )) as Array<{ block_id: string }>;
    if (rows.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_CODE_CONFLICT, 'CMS Block code already exists.');
    }
  }

  private async replaceChannelScope(
    em: EntityManager,
    blockId: string,
    salesChannelIds: string[],
    code: string,
  ): Promise<void> {
    await em.execute('delete from cms_block_sales_channels where block_id = ?', [
      blockId,
    ]);
    for (const salesChannelId of salesChannelIds) {
      await em.execute(
        `insert into cms_block_sales_channels (block_id, sales_channel_id, code)
         values (?, ?, ?)`,
        [blockId, salesChannelId, code],
      );
    }
  }

  private async channelIdsFor(blockId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.execute(
      'select sales_channel_id::text as id from cms_block_sales_channels where block_id = ?',
      [blockId],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private assertVersion(row: BlockRow, version: number | undefined): void {
    if (version !== undefined && version !== row.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'CMS Block was updated concurrently.');
    }
  }

  private async toSummary(row: BlockRow): Promise<CmsBlockSummary> {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      active: row.active,
      description: row.description,
      salesChannelIds: await this.channelIdsFor(row.id),
      languages: row.languages,
      version: row.version,
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private async toDetail(row: BlockRow): Promise<CmsBlockDetail> {
    return {
      ...(await this.toSummary(row)),
      content: {
        languages: row.content.languages ?? {},
      },
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
