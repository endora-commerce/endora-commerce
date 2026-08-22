import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CmsHookDetail,
  type CmsHookSummary,
  type CreateCmsHookRequest,
  type PatchCmsHookRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CmsCache } from './cms-cache.js';

type HookRow = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  description: string | null;
  is_system: boolean;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  attachment_count?: string | number;
};

type HookAttachmentRow = {
  block_id: string;
  block_code: string;
  position: number;
};

export class CmsHookService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache?: CmsCache,
  ) {}

  private async invalidateForHookId(hookId: string): Promise<void> {
    if (!this.cache) return;
    const rows = (await this.emFactory().execute(
      'select code from cms_hooks where id = ?',
      [hookId],
    )) as Array<{ code: string }>;
    const codes = rows.map((r) => r.code).filter((c) => c && c.length > 0);
    if (codes.length > 0) await this.cache.invalidateHooksByCode(codes);
  }

  async list(filters: { salesChannelId?: string } = {}): Promise<{
    data: CmsHookSummary[];
    nextCursor: null;
  }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (filters.salesChannelId) {
      params.push(filters.salesChannelId);
      where.push(
        `exists (
          select 1 from cms_hook_sales_channels chsc
          where chsc.hook_id = h.id and chsc.sales_channel_id = ?
        )`,
      );
    }

    const rows = (await this.emFactory().execute(
      `select h.*,
              (select count(*) from cms_hook_block_attachments a where a.hook_id = h.id) as attachment_count
       from cms_hooks h
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by h.code asc
       limit 200`,
      params,
    )) as HookRow[];
    return { data: await Promise.all(rows.map((row) => this.toSummary(row))), nextCursor: null };
  }

  async create(input: CreateCmsHookRequest): Promise<CmsHookDetail> {
    const em = this.emFactory();
    const id = randomUUID();
    const now = new Date();
    await em.transactional(async (tx) => {
      await this.assertCodeAvailable(tx, input.code);
      await tx.execute(
        `insert into cms_hooks
          (id, name, code, active, description, is_system, version, created_at, updated_at)
         values (?, ?, ?, ?, ?, false, 1, ?, ?)`,
        [id, input.name, input.code, input.active ?? true, input.description ?? null, now, now],
      );
      await this.replaceChannelScope(tx, id, input.salesChannelIds);
    });
    if (this.cache) await this.cache.invalidateHooksByCode([input.code]);
    return this.get(id);
  }

  async get(id: string): Promise<CmsHookDetail> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
    return this.toDetail(row);
  }

  async patch(id: string, input: PatchCmsHookRequest): Promise<CmsHookDetail> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      const row = await this.findRow(id, tx);
      if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
      this.assertVersion(row, input.version);

      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (sql: string, value: unknown) => {
        sets.push(sql);
        params.push(value);
      };
      if (input.name !== undefined) set('name = ?', input.name);
      if (input.active !== undefined) set('active = ?', input.active);
      if (input.description !== undefined) set('description = ?', input.description);

      if (sets.length > 0) {
        params.push(id);
        await tx.execute(
          `update cms_hooks
           set ${sets.join(', ')}, version = version + 1, updated_at = now()
           where id = ?`,
          params,
        );
      }
      if (input.salesChannelIds) {
        await this.replaceChannelScope(tx, id, input.salesChannelIds);
        await tx.execute(
          `update cms_hooks set version = version + 1, updated_at = now() where id = ?`,
          [id],
        );
      }
    });
    await this.invalidateForHookId(id);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
    if (row.is_system) {
      throw new HttpError(
        409,
        ERROR_CODES.CMS_HOOK_SYSTEM_PROTECTED,
        'System CMS Hooks cannot be deleted.',
      );
    }
    await this.emFactory().execute('delete from cms_hooks where id = ?', [id]);
    if (this.cache) await this.cache.invalidateHooksByCode([row.code]);
  }

  async listAttachments(hookId: string): Promise<CmsHookDetail['attachments']> {
    await this.assertExists(hookId);
    return this.attachmentsFor(hookId);
  }

  async addAttachment(
    hookId: string,
    blockId: string,
    position: number,
  ): Promise<CmsHookDetail['attachments']> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      await this.assertExists(hookId, tx);
      await this.assertBlockExists(blockId, tx);
      await tx.execute(
        `insert into cms_hook_block_attachments (hook_id, block_id, position, created_at)
         values (?, ?, ?, now())`,
        [hookId, blockId, position],
      );
    });
    await this.invalidateForHookId(hookId);
    return this.attachmentsFor(hookId);
  }

  async reorderAttachment(
    hookId: string,
    blockId: string,
    position: number,
  ): Promise<CmsHookDetail['attachments']> {
    const em = this.emFactory();
    await em.transactional(async (tx) => {
      await this.assertExists(hookId, tx);
      const result = (await tx.execute(
        `update cms_hook_block_attachments
         set position = ?
         where hook_id = ? and block_id = ?`,
        [position, hookId, blockId],
      )) as { rowCount?: number };
      if (result.rowCount === 0) {
        throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Hook attachment not found.');
      }
    });
    await this.invalidateForHookId(hookId);
    return this.attachmentsFor(hookId);
  }

  async removeAttachment(hookId: string, blockId: string): Promise<void> {
    await this.assertExists(hookId);
    await this.emFactory().execute(
      'delete from cms_hook_block_attachments where hook_id = ? and block_id = ?',
      [hookId, blockId],
    );
    await this.invalidateForHookId(hookId);
  }

  private async findRow(id: string, em = this.emFactory()): Promise<HookRow | null> {
    const rows = (await em.execute(
      `select h.*,
              (select count(*) from cms_hook_block_attachments a where a.hook_id = h.id) as attachment_count
       from cms_hooks h
       where h.id = ?
       limit 1`,
      [id],
    )) as HookRow[];
    return rows[0] ?? null;
  }

  private async assertExists(hookId: string, em = this.emFactory()): Promise<void> {
    const row = await this.findRow(hookId, em);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
  }

  private async assertBlockExists(blockId: string, em: EntityManager): Promise<void> {
    const rows = (await em.execute(
      'select id from cms_blocks where id = ? limit 1',
      [blockId],
    )) as Array<{ id: string }>;
    if (rows.length === 0) {
      throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
    }
  }

  private async assertCodeAvailable(em: EntityManager, code: string): Promise<void> {
    const rows = (await em.execute(
      'select id from cms_hooks where code = ? limit 1',
      [code],
    )) as Array<{ id: string }>;
    if (rows.length > 0) {
      throw new HttpError(409, ERROR_CODES.CMS_CODE_CONFLICT, 'CMS Hook code already exists.');
    }
  }

  private async replaceChannelScope(
    em: EntityManager,
    hookId: string,
    salesChannelIds: string[],
  ): Promise<void> {
    await em.execute('delete from cms_hook_sales_channels where hook_id = ?', [
      hookId,
    ]);
    for (const salesChannelId of salesChannelIds) {
      await em.execute(
        `insert into cms_hook_sales_channels (hook_id, sales_channel_id)
         values (?, ?)`,
        [hookId, salesChannelId],
      );
    }
  }

  private async channelIdsFor(hookId: string, em = this.emFactory()): Promise<string[]> {
    const rows = (await em.execute(
      'select sales_channel_id::text as id from cms_hook_sales_channels where hook_id = ?',
      [hookId],
    )) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private async attachmentsFor(hookId: string): Promise<CmsHookDetail['attachments']> {
    const rows = (await this.emFactory().execute(
      `select a.block_id::text, b.code as block_code, a.position
       from cms_hook_block_attachments a
       join cms_blocks b on b.id = a.block_id
       where a.hook_id = ?
       order by a.position asc, a.block_id asc`,
      [hookId],
    )) as HookAttachmentRow[];
    return rows.map((row) => ({
      blockId: row.block_id,
      blockCode: row.block_code,
      position: row.position,
    }));
  }

  private assertVersion(row: HookRow, version: number | undefined): void {
    if (version !== undefined && version !== row.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'CMS Hook was updated concurrently.');
    }
  }

  private async toSummary(row: HookRow): Promise<CmsHookSummary> {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      active: row.active,
      description: row.description,
      isSystem: row.is_system,
      salesChannelIds: await this.channelIdsFor(row.id),
      attachmentCount: Number(row.attachment_count ?? 0),
      version: row.version,
      createdAt: this.iso(row.created_at),
      updatedAt: this.iso(row.updated_at),
    };
  }

  private async toDetail(row: HookRow): Promise<CmsHookDetail> {
    return {
      ...(await this.toSummary(row)),
      attachments: await this.attachmentsFor(row.id),
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
