import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  QUOTE_REQUEST_DOCUMENT_TYPE,
  QUOTE_REQUEST_PDF_LIMITS,
  slugify,
  type CustomerAccountReadPort,
  type DocumentRenderPort,
  type DocumentRenderResult,
  type DocumentTemplateChoices,
  type QuoteRequestDocumentChoices,
  type QuoteRequestDocumentData,
  type QuoteRequestPdfSendRequest,
  type QuoteRequestPdfSendResult,
  type SalesRepAssignmentPort,
  type TransactionalEmailSender,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import {
  makeSendDocumentCommand,
  makeSetDocumentTemplateCommand,
  type DocumentCommandDeps,
} from '../commands/document-template-commands.js';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import { loadArrangedQuoteLines, toLineGroup } from '../services/line-order.js';
import type { AdminContext } from '../services/rfq-admin-service.js';
import { submissionRecordProposals } from '../services/draft-guard.js';
import { adminCanSeeOrganization } from '../services/admin-org-visibility.js';
import { formatQuoteDate } from './blocks/types.js';
import type { QuoteDocumentDataBuilder } from './data-builder.js';

/**
 * The quote PDF's admin operations — the choices, remembering a template, the
 * download and the e-mail (`contracts/quote-request-document.md` §6, §7, §7b).
 *
 * **Visibility first**, on every one: the quote is read and refused as an
 * unknown id when the administrator may not see its organisation — the rule
 * the quote's own detail route applies — before the facility is asked anything.
 * The data is built under that administrator, so no template can widen what a
 * PDF shows (FR-009).
 *
 * `documentRenderPort` is resolved per call and never probed or caught: while
 * document templates are off it answers `MODULE_DISABLED`, which is the off
 * state of every operation here (`refuses-without`, FR-060).
 */

export interface QuoteRequestDocumentServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly salesRepScope: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
  readonly renderPort: () => Pick<DocumentRenderPort, 'render' | 'listChoices'>;
  readonly builder: QuoteDocumentDataBuilder;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  readonly sender: () => TransactionalEmailSender | undefined;
  readonly log: (message: string, context: Record<string, unknown>) => void;
  /** Injectable for the contract suite; the product limit is `QUOTE_REQUEST_PDF_LIMITS`. */
  readonly maxAttachmentBytes?: () => number;
}

export interface RenderedQuotePdf {
  readonly result: DocumentRenderResult;
  readonly fileName: string;
  readonly templateName: string | null;
}

/** A file name a browser and a mail client accept: the quote's number as the shared slug, `.pdf`. */
export function quotePdfFileName(businessId: string): string {
  return `${slugify(businessId, { preserve: '_', maxLength: 120, fallback: 'quote-request' })}.pdf`;
}

export class QuoteRequestDocumentService {
  constructor(private readonly deps: QuoteRequestDocumentServiceDeps) {}

  private async findVisible(em: EntityManager, ctx: AdminContext, id: string): Promise<QuoteRequest> {
    const notFound = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    if (!isUuidShape(id)) throw notFound();
    const quote = await em.findOne(QuoteRequest, { id });
    if (!quote) throw notFound();
    // Only a sales representative is narrowed (issue #957), as on the detail.
    if (!(await adminCanSeeOrganization(this.deps.salesRepScope, ctx.adminUserId, quote.organizationId))) {
      throw notFound();
    }
    return quote;
  }

  private listChoices(salesChannelId: string | null): Promise<DocumentTemplateChoices> {
    return this.deps.renderPort().listChoices({ documentType: QUOTE_REQUEST_DOCUMENT_TYPE, salesChannelId });
  }

  private commandDeps(choices?: DocumentTemplateChoices): DocumentCommandDeps {
    return {
      salesRepScope: this.deps.salesRepScope,
      listChoices: choices ? async () => choices : (salesChannelId) => this.listChoices(salesChannelId),
      sender: this.deps.sender,
      log: this.deps.log,
    };
  }

  /** Route Q1 — what the export and send dialogs offer and preselect. */
  async choices(ctx: AdminContext, id: string): Promise<QuoteRequestDocumentChoices> {
    const em = this.deps.emFactory();
    const quote = await this.findVisible(em, ctx, id);
    const choices = await this.listChoices(quote.salesChannelId ?? null);
    const remembered = quote.documentTemplateId ?? null;
    const [suggestedLanguage, requester] = await Promise.all([
      this.deps.builder.suggestedLanguage(quote.salesChannelId),
      this.deps.customerAccounts.findById(quote.customerAccountId),
    ]);
    return {
      templates: choices.templates.map((template) => ({ ...template, languages: [...template.languages] })),
      rememberedTemplateId: remembered,
      rememberedTemplateMissing: remembered !== null && !choices.templates.some((t) => t.id === remembered),
      effectiveDefaultId: choices.effectiveDefaultId,
      builtInLanguages: [...choices.builtInLanguages],
      suggestedLanguage,
      requesterEmail: requester?.email ?? null,
    };
  }

