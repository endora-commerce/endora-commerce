import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CmsHookDetail,
  type CmsHookSummary,
  type CreateCmsHookRequest,
  type PatchCmsHookRequest,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditState, CommandBus } from '@endora-commerce/platform/commands';
import type { CmsContentInvalidator } from './cms-content-invalidator.js';

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

/**
 * The audit `objectType` of every Hook write, attachments included. An
 * attachment has no id of its own — it is a (hook, block) pair — so its entries
 * are the hook's, and the trail of one hook is one query whichever of the six
 * actions wrote the row.
 */
const HOOK_OBJECT_TYPE = 'cms_hook';

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
 * content invalidation (Redis and the published change, only meaningful once
 * the row is committed) and the response read.
 */
export class CmsHookService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Required, with no un-audited fallback: an optional bus is a write path
     * whose absent form audits nothing, which is the defect this parameter
     * exists to remove.
     */
    private readonly commandBus: CommandBus,
    private readonly invalidator?: CmsContentInvalidator,
  ) {}

  private async invalidateForHookId(hookId: string): Promise<void> {
    if (!this.invalidator) return;
    const rows = (await this.emFactory().execute(
      'select code from cms_hooks where id = ?',
      [hookId],
    )) as Array<{ code: string }>;
    const codes = rows.map((r) => r.code).filter((c) => c && c.length > 0);
    await this.invalidator.hooksChanged(codes);
  }

  /** What an audit entry keeps of a Hook: the facts an operator sets. */
  private async auditState(em: EntityManager, row: HookRow): Promise<NonNullable<AuditState>> {
    return {
      name: row.name,
      code: row.code,
      active: row.active,
      description: row.description,
      isSystem: row.is_system,
      salesChannelIds: await this.channelIdsFor(row.id, em),
      version: row.version,
    };
  }

  /** Where a block sits on a hook, or `null` when it is not attached. */
  private async attachmentPosition(
    em: EntityManager,
    hookId: string,
    blockId: string,
  ): Promise<number | null> {
    const rows = (await em.execute(
      'select position from cms_hook_block_attachments where hook_id = ? and block_id = ? limit 1',
      [hookId, blockId],
    )) as Array<{ position: number }>;
    return rows[0]?.position ?? null;
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
    const id = randomUUID();
    const now = new Date();
    await this.commandBus.run<void>({
      action: 'cms_hook.create',
      objectType: HOOK_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        await this.assertCodeAvailable(tx, input.code);
        await tx.execute(
          `insert into cms_hooks
            (id, name, code, active, description, is_system, version, created_at, updated_at)
           values (?, ?, ?, ?, ?, false, 1, ?, ?)`,
          [id, input.name, input.code, input.active ?? true, input.description ?? null, now, now],
        );
        await this.replaceChannelScope(tx, id, input.salesChannelIds);
        const created = await this.findRow(id, tx);
        return {
          result: undefined,
          before: null,
          after: created ? await this.auditState(tx, created) : null,
        };
      },
    });
    await this.invalidator?.hooksChanged([input.code]);
    return this.get(id);
  }

  async get(id: string): Promise<CmsHookDetail> {
    const row = await this.findRow(id);
    if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
    return this.toDetail(row);
  }

  async patch(id: string, input: PatchCmsHookRequest): Promise<CmsHookDetail> {
    await this.commandBus.run<void>({
      action: 'cms_hook.update',
      objectType: HOOK_OBJECT_TYPE,
      objectId: id,
      run: async ({ em: tx }) => {
        const row = await this.findRow(id, tx);
        if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
        this.assertVersion(row, input.version);
        const before = await this.auditState(tx, row);

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

        // A patch that named no field wrote no row, so it leaves no entry: "no
        // write, no audit row" is the bus's own rule and `skipAudit` its spelling.
        if (sets.length === 0 && !input.salesChannelIds) {
          return { result: undefined, skipAudit: true };
        }
        const updated = await this.findRow(id, tx);
        return {
          result: undefined,
          before,
          after: updated ? await this.auditState(tx, updated) : null,
        };
      },
    });
    await this.invalidateForHookId(id);
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    // The refusals run inside the Command, on the manager the delete runs on:
    // a refused delete rolls back with its entry, so it records nothing.
    const code = await this.commandBus.run<string>({
      action: 'cms_hook.delete',
      objectType: HOOK_OBJECT_TYPE,
      objectId: id,
      run: async ({ em }) => {
        const row = await this.findRow(id, em);
        if (!row) throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
        if (row.is_system) {
          throw new HttpError(
            409,
            ERROR_CODES.CMS_HOOK_SYSTEM_PROTECTED,
            'System CMS Hooks cannot be deleted.',
          );
        }
        const before = await this.auditState(em, row);
        await em.execute('delete from cms_hooks where id = ?', [id]);
        return { result: row.code, before, after: null };
      },
    });
    await this.invalidator?.hooksChanged([code]);
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
    await this.commandBus.run<void>({
      action: 'cms_hook.attach_block',
      objectType: HOOK_OBJECT_TYPE,
      objectId: hookId,
      run: async ({ em: tx }) => {
        await this.assertExists(hookId, tx);
        await this.assertBlockExists(blockId, tx);
        await tx.execute(
          `insert into cms_hook_block_attachments (hook_id, block_id, position, created_at)
           values (?, ?, ?, now())`,
          [hookId, blockId, position],
        );
        return { result: undefined, before: null, after: { blockId, position } };
      },
    });
    await this.invalidateForHookId(hookId);
    return this.attachmentsFor(hookId);
  }

  async reorderAttachment(
    hookId: string,
    blockId: string,
    position: number,
  ): Promise<CmsHookDetail['attachments']> {
    await this.commandBus.run<void>({
      action: 'cms_hook.reorder_block',
      objectType: HOOK_OBJECT_TYPE,
      objectId: hookId,
      run: async ({ em: tx }) => {
        await this.assertExists(hookId, tx);
        const previous = await this.attachmentPosition(tx, hookId, blockId);
        const result = (await tx.execute(
          `update cms_hook_block_attachments
           set position = ?
           where hook_id = ? and block_id = ?`,
          [position, hookId, blockId],
        )) as { rowCount?: number };
        if (result.rowCount === 0) {
          throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Hook attachment not found.');
        }
        // The statement matched no attachment, so nothing moved and nothing is
        // recorded. What the route answers in that case is unchanged here.
        if (previous === null) return { result: undefined, skipAudit: true };
        return {
          result: undefined,
          before: { blockId, position: previous },
          after: { blockId, position },
        };
      },
    });
    await this.invalidateForHookId(hookId);
    return this.attachmentsFor(hookId);
  }

  async removeAttachment(hookId: string, blockId: string): Promise<void> {
    await this.commandBus.run<void>({
      action: 'cms_hook.detach_block',
      objectType: HOOK_OBJECT_TYPE,
      objectId: hookId,
      run: async ({ em }) => {
        await this.assertExists(hookId, em);
        const previous = await this.attachmentPosition(em, hookId, blockId);
        // Detaching a block that is not attached has always answered success,
        // and still does — it removed nothing, so it records nothing.
        if (previous === null) return { result: undefined, skipAudit: true };
        await em.execute(
          'delete from cms_hook_block_attachments where hook_id = ? and block_id = ?',
          [hookId, blockId],
        );
        return { result: undefined, before: { blockId, position: previous }, after: null };
      },
    });
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
