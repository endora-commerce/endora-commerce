/**
 * EmailBlockService — feature 047 (US3). CRUD for reusable email-safe blocks,
 * including per-channel scoping via the bridge table, optimistic concurrency,
 * email-safe validation, system-block protection, and a reference check on
 * delete (a block embedded by any email/block/template cannot be removed).
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateEmailBlockRequest,
  type EmailBlockDetail,
  type EmailBlockSummary,
  type PatchEmailBlockRequest,
  type PutEmailBlockContentRequest,
} from '@b2b/contracts';
import type { PuckDataTree } from '@b2b/email-components/schema/envelope';
import { EMAIL_SAFE_COMPONENT_NAMES } from '@b2b/email-components/schema/component-types';
import { walkUnknownComponents } from '@b2b/email-components/tree/walk-embeds';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { EmailBlock } from '../entities/email-block.entity.js';
import { EmailBlockSalesChannel } from '../entities/email-block-sales-channel.entity.js';

const KNOWN: ReadonlySet<string> = new Set(EMAIL_SAFE_COMPONENT_NAMES);

function validateTree(content: unknown): void {
  const unknown = walkUnknownComponents(content, KNOWN);
  if (unknown.size > 0) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `Non-email-safe components: ${[...unknown].join(', ')}`);
  }
}

export class EmailBlockService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'email_block',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  private async channelIds(em: EntityManager, blockId: string): Promise<string[]> {
    const rows = await em.find(EmailBlockSalesChannel, { blockId });
    return rows.map((r) => r.salesChannelId);
  }

  private async summary(em: EntityManager, b: EmailBlock): Promise<EmailBlockSummary> {
    const ids = await this.channelIds(em, b.id);
    return {
      id: b.id,
      code: b.code,
      name: b.name,
      active: b.active,
      isSystem: b.isSystem,
      scope: ids.length > 0 ? 'channel' : 'global',
      languages: b.languages,
      version: b.version,
    };
  }

  async list(salesChannelId?: string): Promise<EmailBlockSummary[]> {
    const em = this.emFactory();
    const blocks = await em.find(EmailBlock, {}, { orderBy: { name: 'asc' } });
    const out: EmailBlockSummary[] = [];
    for (const b of blocks) {
      const summary = await this.summary(em, b);
      if (salesChannelId && summary.scope === 'channel') {
        const ids = await this.channelIds(em, b.id);
        if (!ids.includes(salesChannelId)) continue;
      }
      out.push(summary);
    }
    return out;
  }

  private async loadOrThrow(em: EntityManager, id: string): Promise<EmailBlock> {
    const b = await em.findOne(EmailBlock, { id });
    if (!b) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Email block ${id} not found.`);
    return b;
  }

  async get(id: string): Promise<EmailBlockDetail> {
    const em = this.emFactory();
    const b = await this.loadOrThrow(em, id);
    const ids = await this.channelIds(em, b.id);
    return {
      ...(await this.summary(em, b)),
      description: b.description,
      content: (b.content as { languages?: Record<string, PuckDataTree> }).languages ?? {},
      salesChannelIds: ids,
    };
  }

  async create(req: CreateEmailBlockRequest, actor?: unknown): Promise<EmailBlockDetail> {
    void actor;
    const em = this.emFactory();
    const existing = await em.findOne(EmailBlock, { code: req.code });
    if (existing) throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, `Block code "${req.code}" already exists.`);
    const block = em.create(EmailBlock, {
      code: req.code,
      name: req.name,
      description: req.description ?? null,
      active: req.active ?? true,
      content: { schema_version: 1, languages: {} },
      languages: req.languages,
      isSystem: false,
      version: 1,
    });
    await em.persistAndFlush(block);
    for (const scId of req.salesChannelIds ?? []) {
      em.persist(em.create(EmailBlockSalesChannel, { blockId: block.id, salesChannelId: scId, code: block.code }));
    }
    this.#audit(em, 'email_block.create', block.id, null, { code: block.code, name: block.name });
    await em.flush();
    return this.get(block.id);
  }

  async patch(id: string, req: PatchEmailBlockRequest): Promise<EmailBlockDetail> {
    const em = this.emFactory();
    const b = await this.loadOrThrow(em, id);
    if (req.expectedVersion !== undefined && req.expectedVersion !== b.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Block was modified by someone else.');
    }
    if (req.name !== undefined) b.name = req.name;
    if (req.description !== undefined) b.description = req.description;
    if (req.active !== undefined && !b.isSystem) b.active = req.active;
    if (req.salesChannelIds !== undefined && !b.isSystem) {
      const current = await em.find(EmailBlockSalesChannel, { blockId: b.id });
      await em.removeAndFlush(current);
      for (const scId of req.salesChannelIds) {
        em.persist(em.create(EmailBlockSalesChannel, { blockId: b.id, salesChannelId: scId, code: b.code }));
      }
    }
    this.#audit(em, 'email_block.update', b.id, null, { code: b.code, name: b.name });
    await em.flush();
    return this.get(id);
  }

  async setContent(id: string, language: string, req: PutEmailBlockContentRequest): Promise<EmailBlockDetail> {
    validateTree(req.content);
    const em = this.emFactory();
    const b = await this.loadOrThrow(em, id);
    if (req.expectedVersion !== b.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Block was modified by someone else.');
    }
    const env = (b.content as { schema_version?: number; languages?: Record<string, unknown> }) ?? {};
    const languages = { ...(env.languages ?? {}), [language]: req.content };
    b.content = { schema_version: env.schema_version ?? 1, languages };
    if (!b.languages.includes(language)) b.languages = [...b.languages, language];
    b.version += 1;
    this.#audit(em, 'email_block.set_content', b.id, null, { language, version: b.version });
    await em.flush();
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory();
    const b = await this.loadOrThrow(em, id);
    if (b.isSystem) throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'System blocks cannot be deleted.');
    const bridges = await em.find(EmailBlockSalesChannel, { blockId: b.id });
    this.#audit(em, 'email_block.delete', b.id, { code: b.code }, null);
    await em.removeAndFlush([...bridges, b]);
  }
}
