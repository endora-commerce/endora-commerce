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
  type TransactionalSendOutcome,
} from '@b2b/contracts';
import type { PuckDataTree } from '@b2b/email-components/schema/envelope';
import { EMAIL_SAFE_COMPONENT_NAMES } from '@b2b/email-components/schema/component-types';
import { walkUnknownComponents } from '@b2b/email-components/tree/walk-embeds';
import { renderEmailHtml } from '@b2b/email-components/render/render-email-html';
import { renderEmailText } from '@b2b/email-components/render/render-email-text';
import { renderDirectives } from '@b2b/email-components/directives/directive-engine';
import { HttpError } from '../../../http/error-envelope.js';
import type {
  EmailDeliveryRecorder,
  EmailDeliveryReason,
  EmailMailerPort,
} from '@b2b/contracts';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { TransactionalEmail } from '../entities/transactional-email.entity.js';
import { TransactionalEmailContent } from '../entities/transactional-email-content.entity.js';
import type { ContentResolver} from './content-resolver.js';
import { type ResolvedContent } from './content-resolver.js';
import type { BrandingService} from './branding.service.js';
import { type ResolvedBranding } from './branding.service.js';
import type { EmbedResolver } from './embed-resolver.js';
import type { EmailDefaultsRegistry } from './email-defaults-registry.js';

const KNOWN_COMPONENTS: ReadonlySet<string> = new Set(EMAIL_SAFE_COMPONENT_NAMES);

/**
 * A missing transport is a deployment fact, not a per-message one: it holds for
 * every send until someone fixes the composition. The guard is deliberately
 * **per process** (module scope, never reset) so a misconfigured deployment
 * gets one line instead of one per email.
 */
let noTransportWarned = false;

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
  /**
   * The owner ledger the admin projection reads for the per-email protection
   * (issue #89). Required rather than optional: an absent registry would make
   * every email report itself deactivatable, which is the one wrong answer —
   * the admin would offer a switch for `email_verification` and the write path
   * would refuse it.
   */
  defaults: EmailDefaultsRegistry;
  /**
   * The transport, named by `email`'s published contract since feature 075's
   * Phase C. `email` registers it ungated and declares itself
   * non-deactivatable, so this edge has no absent state to fail closed onto —
   * the `undefined` below is a composition that wired no transport at all,
   * which `send` reports as `no_transport`.
   */
  mailer?: EmailMailerPort;
  /**
   * Where the three outcomes decided **before** the transport are recorded
   * (D-59). Optional: a composition with no recorder loses the row, not the
   * send, which is the same tolerance the recorder itself states.
   */
  deliveryRecorder?: EmailDeliveryRecorder;
  auditLog?: AuditLogService;
}

export class TransactionalEmailService implements TransactionalEmailSender {
  private readonly emFactory: () => EntityManager;
  private readonly contentResolver: ContentResolver;
  private readonly branding: BrandingService;
  private readonly embeds: EmbedResolver;
  private readonly defaults: EmailDefaultsRegistry;
  private readonly mailer: EmailMailerPort | undefined;
  private readonly deliveryRecorder: EmailDeliveryRecorder | undefined;
  private readonly auditLog: AuditLogService | undefined;

  constructor(deps: TransactionalEmailServiceDeps) {
    this.emFactory = deps.emFactory;
    this.contentResolver = deps.contentResolver;
    this.branding = deps.branding;
    this.embeds = deps.embeds;
    this.defaults = deps.defaults;
    this.mailer = deps.mailer;
    this.deliveryRecorder = deps.deliveryRecorder;
    this.auditLog = deps.auditLog;
  }

  // --- Sending (port) -----------------------------------------------------

