import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CmsTemplateDetail,
  type CmsTemplateSummary,
  type CreateCmsTemplateRequest,
  type PatchCmsTemplateRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditState, CommandBus } from '@endora-commerce/platform/commands';
import { walkUnknownComponents } from './content-tree-walker.js';
import type { CmsReferenceRegistry } from './cms-reference-registry.js';
import type { CmsContentInvalidator } from './cms-content-invalidator.js';

type TemplateRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  content: { languages?: Record<string, unknown> };
  languages: string[];
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const emptyContent = { languages: {} };

/**
 * The audit `objectType` of every Template write. One value, so the trail of
 * one template is one query whichever of the four actions wrote the row.
 */
const TEMPLATE_OBJECT_TYPE = 'cms_template';

/**
 * Every write below runs as a Command (Constitution XIII), the way
 * `CmsPageService`'s do: `CommandBus.run` opens the transaction, derives the
 * actor from the ambient TenantContext and records exactly one audit entry
 * beside the write, so a rolled-back write leaves no entry and a committed one
 * cannot skip it. The statements are raw SQL and stay so — what changed is the
 * EntityManager they run on, which is the Command's and no longer one this
 * service opened for itself.
 *
 * What stays **outside** the Command is what is not part of the write: the
 * reference refusal on delete (a read through `CmsReferenceRegistry`, which
 * holds its own manager), the content invalidation (Redis and the published
 * change, only meaningful once the row is committed) and the response read.
 */
export class CmsTemplateService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Required, with no un-audited fallback: an optional bus is a write path
     * whose absent form audits nothing, which is the defect this parameter
     * exists to remove.
     */
    private readonly commandBus: CommandBus,
    private readonly knownComponentNames: () => Iterable<string>,
    private readonly references: CmsReferenceRegistry,
    private readonly invalidator?: CmsContentInvalidator,
  ) {}

  /**
   * Templates are referenced from Pages and Blocks, both of which we
   * cache. We don't track inverse maps yet so a coarse drop of all pages
   * and all blocks is the safe choice; the next request rebuilds them.
   */
  private async invalidateAll(): Promise<void> {
    await this.invalidator?.templateChanged();
  }

  /**
   * What an audit entry keeps of a Template: the facts an operator sets, and
   * not the content tree — the same choice, for the same reason, as a Page's
   * entry. A content save records which language changed and the version it
   * produced.
   */
  private async auditState(em: EntityManager, row: TemplateRow): Promise<NonNullable<AuditState>> {
    return {
      name: row.name,
      code: row.code,
      description: row.description,
      languages: row.languages,
      salesChannelIds: await this.channelIdsFor(row.id, em),
      version: row.version,
    };
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

    const rows = (await this.emFactory().execute(
      `select t.* from cms_templates t
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by t.updated_at desc
       limit 50`,
      params,
    )) as TemplateRow[];
    return { data: await Promise.all(rows.map((row) => this.toSummary(row))), nextCursor: null };
  }

  async create(input: CreateCmsTemplateRequest): Promise<CmsTemplateDetail> {
    const id = randomUUID();
    const now = new Date();
    await this.commandBus.run<void>({
      action: 'cms_template.create',
      objectType: TEMPLATE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        await this.assertCodeAvailable(tx, input.code, input.salesChannelIds);
        await tx.execute(
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
        const created = await this.findRow(id, tx);
        return {
          result: undefined,
          before: null,
          after: created ? await this.auditState(tx, created) : null,
        };
      },
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
    await this.commandBus.run<void>({
      action: 'cms_template.update',
      objectType: TEMPLATE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        const row = await this.findRow(id, tx);
        if (!row) throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
        this.assertVersion(row, input.version);
        const before = await this.auditState(tx, row);

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
          await tx.execute(
            `update cms_templates
             set ${sets.join(', ')}, version = version + 1, updated_at = now()
             where id = ?`,
            params,
          );
        }
        const rescoped = Boolean(input.salesChannelIds || input.code);
        if (rescoped) {
          await this.replaceChannelScope(tx, id, nextChannels, nextCode);
        }

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
    await this.invalidateAll();
    return this.get(id);
  }

  async setContent(id: string, language: string, data: unknown, version: number): Promise<CmsTemplateDetail> {
    await this.commandBus.run<void>({
      action: 'cms_template.set_content',
      objectType: TEMPLATE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
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
          languages: { ...(row.content.languages ?? {}), [language]: data },
        };
        const languages = row.languages.includes(language) ? row.languages : [...row.languages, language];
        await tx.execute(
          `update cms_templates
           set content = ?::jsonb, languages = ?::jsonb, version = version + 1, updated_at = now()
           where id = ?`,
          [JSON.stringify(content), JSON.stringify(languages), id],
        );
        return {
          result: undefined,
          before: { language, version: row.version },
          after: { language, version: row.version + 1 },
        };
      },
    });
    await this.invalidateAll();
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
    const refs = await this.references.findTemplateReferences(row.id, row.code);
    if (refs.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_REFERENCED, 'CMS Template is referenced.');
    }
    await this.commandBus.run<void>({
      action: 'cms_template.delete',
      objectType: TEMPLATE_OBJECT_TYPE,
      objectId: id,
      run: async ({ em }) => {
        // Read again on the Command's manager: the entry keeps what the row was
        // at the moment it went, and a template deleted since the check above
        // answers what it always answered.
        const current = await this.findRow(id, em);
        if (!current) {
          throw new HttpError(404, ERROR_CODES.CMS_TEMPLATE_NOT_FOUND, 'CMS Template not found.');
        }
        const before = await this.auditState(em, current);
        await em.execute('delete from cms_templates where id = ?', [id]);
        return { result: undefined, before, after: null };
      },
    });
    await this.invalidateAll();
  }

  private async findRow(id: string, em = this.emFactory()): Promise<TemplateRow | null> {
    const rows = (await em.execute('select * from cms_templates where id = ?', [
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
    const rows = (await em.execute(
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
    await em.execute('delete from cms_template_sales_channels where template_id = ?', [
      templateId,
    ]);
    for (const salesChannelId of salesChannelIds) {
      await em.execute(
        `insert into cms_template_sales_channels (template_id, sales_channel_id, code)
         values (?, ?, ?)`,
        [templateId, salesChannelId, code],
      );
    }
  }

  private async channelIdsFor(templateId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.execute(
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
        languages: row.content.languages ?? {},
      },
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
