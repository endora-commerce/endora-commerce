/**
 * EmailTemplateService — feature 047 (US3). CRUD for reusable email-safe
 * templates. Same surface as EmailBlockService without an `active` flag.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateEmailTemplateRequest,
  type EmailTemplateDetail,
  type EmailTemplateSummary,
  type PatchEmailTemplateRequest,
  type PutEmailBlockContentRequest,
} from '@endora-commerce/contracts';
import type { PuckDataTree } from '@endora-commerce/email-components/schema/envelope';
import { EMAIL_SAFE_COMPONENT_NAMES } from '@endora-commerce/email-components/schema/component-types';
import { walkUnknownComponents } from '@endora-commerce/email-components/tree/walk-embeds';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { EmailTemplate } from '../entities/email-template.entity.js';
import { EmailTemplateSalesChannel } from '../entities/email-template-sales-channel.entity.js';

const KNOWN: ReadonlySet<string> = new Set(EMAIL_SAFE_COMPONENT_NAMES);

function validateTree(content: unknown): void {
  const unknown = walkUnknownComponents(content, KNOWN);
  if (unknown.size > 0) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `Non-email-safe components: ${[...unknown].join(', ')}`);
  }
}

export class EmailTemplateService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
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
        objectType: 'email_template',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  private async channelIds(em: EntityManager, templateId: string): Promise<string[]> {
    const rows = await em.find(EmailTemplateSalesChannel, { templateId });
    return rows.map((r) => r.salesChannelId);
  }

  private async summary(em: EntityManager, t: EmailTemplate): Promise<EmailTemplateSummary> {
    const ids = await this.channelIds(em, t.id);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      isSystem: t.isSystem,
      scope: ids.length > 0 ? 'channel' : 'global',
      languages: t.languages,
      version: t.version,
    };
  }

  async list(salesChannelId?: string): Promise<EmailTemplateSummary[]> {
    const em = this.emFactory();
    const templates = await em.find(EmailTemplate, {}, { orderBy: { name: 'asc' } });
    const out: EmailTemplateSummary[] = [];
    for (const t of templates) {
      const s = await this.summary(em, t);
      if (salesChannelId && s.scope === 'channel') {
        const ids = await this.channelIds(em, t.id);
        if (!ids.includes(salesChannelId)) continue;
      }
      out.push(s);
    }
    return out;
  }

  private async loadOrThrow(em: EntityManager, id: string): Promise<EmailTemplate> {
    const t = await em.findOne(EmailTemplate, { id });
    if (!t) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Email template ${id} not found.`);
    return t;
  }

  async get(id: string): Promise<EmailTemplateDetail> {
    const em = this.emFactory();
    const t = await this.loadOrThrow(em, id);
    const ids = await this.channelIds(em, t.id);
    return {
      ...(await this.summary(em, t)),
      description: t.description,
      content: (t.content as { languages?: Record<string, PuckDataTree> }).languages ?? {},
      salesChannelIds: ids,
    };
  }

  async create(req: CreateEmailTemplateRequest): Promise<EmailTemplateDetail> {
    const em = this.emFactory();
    const existing = await em.findOne(EmailTemplate, { code: req.code });
    if (existing) throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, `Template code "${req.code}" already exists.`);
    const tpl = em.create(EmailTemplate, {
      code: req.code,
      name: req.name,
      description: req.description ?? null,
      content: { schema_version: 1, languages: {} },
      languages: req.languages,
      isSystem: false,
      version: 1,
    });
    await em.persistAndFlush(tpl);
    for (const scId of req.salesChannelIds ?? []) {
      em.persist(em.create(EmailTemplateSalesChannel, { templateId: tpl.id, salesChannelId: scId, code: tpl.code }));
    }
    this.#audit(em, 'email_template.create', tpl.id, null, { code: tpl.code, name: tpl.name });
    await em.flush();
    return this.get(tpl.id);
  }

  async patch(id: string, req: PatchEmailTemplateRequest): Promise<EmailTemplateDetail> {
    const em = this.emFactory();
    const t = await this.loadOrThrow(em, id);
    if (req.expectedVersion !== undefined && req.expectedVersion !== t.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Template was modified by someone else.');
    }
    if (req.name !== undefined) t.name = req.name;
    if (req.description !== undefined) t.description = req.description;
    if (req.salesChannelIds !== undefined && !t.isSystem) {
      const current = await em.find(EmailTemplateSalesChannel, { templateId: t.id });
      await em.removeAndFlush(current);
      for (const scId of req.salesChannelIds) {
        em.persist(em.create(EmailTemplateSalesChannel, { templateId: t.id, salesChannelId: scId, code: t.code }));
      }
    }
    this.#audit(em, 'email_template.update', t.id, null, { code: t.code, name: t.name });
    await em.flush();
    return this.get(id);
  }

  async setContent(id: string, language: string, req: PutEmailBlockContentRequest): Promise<EmailTemplateDetail> {
    validateTree(req.content);
    const em = this.emFactory();
    const t = await this.loadOrThrow(em, id);
    if (req.expectedVersion !== t.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Template was modified by someone else.');
    }
    const env = (t.content as { schema_version?: number; languages?: Record<string, unknown> }) ?? {};
    const languages = { ...(env.languages ?? {}), [language]: req.content };
    t.content = { schema_version: env.schema_version ?? 1, languages };
    if (!t.languages.includes(language)) t.languages = [...t.languages, language];
    t.version += 1;
    this.#audit(em, 'email_template.set_content', t.id, null, { language, version: t.version });
    await em.flush();
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory();
    const t = await this.loadOrThrow(em, id);
    if (t.isSystem) throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'System templates cannot be deleted.');
    const bridges = await em.find(EmailTemplateSalesChannel, { templateId: t.id });
    this.#audit(em, 'email_template.delete', t.id, { code: t.code }, null);
    await em.removeAndFlush([...bridges, t]);
  }
}