  /** Route Q2 — remember (or forget) the quote's template; audited, never the offer's version. */
  async remember(ctx: AdminContext, id: string, documentTemplateId: string | null): Promise<{ documentTemplateId: string | null }> {
    const em = this.deps.emFactory();
    const quote = await this.findVisible(em, ctx, id);
    // Asked first so a switched-off facility answers 503 for forgetting too.
    const choices = await this.listChoices(quote.salesChannelId ?? null);
    return this.deps.commandBus.run(
      makeSetDocumentTemplateCommand({ quoteRequestId: id, documentTemplateId }, this.commandDeps(choices)),
    );
  }

  /**
   * Route Q3's render, shared by the send (Q4): an explicit template that
   * differs from the remembered one is remembered first (FR-005); then the
   * quote's **current** data is built in the language and rendered with the
   * explicit, else the remembered, else the default template.
   */
  async render(
    ctx: AdminContext,
    id: string,
    input: { readonly templateId?: string | undefined; readonly language?: string | undefined },
  ): Promise<RenderedQuotePdf & { quote: QuoteRequest; language: string; data: QuoteRequestDocumentData }> {
    const em = this.deps.emFactory();
    const quote = await this.findVisible(em, ctx, id);
    const choices = await this.listChoices(quote.salesChannelId ?? null);
    if (input.templateId !== undefined && input.templateId !== (quote.documentTemplateId ?? null)) {
      await this.deps.commandBus.run(
        makeSetDocumentTemplateCommand(
          { quoteRequestId: id, documentTemplateId: input.templateId },
          this.commandDeps(choices),
        ),
      );
    }
    const templateId = input.templateId ?? quote.documentTemplateId ?? undefined;

    const [arranged, events] = await Promise.all([
      loadArrangedQuoteLines(em, quote.id),
      em.find(QuoteRequestEvent, { quoteRequestId: quote.id }, { orderBy: { createdAt: 'asc' } }),
    ]);
    const items = arranged.lines;
    const language = input.language ?? (await this.deps.builder.suggestedLanguage(quote.salesChannelId));
    const data = await this.deps.builder.build({
      quote,
      lines: items,
      groups: arranged.groups.map(toLineGroup),
      language,
      proposals: await submissionRecordProposals(em, items, events),
    });

    let result: DocumentRenderResult;
    try {
      result = await this.deps.renderPort().render({
        documentType: QUOTE_REQUEST_DOCUMENT_TYPE,
        salesChannelId: quote.salesChannelId ?? null,
        language,
        data,
        ...(templateId !== undefined ? { templateId } : {}),
      });
    } catch (error) {
      // Logged with the quote and re-thrown untouched — the facility already
      // named the block; a presence answer passes through as it came.
      if (error instanceof HttpError && error.code === ERROR_CODES.DOCUMENT_RENDER_FAILED) {
        this.deps.log('[quote_requests] the quote PDF could not be produced', {
          quoteRequestId: quote.id,
          templateId: templateId ?? null,
          blockName: (error.details as { blockName?: unknown } | undefined)?.blockName ?? null,
        });
      }
      throw error;
    }
    const templateName = result.templateId
      ? (choices.templates.find((template) => template.id === result.templateId)?.name ?? null)
      : null;
    return { result, fileName: quotePdfFileName(quote.businessId), templateName, quote, language, data };
  }

  /** Route Q4 — e-mail the PDF to 1–5 recipients through the *Quote request PDF* e-mail (owner answer Q4). */
  async send(ctx: AdminContext, id: string, body: QuoteRequestPdfSendRequest): Promise<QuoteRequestPdfSendResult> {
    const rendered = await this.render(ctx, id, {
      ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
      ...(body.language !== undefined ? { language: body.language } : {}),
    });
    const limit = this.deps.maxAttachmentBytes?.() ?? QUOTE_REQUEST_PDF_LIMITS.maxAttachmentBytes;
    if (rendered.result.bytes.byteLength > limit) {
      throw new HttpError(422, ERROR_CODES.QUOTE_REQUEST_PDF_TOO_LARGE, 'The quote PDF is too large to send by e-mail.', {
        maxBytes: limit,
      });
    }
    const { quote, data } = rendered;
    const message = body.message?.trim() ? body.message.trim() : null;
    const outcome = await this.deps.commandBus.run(
      makeSendDocumentCommand(
        {
          quoteRequestId: id,
          sendId: randomUUID(),
          pdf: {
            bytes: rendered.result.bytes,
            fileName: rendered.fileName,
            templateId: rendered.result.templateId,
            templateName: rendered.templateName,
          },
          language: rendered.language,
          salesChannelId: quote.salesChannelId ?? null,
          recipients: body.recipients,
          message,
          roleLabel: ctx.roleLabel,
          // Nested, as the e-mail's `{{var quote.number}}` directives read them.
          variables: {
            quote: {
              number: quote.businessId,
              validUntil: formatQuoteDate(quote.expiresAt?.toISOString() ?? null, rendered.language),
            },
            customer: { name: data.buyer.customerName ?? '' },
            salesRep: { name: data.salesRep?.name ?? '', email: data.salesRep?.email ?? '' },
            channel: { name: data.channel?.name ?? '' },
            message: message ?? '',
          },
        },
        this.commandDeps(),
      ),
    );
    return {
      sent: outcome.sent,
      failed: outcome.failed,
      templateId: rendered.result.templateId,
      templateSource: rendered.result.source,
      requestedTemplateMissing: rendered.result.requestedTemplateMissing,
    };
  }
}
