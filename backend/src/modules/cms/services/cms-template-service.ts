import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CmsTemplateDetail,
  type CmsTemplateSummary,
  type CreateCmsTemplateRequest,
  type PatchCmsTemplateRequest,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { walkUnknownComponents } from './content-tree-walker.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';
import type { CmsCache } from './cms-cache.js';

type TemplateRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  content: { schema_version?: number; languages?: Record<string, unknown> };
  languages: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const emptyContent = { schema_version: 1, languages: {} };

export class CmsTemplateService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly knownComponentNames: () => Iterable<string>,
    private readonly references: CmsReferenceRegistry,
    private readonly cache?: CmsCache,
  ) {}

  /**
   * Templates are referenced from Pages and Blocks, both of which we
   * cache. We don't track inverse maps yet so a coarse drop of all pages
   * and all blocks is the safe choice; the next request rebuilds them.
   */
  private async invalidateAll(): Promise<void> {
    if (!this.cache) return;
    await this.cache.invalidateAll();
  }

  async list(filters: { salesChannelId?: string } = {}): Promise<{
    data: CmsTemplateSummary[];
    nextCursor: null;
  }> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (filters.salesChannelId) {
      params.push(filters.salesChannelId);
      where.push(
        `exists (
          select 1 from cms_template_sales_channels ctsc
          where ctsc.template_id = t.id and ctsc.sales_channel_id = ?
        )`,
      );
    }

    const rows = (await this.emFactory().getConnection().execute(
      `select t.* from cms_templates t
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by t.updated_at desc
       limit 50`,
      params,
    )) as TemplateRow[];
    return { data: await Promise.all(rows.map((row) => this.toSummary(row))), nextCursor: null };
  }

  async create(input: CreateCmsTemplateRequest): Promise<CmsTemplateDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();
    await em.transactional(async (tx) => {
      await this.assertCodeAvailable(tx, input.code, input.salesChannelIds);
      await tx.getConnection().execute(
        `insert into cms_templates
          (id, name, code, description, content, languages, version, created_at, updated_at)
         values (?, ?, ?, ?, ?::jsonb, ?::jsonb, 1, ?, ?)`,
        [
          id,
          input.name,
          input.code,
          input.description ?? null,
          JSON.stringify(emptyContent),
          JSON.stringify(input.languages),
          now,
          now,
        ],
      );
      await this.replaceChannelScope(tx, id, input.salesChannelIds, input.code);
    });
    await this.invalidateAll();
    return this.get(id);
  }

  async get(id: string): Promise<CmsTemplateDetail> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
    return this.toDetail(row);
  }

  async patch(id: string, input: PatchCmsTemplateRequest): Promise<CmsTemplateDetail> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
      this.assertVersion(row, input.version);

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
      if (input.description !== undefined) set('description = ?', input.description);
      if (input.languages !== undefined) set('languages = ?::jsonb', JSON.stringify(input.languages));

      if (sets.length > 0) {
        params.push(id);
        await tx.getConnection().execute(
          `update cms_templates
           set ${sets.join(', ')}, version = version + 1, updated_at = now()
           where id = ?`,
          params,
        );
      }
      if (input.salesChannelIds || input.code) {
        await this.replaceChannelScope(tx, id, nextChannels, nextCode);
      }
    });
    await this.invalidateAll();
    return this.get(id);
  }

  async setContent(id: string, language: string, data: unknown, version: number): Promise<CmsTemplateDetail> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
      this.assertVersion(row, version);

      const unknown = walkUnknownComponents(data, new Set(this.knownComponentNames()));
      if (unknown.size > 0) {
        console.warn(
          `CMS template ${id} saved with unknown components: ${Array.from(unknown).join(', ')}`,
        );
      }
      const content = {
        schema_version: row.content.schema_version ?? 1,
        languages: { ...(row.content.languages ?? {}), [language]: data },
      };
      const languages = row.languages.includes(language) ? row.languages : [...row.languages, language];
      await tx.getConnection().execute(
        `update cms_templates
         set content = ?::jsonb, languages = ?::jsonb, version = version + 1, updated_at = now()
         where id = ?`,
        [JSON.stringify(content), JSON.stringify(languages), id],
      );
    });
    await this.invalidateAll();
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
    const refs = await this.references.findTemplateReferences(row.code);
    if (refs.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_REFERENCED, 'CMS Template is referenced.');
    }
    await this.emFactory().getConnection().execute('delete from cms_templates where id = ?', [id]);
    await this.invalidateAll();
  }

  private async findRow(id: string, em = this.emFactory()): Promise<TemplateRow | null> {
    const rows = (await em.getConnection().execute('select * from cms_templates where id = ?', [
      id,
    ])) as TemplateRow[];
    return rows[0] ?? null;
  }

  private async assertCodeAvailable(
    em: EntityManager,
    code: string,
    salesChannelIds: string[],
    exceptTemplateId?: string,
  ): Promise<void> {
    if (salesChannelIds.length === 0) return;
    const placeholders = salesChannelIds.map(() => '?').join(', ');
    const rows = (await em.getConnection().execute(
      `select template_id from cms_template_sales_channels
       where code = ? and sales_channel_id in (${placeholders})
       ${exceptTemplateId ? 'and template_id <> ?' : ''}
       limit 1`,
      exceptTemplateId ? [code, ...salesChannelIds, exceptTemplateId] : [code, ...salesChannelIds],
    )) as Array<{ template_id: string }>;
    if (rows.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_CODE_CONFLICT, 'CMS Template code already exists.');
    }
  }

  private async replaceChannelScope(
    em: EntityManager,
    templateId: string,
    salesChannelIds: string[],
    code: string,
  ): Promise<void> {
    await em.getConnection().execute('delete from cms_template_sales_channels where template_id = ?', [
      templateId,
    ]);
    for (const salesChannelId of salesChannelIds) {
      await em.getConnection().execute(
        `insert into cms_template_sales_channels (template_id, sales_channel_id, code)
         values (?, ?, ?)`,
        [templateId, salesChannelId, code],
      );
    }
  }

  private async channelIdsFor(templateId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.getConnection().execute(
      'select sales_channel_id::text as id from cms_template_sales_channels where template_id = ?',
      [templateId],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private assertVersion(row: TemplateRow, version: number | undefined): void {
    if (version !== undefined && version !== row.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'CMS Template was updated concurrently.');
    }
  }

  private async toSummary(row: TemplateRow): Promise<CmsTemplateSummary> {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      description: row.description,
      salesChannelIds: await this.channelIdsFor(row.id),
      languages: row.languages,
      version: row.version,
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private async toDetail(row: TemplateRow): Promise<CmsTemplateDetail> {
    return {
      ...(await this.toSummary(row)),
      content: {
        schema_version: row.content.schema_version ?? 1,
        languages: row.content.languages ?? {},
      },
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