  /**
   * Delivers the email and reports what happened. The three non-`sent` outcomes
   * used to be one silent `return`, which left every caller unable to tell an
   * operator's "off" from a code with no template — and suppressing its own
   * fallback for both.
   *
   * Since D-59 each of those three also leaves a **row**. They are the outcomes
   * decided before the transport is reached, so the record `RecordingMailer`
   * writes never gets the chance — and one of them, `deactivated`, is the whole
   * reason the record has to tell a deliberate configuration from an outage.
   * A delivered message is deliberately *not* recorded here: the transport
   * records it, so one send stays one row.
   */
  async send(input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> {
    if (!this.mailer) {
      if (!noTransportWarned) {
        noTransportWarned = true;
        console.warn(
          '[transactional_emails] no mailer configured — transactional emails are not being delivered (logged once per process).',
        );
      }
      await this.recordNotSent(input, 'failed', 'no_transport');
      return { status: 'no_transport' };
    }
    const em = this.emFactory();
    const email = await em.findOne(TransactionalEmail, { code: input.code });
    // No definition: the caller may still have a legacy in-code builder for
    // this code. Deactivated: the operator chose silence, so nothing goes out.
    if (!email) {
      await this.recordNotSent(input, 'failed', 'no_definition');
      return { status: 'no_definition' };
    }
    if (!email.active) {
      await this.recordNotSent(input, 'suppressed', 'deactivated');
      return { status: 'deactivated' };
    }

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

    // The transport's own answer (`sent` / `suppressed`, D-59) is deliberately
    // not carried further, and this is the decision rather than an oversight:
    // its one suppression reason is `duplicate_message_id`, meaning this exact
    // message id was already accepted, so the message did go out. What
    // `TransactionalSendOutcome` exists to tell a caller is whether it may fall
    // back to its own in-code builder, and neither transport answer permits
    // that. The row is not lost either — `RecordingMailer` writes the
    // `suppressed` delivery record before returning. Widening the union here
    // would publish a distinction no caller can act on.
    await this.mailer.send({
      messageId: input.messageId,
      to: input.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      // What the delivery record needs and only this layer holds: the code the
      // message was rendered from, the channel it was rendered for, and the
      // document it delivers.
      kind: input.code,
      salesChannelId: input.salesChannelId,
      ...(input.document ? { document: input.document } : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    });
    return { status: 'sent' };
  }

  /**
   * One row for a message this layer decided not to send.
   *
   * No `catch`: the recorder answers `null` for a row it could not write and
   * never throws (its own contract), so there is nothing here to contain — and
   * a `catch` around a collaborator another module owns is how a presence
   * answer stops travelling.
   */
  private async recordNotSent(
    input: TransactionalEmailSendInput,
    status: 'suppressed' | 'failed',
    reason: EmailDeliveryReason,
  ): Promise<void> {
    await this.deliveryRecorder?.record({
      messageId: input.messageId,
      recipient: input.to,
      kind: input.code,
      status,
      reason,
      salesChannelId: input.salesChannelId,
      ...(input.document
        ? { documentType: input.document.type, documentId: input.document.id }
        : {}),
      ...(input.meta ? { context: input.meta } : {}),
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

  /**
   * Whether an operator may switch this one email off (issue #89).
   *
   * Resolved from the registry on every read rather than persisted on the row:
   * the declaration is shipped code owned by the sending module, so a stored
   * copy would go stale the moment that module changed its mind, and the
   * reconciler would have one more column to fight over.
   */
  private protectionOf(code: string): {
    deactivatable: boolean;
    nonDeactivatableReason: string | null;
  } {
    const reason = this.defaults.nonDeactivatableReasonOf(code);
    return { deactivatable: reason === null, nonDeactivatableReason: reason };
  }

  private async summarize(
    em: EntityManager,
    email: TransactionalEmail,
  ): Promise<TransactionalEmailSummary> {
    const globalCount = await em.count(TransactionalEmailContent, { emailId: email.id, salesChannelId: null });
    const channelCount = await em.count(TransactionalEmailContent, { emailId: email.id, salesChannelId: { $ne: null } });
    return {
      code: email.code,
      name: email.name,
      ownerModule: email.ownerModule,
      group: email.groupCode,
      active: email.active,
      languages: email.languages,
      hasGlobalOverride: globalCount > 0,
      hasChannelOverride: channelCount > 0,
      ...this.protectionOf(email.code),
    };
  }

  async list(): Promise<TransactionalEmailSummary[]> {
    const em = this.emFactory();
    const emails = await em.find(TransactionalEmail, {}, { orderBy: { name: 'asc' } });
    const out: TransactionalEmailSummary[] = [];
    for (const e of emails) {
      out.push(await this.summarize(em, e));
    }
    return out;
  }

  /**
   * One email's summary, re-read from the database.
   *
   * The activation route answers with this rather than with what it just
   * wrote — the flip runs on the Command Bus's own forked EM, so the only
   * honest report of the committed state is a fresh read. Hence `refresh`
   * rather than `em.clear()`: the request-scoped identity map may hold entities
   * the auth guard put there, and discarding those to re-read one row is a
   * wider blast radius than the question needs.
   */
  async summary(code: string): Promise<TransactionalEmailSummary> {
    const em = this.emFactory();
    const email = await em.findOne(TransactionalEmail, { code }, { refresh: true });
    if (!email) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Transactional email "${code}" not found.`);
    return this.summarize(em, email);
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
      ...this.protectionOf(email.code),
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
