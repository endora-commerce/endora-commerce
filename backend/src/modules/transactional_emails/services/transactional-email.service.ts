/**
 * TransactionalEmailService — feature 047 (US1/US2/US4).
 *
 * Implements the TransactionalEmailSender port: resolve effective subject +
 * content (channel -> global -> default), resolve embeds, render email-safe HTML
 * + plain text, substitute variables (Magento-style directives, HTML-escaped in
 * HTML), and send through the shared Mailer. Also powers the admin list/detail,
 * save/reset content, and preview endpoints.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type PreviewEmailResponse,
  type ResolvedEmailContent,
  type TransactionalEmailDetail,
  type TransactionalEmailSender,
  type TransactionalEmailSendInput,
  type TransactionalEmailSummary,
} from '@b2b/contracts';
import type { PuckDataTree } from '@b2b/email-components/schema/envelope';
import { EMAIL_SAFE_COMPONENT_NAMES } from '@b2b/email-components/schema/component-types';
import { walkUnknownComponents } from '@b2b/email-components/tree/walk-embeds';
import { renderEmailHtml } from '@b2b/email-components/render/render-email-html';
import { renderEmailText } from '@b2b/email-components/render/render-email-text';
import { renderDirectives } from '@b2b/email-components/directives/directive-engine';
import { HttpError } from '../../../http/error-envelope.js';
import type { Mailer } from '../../email/services/mailer.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { TransactionalEmail } from '../entities/transactional-email.entity.js';
import { TransactionalEmailContent } from '../entities/transactional-email-content.entity.js';
import type { ContentResolver} from './content-resolver.js';
import { type ResolvedContent } from './content-resolver.js';
import type { BrandingService} from './branding.service.js';
import { type ResolvedBranding } from './branding.service.js';
import type { EmbedResolver } from './embed-resolver.js';

const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(EMAIL_SAFE_COMPONENT_NAMES);

export interface SaveContentInput {
  subject: string;
  content: PuckDataTree;
  expectedVersion?: number;
}

export interface RenderResult {
  subject: string;
  html: string;
  text: string;
}

export interface TransactionalEmailServiceDeps {
  emFactory: () => EntityManager;
  contentResolver: ContentResolver;
  branding: BrandingService;
  embeds: EmbedResolver;
  mailer?: Mailer;
  auditLog?: AuditLogService;
}

export class TransactionalEmailService implements TransactionalEmailSender {
  private readonly emFactory: () => EntityManager;
  private readonly contentResolver: ContentResolver;
  private readonly branding: BrandingService;
  private readonly embeds: EmbedResolver;
  private readonly mailer: Mailer | undefined;
  private readonly auditLog: AuditLogService | undefined;

  constructor(deps: TransactionalEmailServiceDeps) {
    this.emFactory = deps.emFactory;
    this.contentResolver = deps.contentResolver;
    this.branding = deps.branding;
    this.embeds = deps.embeds;
    this.mailer = deps.mailer;
    this.auditLog = deps.auditLog;
  }

  // --- Sending (port) -----------------------------------------------------

  async send(input: TransactionalEmailSendInput): Promise<void> {
    if (!this.mailer) return; // best-effort: no transport configured
    const em = this.emFactory();
    const email = await em.findOne(TransactionalEmail, { code: input.code });
    if (!email || !email.active) return; // unknown/disabled email: nothing to send

    const fallbackLanguage = email.languages[0];
    const resolved = await this.contentResolver.resolve(em, email, {
      salesChannelId: input.salesChannelId,
      language: input.language,
      ...(fallbackLanguage ? { fallbackLanguage } : {}),
    });
    const branding = await this.branding.resolve(input.salesChannelId);
    const rendered = await this.renderWith(em, resolved, branding, input.variables, {
      salesChannelId: input.salesChannelId,
      language: resolved.language,
      ...(fallbackLanguage ? { fallbackLanguage } : {}),
    });

    await this.mailer.send({
      messageId: input.messageId,
      to: input.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    });
  }

  // --- Rendering ----------------------------------------------------------

  private async renderWith(
    em: EntityManager,
    resolved: ResolvedContent,
    branding: ResolvedBranding,
    variables: Record<string, unknown>,
    scope: { salesChannelId: string | null; language: string; fallbackLanguage?: string },
  ): Promise<RenderResult> {
    const embeds = await this.embeds.resolve(em, resolved.content, scope);
    const ctx: Record<string, unknown> = {
      ...variables,
      branding: { logoUrl: branding.logoUrl, accentColor: branding.accentColor },
    };
    const html = renderDirectives(
      renderEmailHtml(resolved.content, {
        embeds,
        accentColor: branding.accentColor,
        language: scope.language,
      }),
      ctx,
      { escape: true },
    );
    const text = renderDirectives(renderEmailText(resolved.content, { embeds }), ctx);
    const subject = renderDirectives(resolved.subject, ctx);
    return { subject, html, text };
  }

  // --- Admin: list / detail ----------------------------------------------

  async list(): Promise<TransactionalEmailSummary[]> {
    const em = this.emFactory();
    const emails = await em.find(TransactionalEmail, {}, { orderBy: { name: 'asc' } });
    const out: TransactionalEmailSummary[] = [];
    for (const e of emails) {
      const globalCount = await em.count(TransactionalEmailContent, { emailId: e.id, salesChannelId: null });
      const channelCount = await em.count(TransactionalEmailContent, { emailId: e.id, salesChannelId: { $ne: null } });
      out.push({
        code: e.code,
        name: e.name,
        ownerModule: e.ownerModule,
        group: e.groupCode,
        active: e.active,
        languages: e.languages,
        hasGlobalOverride: globalCount > 0,
        hasChannelOverride: channelCount > 0,
      });
    }
    return out;
  }

  private async loadEmailOrThrow(em: EntityManager, code: string): Promise<TransactionalEmail> {
    const email = await em.findOne(TransactionalEmail, { code });
    if (!email) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Transactional email "${code}" not found.`);
    return email;
  }

  async getDetail(code: string, salesChannelId: string | null, language?: string): Promise<TransactionalEmailDetail> {
    const em = this.emFactory();
    const email = await this.loadEmailOrThrow(em, code);
    const lang = language ?? email.languages[0] ?? 'en-US';
    const fallbackLanguage = email.languages[0];
    const resolved = await this.contentResolver.resolve(em, email, {
      salesChannelId,
      language: lang,
      ...(fallbackLanguage ? { fallbackLanguage } : {}),
    });
    const globalCount = await em.count(TransactionalEmailContent, { emailId: email.id, salesChannelId: null });
    const channelCount = await em.count(TransactionalEmailContent, { emailId: email.id, salesChannelId: { $ne: null } });
    const defaultContentTree =
      (email.defaultContent as { languages?: Record<string, unknown> }).languages?.[lang] ?? { root: { props: {} }, content: [] };

    const effective: ResolvedEmailContent = {
      subject: resolved.subject,
      content: resolved.content,
      source: resolved.source,
      version: resolved.version,
    };

    return {
      code: email.code,
      name: email.name,
      ownerModule: email.ownerModule,
      group: email.groupCode,
      description: email.description,
      active: email.active,
      languages: email.languages,
      variables: email.variables,
      scope: { salesChannelId, language: lang },
      effective,
      default: { subject: email.defaultSubject[lang] ?? '', content: defaultContentTree as PuckDataTree },
      hasGlobalOverride: globalCount > 0,
      hasChannelOverride: channelCount > 0,
    };
  }

  // --- Admin: save / reset -----------------------------------------------

  private validateContent(content: PuckDataTree): void {
    const unknown = walkUnknownComponents(content, KNOWN_COMPONENTS);
    if (unknown.size > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Email content contains non-email-safe components: ${[...unknown].join(', ')}`,
      );
    }
  }

  async saveContent(
    code: string,
    scope: { salesChannelId: string | null; language: string },
    input: SaveContentInput,
    actor: { adminUserId?: string | null } = {},
  ): Promise<ResolvedEmailContent> {
    if (!input.subject.trim()) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Subject is required.');
    }
    this.validateContent(input.content);

    const em = this.emFactory();
    const email = await this.loadEmailOrThrow(em, code);
    let row = await em.findOne(TransactionalEmailContent, {
      emailId: email.id,
      salesChannelId: scope.salesChannelId,
      language: scope.language,
    });
    if (row) {
      if (input.expectedVersion !== undefined && input.expectedVersion !== row.version) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Email content was modified by someone else.');
      }
      row.subject = input.subject;
      row.content = input.content;
      row.version += 1;
    } else {
      row = em.create(TransactionalEmailContent, {
        emailId: email.id,
        salesChannelId: scope.salesChannelId,
        language: scope.language,
        subject: input.subject,
        content: input.content,
        version: 1,
      });
    }
    await em.flush();
    await this.audit(actor, 'transactional_email.content.saved', email.code, { scope });

    return { subject: row.subject, content: row.content as PuckDataTree, source: scope.salesChannelId ? 'channel' : 'global', version: row.version };
  }

  async resetContent(
    code: string,
    scope: { salesChannelId: string | null; language: string },
    actor: { adminUserId?: string | null } = {},
  ): Promise<ResolvedEmailContent> {
    const em = this.emFactory();
    const email = await this.loadEmailOrThrow(em, code);
    const row = await em.findOne(TransactionalEmailContent, {
      emailId: email.id,
      salesChannelId: scope.salesChannelId,
      language: scope.language,
    });
    if (row) {
      await em.removeAndFlush(row);
      await this.audit(actor, 'transactional_email.content.reset', email.code, { scope });
    }
    const fallbackLanguage = email.languages[0];
    const resolved = await this.contentResolver.resolve(em, email, {
      salesChannelId: scope.salesChannelId,
      language: scope.language,
      ...(fallbackLanguage ? { fallbackLanguage } : {}),
    });
    return { subject: resolved.subject, content: resolved.content, source: resolved.source, version: resolved.version };
  }

  // --- Admin: preview -----------------------------------------------------

  async preview(
    code: string,
    input: { salesChannelId: string | null; language?: string; draftSubject?: string; draftContent?: PuckDataTree },
  ): Promise<PreviewEmailResponse> {
    const em = this.emFactory();
    const email = await this.loadEmailOrThrow(em, code);
    const lang = input.language ?? email.languages[0] ?? 'en-US';
    const fallbackLanguage = email.languages[0];

    let resolved: ResolvedContent;
    if (input.draftContent !== undefined || input.draftSubject !== undefined) {
      const base = await this.contentResolver.resolve(em, email, {
        salesChannelId: input.salesChannelId,
        language: lang,
        ...(fallbackLanguage ? { fallbackLanguage } : {}),
      });
      resolved = {
        subject: input.draftSubject ?? base.subject,
        content: input.draftContent ?? base.content,
        source: base.source,
        version: base.version,
        language: lang,
      };
    } else {
      resolved = await this.contentResolver.resolve(em, email, {
        salesChannelId: input.salesChannelId,
        language: lang,
        ...(fallbackLanguage ? { fallbackLanguage } : {}),
      });
    }

    const branding = await this.branding.resolve(input.salesChannelId);
    // Sample data drives the preview (FR-024).
    const variables = this.sampleVariables(email.variables);
    const rendered = await this.renderWith(em, resolved, branding, variables, {
      salesChannelId: input.salesChannelId,
      language: lang,
      ...(fallbackLanguage ? { fallbackLanguage } : {}),
    });
    return { subject: rendered.subject, html: rendered.html, text: rendered.text };
  }

  private sampleVariables(
    variables: ReadonlyArray<{ key: string; sampleValue?: string | undefined }>,
  ): Record<string, unknown> {
    // Prefer shared helper (JSON sampleValue for lists like order.items).
    // Local inline fallback mirrors packages/email-components sample-variables.
    const ctx: Record<string, unknown> = {};
    for (const v of variables) {
      const parts = v.key.split('.');
      let cur = ctx;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const part = parts[i];
        if (!part) continue;
        if (typeof cur[part] !== 'object' || cur[part] === null || Array.isArray(cur[part])) {
          cur[part] = {};
        }
        cur = cur[part] as Record<string, unknown>;
      }
      const leaf = parts[parts.length - 1];
      if (!leaf) continue;
      const raw = v.sampleValue;
      if (raw == null || raw === '') {
        cur[leaf] = `{${v.key}}`;
        continue;
      }
      const trimmed = raw.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          cur[leaf] = JSON.parse(trimmed) as unknown;
          continue;
        } catch {
          /* fall through */
        }
      }
      cur[leaf] = raw;
    }
    return ctx;
  }

  private async audit(
    actor: { adminUserId?: string | null },
    action: string,
    objectId: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLog) return;
    try {
      await this.auditLog.record({
        actorAdminUserId: actor.adminUserId ?? null,
        action,
        objectType: 'transactional_email',
        objectId,
        stateAfter: meta,
      });
    } catch {
      // Audit is best-effort; never block the operation.
    }
  }
}
