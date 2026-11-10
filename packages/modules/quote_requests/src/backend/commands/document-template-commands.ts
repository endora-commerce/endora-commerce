import {
  ERROR_CODES,
  type DocumentTemplateChoices,
  type SalesRepAssignmentPort,
  type TransactionalEmailSender,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { Command, CommandActor } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import { adminCanSeeOrganization, isPlatformWideScope } from '../services/admin-org-visibility.js';

/**
 * Feature 153 — the two audited writes of the quote PDF
 * (`specs/153-quote-request-pdf-template/data-model.md` §4.3, §4.4).
 *
 * The 146 idiom (`negotiation-policy-commands.ts`): **the authority step is
 * inside the Command** — the quote is read, and refused exactly as an unknown
 * id when the caller may not see its organisation, before anything else is
 * asked or written; writes go through the unit of work, never `nativeUpdate`.
 *
 * Neither touches the quote's offer: no `version`, no revision. Remembering a
 * template is presentation (FR-010) and sending a PDF is a delivery of the
 * offer as it stands (FR-096), so a colleague's concurrent offer edit never
 * fails because of either.
 */

/** The transactional e-mail the quote PDF is sent in (owner answer Q4). */
export const QUOTE_REQUEST_PDF_EMAIL_CODE = 'quote_request_pdf';

export interface DocumentCommandDeps {
  readonly salesRepScope: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
  /** The quote templates a document of this channel may use (`documentRenderPort.listChoices`). */
  readonly listChoices: (salesChannelId: string | null) => Promise<DocumentTemplateChoices>;
  /** `transactional_emails`' sender, read per send; `undefined` = no sender composed. */
  readonly sender: () => TransactionalEmailSender | undefined;
  readonly log?: (message: string, context: Record<string, unknown>) => void;
  /** Whether the ambient scope reaches every organisation. Injectable for the unit test only. */
  readonly isPlatformAdmin?: () => boolean;
}

const notFound = (): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');

async function findVisible(
  em: Parameters<Command['run']>[0]['em'],
  actor: CommandActor,
  deps: DocumentCommandDeps,
  quoteRequestId: string,
): Promise<QuoteRequest> {
  if (!isUuidShape(quoteRequestId)) throw notFound();
  const quote = await em.findOne(QuoteRequest, { id: quoteRequestId });
  if (!quote) throw notFound();
  const reach = await adminCanSeeOrganization(
    deps.salesRepScope,
    actor.actorAdminUserId,
    quote.organizationId,
    deps.isPlatformAdmin ?? isPlatformWideScope,
  );
  if (!reach) throw notFound();
  return quote;
}

/** `quote_request.set_document_template` — remember (or forget, `null`) a quote's PDF template. */
export function makeSetDocumentTemplateCommand(
  input: { quoteRequestId: string; documentTemplateId: string | null },
  deps: DocumentCommandDeps,
): Command<{ documentTemplateId: string | null }> {
  return {
    action: 'quote_request.set_document_template',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    run: async ({ em, actor }) => {
      const quote = await findVisible(em, actor, deps, input.quoteRequestId);
      const before = quote.documentTemplateId ?? null;
      if (before === input.documentTemplateId) {
        return { result: { documentTemplateId: before }, skipAudit: true };
      }
      if (input.documentTemplateId !== null) {
        // Global, or of the quote's own channel, and of this document type —
        // the facility's own answer; a quote with no channel sees global only.
        const choices = await deps.listChoices(quote.salesChannelId ?? null);
        if (!choices.templates.some((template) => template.id === input.documentTemplateId)) {
          throw new HttpError(
            422,
            ERROR_CODES.DOCUMENT_TEMPLATE_NOT_SELECTABLE,
            'This template cannot be chosen for this quote request.',
            { templateId: input.documentTemplateId },
          );
        }
      }
      quote.documentTemplateId = input.documentTemplateId;
      await em.flush();
      return {
        result: { documentTemplateId: input.documentTemplateId },
        before: { documentTemplateId: before },
        after: { documentTemplateId: input.documentTemplateId },
      };
    },
  };
}

export interface SendDocumentInput {
  readonly quoteRequestId: string;
  /** Unique per send: the e-mails' message ids derive from it. */
  readonly sendId: string;
  /** The PDF the route rendered — the bytes are attached, never audited. */
  readonly pdf: {
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly templateId: string | null;
    readonly templateName: string | null;
  };
  readonly language: string;
  readonly salesChannelId: string | null;
  /** Already validated: 1–5 distinct addresses. */
  readonly recipients: readonly string[];
  readonly message: string | null;
  /** Recorded on the history event as the actor's role, as every admin event is. */
  readonly roleLabel: string | null;
  readonly variables: Record<string, unknown>;
}

const UNAVAILABLE = new Set(['deactivated', 'no_transport', 'no_definition']);

/**
 * `quote_request.send_document` — e-mail the rendered quote PDF to each
 * recipient (owner answer Q4, FR-093–FR-097).
 *
 * One e-mail per recipient (the sender takes one `to`, and no recipient sees
 * another's address). A **configuration** answer — the e-mail switched off, no
 * transport, no definition — is the same for every recipient, so the first one
 * stops the send and nothing is recorded. A **transport** failure is that one
 * address's: the others are still tried, and only the delivered ones are
 * recorded. Nothing delivered is a refusal and records nothing.
 */
export function makeSendDocumentCommand(
  input: SendDocumentInput,
  deps: DocumentCommandDeps,
): Command<{ sent: string[]; failed: string[] }> {
  return {
    action: 'quote_request.send_document',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    run: async ({ em, actor }) => {
      const quote = await findVisible(em, actor, deps, input.quoteRequestId);
      const sender = deps.sender();
      const unavailable = (code: string): HttpError =>
        new HttpError(
          409,
          ERROR_CODES.QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE,
          'The quote request PDF e-mail cannot be sent.',
          { code },
        );
      if (!sender) throw unavailable('no_transport');

      const sent: string[] = [];
      const failed: string[] = [];
      for (const [index, to] of input.recipients.entries()) {
        let status: string;
        try {
          const outcome = await sender.send({
            code: QUOTE_REQUEST_PDF_EMAIL_CODE,
            salesChannelId: input.salesChannelId,
            language: input.language,
            to,
            variables: input.variables,
            messageId: `quote-request-pdf:${input.sendId}:${index + 1}`,
            attachments: [{ filename: input.pdf.fileName, content: input.pdf.bytes, contentType: 'application/pdf' }],
            document: { type: 'quote_request', id: quote.id },
          });
          status = outcome.status;
        } catch (error) {
          // A switched-off owner is the whole operation's answer, not one address's.
          rethrowIfModuleDisabled(error);
          deps.log?.('[quote_requests] the quote PDF could not be delivered to one recipient', {
            quoteRequestId: quote.id,
            recipientIndex: index + 1,
            error: error instanceof Error ? error.message : String(error),
          });
          failed.push(to);
          continue;
        }
        if (UNAVAILABLE.has(status)) {
          if (sent.length === 0) throw unavailable(status);
          // Not reachable in practice — the answer does not change between
          // recipients — but what was delivered stays recorded.
          failed.push(...input.recipients.slice(index));
          break;
        }
        sent.push(to);
      }
      if (sent.length === 0) {
        throw new HttpError(
          502,
          ERROR_CODES.QUOTE_REQUEST_PDF_SEND_FAILED,
          'The quote request PDF could not be delivered to any recipient.',
        );
      }

      em.persist(
        em.create(QuoteRequestEvent, {
          quoteRequestId: quote.id,
          eventType: 'pdf-sent',
          actorAdminUserId: actor.actorAdminUserId,
          actorRoleLabel: input.roleLabel,
          payload: {
            type: 'pdf-sent',
            recipients: sent,
            templateId: input.pdf.templateId,
            templateName: input.pdf.templateName,
            language: input.language,
            message: input.message,
          },
        }),
      );
      await em.flush();
      return {
        result: { sent, failed },
        // How many it went to, never the addresses (D-288, #470): the
        // `pdf-sent` history event above keeps them, under the quote's reach.
        after: {
          templateId: input.pdf.templateId,
          language: input.language,
          recipientCount: sent.length,
          failedRecipientCount: failed.length,
        },
      };
    },
  };
}
