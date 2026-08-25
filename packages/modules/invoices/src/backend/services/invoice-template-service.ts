import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { InvoiceTemplate } from '../entities/invoice-template.entity.js';
import { pickLanguageTree } from '../pdf-components/tree-mapper.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import {
  GENERIC_INVOICE_TEMPLATE_CODE,
  GENERIC_INVOICE_TEMPLATE_CONTENT,
  GENERIC_INVOICE_TEMPLATE_LANGUAGES,
  GENERIC_INVOICE_TEMPLATE_SEED_REVISION,
} from '../seeds/generic-invoice-template.js';

export interface InvoiceTemplateSummary {
  id: string;
  code: string;
  name: string;
  salesChannelId: string | null;
  languages: string[];
  active: boolean;
  isSystem: boolean;
  version: number;
}

function summary(t: InvoiceTemplate): InvoiceTemplateSummary {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    salesChannelId: t.salesChannelId ?? null,
    languages: t.languages,
    active: t.active,
    isSystem: t.isSystem,
    version: t.version,
  };
}

/**
 * Invoice template CRUD + resolution (feature 047, US6). One seeded global
 * generic template (system); optional per-channel overrides. Resolution:
 * per-channel active → global active → seeded generic (FR-015/016).
 */
export class InvoiceTemplateService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateAfter: Record<string, unknown>): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'invoice_template',
        objectId,
        stateBefore: null,
        stateAfter,
      });
    }
  }

  /**
   * Install or refresh the system generic template (lifecycle / boot).
   * When the on-disk seed revision advances, existing `generic` system rows
   * are rewritten so admin editors see the current default props/layout.
   */
  async ensureGenericSeed(): Promise<void> {
    // command-coverage-ignore: idempotent boot seed of the system generic invoice
    // template — a bootstrap, not an operator-initiated write.
    const em = this.emFactory();
    const existing = await em.findOne(InvoiceTemplate, { code: GENERIC_INVOICE_TEMPLATE_CODE, isSystem: true });
    if (existing) {
      const rev = Number((existing.content as { schema_version?: number } | null)?.schema_version ?? 0);
      if (rev >= GENERIC_INVOICE_TEMPLATE_SEED_REVISION) return;
      existing.content = structuredClone(GENERIC_INVOICE_TEMPLATE_CONTENT) as Record<string, unknown>;
      existing.languages = [...GENERIC_INVOICE_TEMPLATE_LANGUAGES];
      existing.version += 1;
      await em.flush();
      return;
    }
    // Only seed if no global template occupies the active-global slot.
    const globalActive = await em.findOne(InvoiceTemplate, { salesChannelId: null, active: true });
    const tpl = em.create(InvoiceTemplate, {
      code: GENERIC_INVOICE_TEMPLATE_CODE,
      name: 'Generic invoice template',
      salesChannelId: null,
      content: structuredClone(GENERIC_INVOICE_TEMPLATE_CONTENT) as Record<string, unknown>,
      languages: [...GENERIC_INVOICE_TEMPLATE_LANGUAGES],
      active: !globalActive,
      isSystem: true,
      version: 1,
    });
    await em.persistAndFlush(tpl);
  }

  async list(): Promise<InvoiceTemplateSummary[]> {
    const em = this.emFactory();
    const rows = await em.find(InvoiceTemplate, {}, { orderBy: { isSystem: 'desc', name: 'asc' } });
    return rows.map(summary);
  }

  async get(id: string): Promise<InvoiceTemplateSummary & { content: Record<string, unknown> }> {
    const em = this.emFactory();
    const t = await em.findOne(InvoiceTemplate, { id });
    if (!t) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice template not found.');
    return { ...summary(t), content: t.content };
  }

  async create(input: { code: string; name: string; salesChannelId?: string | null }): Promise<InvoiceTemplateSummary> {
    const em = this.emFactory();
    const channelId = input.salesChannelId ?? null;
    // Deactivate any currently-active template in the same scope so the new one
    // can become the single active template (partial-unique index).
    await em.nativeUpdate(InvoiceTemplate, { salesChannelId: channelId, active: true }, { active: false });
    const tpl = em.create(InvoiceTemplate, {
      code: input.code,
      name: input.name,
      salesChannelId: channelId,
      content: structuredClone(GENERIC_INVOICE_TEMPLATE_CONTENT),
      languages: GENERIC_INVOICE_TEMPLATE_LANGUAGES,
      active: true,
      isSystem: false,
      version: 1,
    });
    em.persist(tpl);
    this.#audit(em, 'invoice_template.create', tpl.id, { code: tpl.code, name: tpl.name });
    await em.flush();
    return summary(tpl);
  }

  /** Save the Puck tree for one language with optimistic concurrency. */
  async saveContent(
    id: string,
    language: string,
    data: unknown,
    version: number,
  ): Promise<InvoiceTemplateSummary> {
    const em = this.emFactory();
    const t = await em.findOne(InvoiceTemplate, { id });
    if (!t) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Invoice template not found.');
    if (t.version !== version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Template was modified by someone else.');
    }
    const content = { ...(t.content as Record<string, unknown>) };
    const languages = (content['languages'] as Record<string, unknown>) ?? {};
    languages[language] = data;
    content['languages'] = languages;
    content['schema_version'] = content['schema_version'] ?? 1;
    t.content = content;
    if (!t.languages.includes(language)) t.languages = [...t.languages, language];
    t.version += 1;
    this.#audit(em, 'invoice_template.save_content', t.id, { language, version: t.version });
    await em.persistAndFlush(t);
    return summary(t);
  }

  /** Resolve the active template's Puck tree for a channel + language. */
  async resolveTree(salesChannelId: string | null, language: string): Promise<unknown | null> {
    const em = this.emFactory();
    let t: InvoiceTemplate | null = null;
    if (salesChannelId) {
      t = await em.findOne(InvoiceTemplate, { salesChannelId, active: true });
    }
    if (!t) t = await em.findOne(InvoiceTemplate, { salesChannelId: null, active: true });
    if (!t) t = await em.findOne(InvoiceTemplate, { code: GENERIC_INVOICE_TEMPLATE_CODE });
    if (!t) return null;
    return pickLanguageTree(t.content, language);
  }
}
