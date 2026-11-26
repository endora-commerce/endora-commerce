import {
  adminApproveQuoteRequestSchema,
  adminAssignQuoteRequestSchema,
  adminCancelQuoteRequestSchema,
  adminCreateQuoteRequestSchema,
  adminPatchQuoteRequestSchema,
  aggregateCommandSourceSchema,
  ERROR_CODES,
  quoteRequestPdfSendRequestSchema,
  uuidSchema,
  type AdminApproveQuoteRequest,
  type AdminCreateQuoteRequest,
  type AdminPatchQuoteRequest,
  type AggregateCommandOptions,
  type CustomFieldMerge,
  type QuoteRequestCommandPort,
  type QuoteRequestPdfSendRequest,
  type QuoteRequestPdfSendResult,
  type QuoteRequestRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  makeApproveQuoteRequestCommand,
  makeAssignQuoteRequestCommand,
  makeCancelQuoteRequestCommand,
  makeCreateOnBehalfCommand,
  makeModifyQuoteRequestCommand,
  makeSetQuoteRequestCustomFieldValuesCommand,
  type QuoteRequestOperator,
} from '../commands/quote-request-admin-commands.js';
import type { QuoteRequestDocumentService } from '../document/document-service.js';
import { toQuoteRequestRecord } from './quote-request-read-port.js';
import type { RfqAdminService } from './rfq-admin-service.js';

/**
 * `quoteRequestCommandPort` (issue #1824, `specs/186-aggregate-ports/` US5) —
 * the QuoteRequest aggregate's write port. The contract and its refusals are
 * `QuoteRequestCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method parses its
 * input with the admin route's schema, builds the Command from the factory the
 * route's service builds it from (`commands/quote-request-admin-commands.ts`)
 * and runs it through `RfqAdminService.runWrite` — the route's own runner, which
 * also wakes the notification delivery after the commit — so the audit entry,
 * the history, the notifications and the event cannot differ between the two.
 * `sendDocument` is the quote PDF route's `QuoteRequestDocumentService.send`.
 *
 * The operator the history names is the ambient one: the administrator of the
 * tenant context, with the label the admin routes show, else the system
 * (`'System'`, as the order-completion reactor and the carry receiver write).
 */

export interface QuoteRequestCommandServiceDeps {
  /** The admin service, read per call: the module handle builds it when the module composes. */
  readonly admin: () => Pick<RfqAdminService, 'commandDeps' | 'runWrite'>;
  readonly documents: () => Pick<QuoteRequestDocumentService, 'send'>;
  /** Who the ambient tenant context says is writing. Throws with no tenant context. */
  readonly operator: () => Promise<QuoteRequestOperator>;
}

/** `assign`'s input: the route's body, where a `null` id clears the assignee. */
const assignInputSchema = adminAssignQuoteRequestSchema.extend({ adminUserId: uuidSchema.nullable() });

export class QuoteRequestCommandService implements QuoteRequestCommandPort {
  constructor(private readonly deps: QuoteRequestCommandServiceDeps) {}

  async create(input: AdminCreateQuoteRequest, options: AggregateCommandOptions = {}): Promise<QuoteRequestRecord> {
    const body = adminCreateQuoteRequestSchema.parse(input);
    const write = await this.#options(options);
    const admin = this.deps.admin();
    const rfq = await admin.runWrite(makeCreateOnBehalfCommand(admin.commandDeps, { ...write, body }), { notifies: true });
    return toQuoteRequestRecord(rfq);
  }

  async update(
    id: string,
    patch: AdminPatchQuoteRequest,
    options: AggregateCommandOptions = {},
  ): Promise<QuoteRequestRecord> {
    const body = adminPatchQuoteRequestSchema.parse(patch);
    const write = await this.#options(options);
    const admin = this.deps.admin();
    const rfq = await admin.runWrite(
      makeModifyQuoteRequestCommand(admin.commandDeps, { ...write, quoteRequestId: id, body }),
      { notifies: true },
    );
    return toQuoteRequestRecord(rfq);
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<QuoteRequestRecord> {
    const write = await this.#options(options);
    const admin = this.deps.admin();
    const rfq = await admin.runWrite(
      makeSetQuoteRequestCustomFieldValuesCommand({
        ...write,
        quoteRequestId: id,
        merge,
        salesRepAssignment: admin.commandDeps.salesRepAssignment,
      }),
      { notifies: false },
    );
    return toQuoteRequestRecord(rfq);
  }

  async assign(
    id: string,
    input: { adminUserId: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<QuoteRequestRecord> {
    const { adminUserId } = assignInputSchema.parse(input);
    const write = await this.#options(options);
    const admin = this.deps.admin();
    const rfq = await admin.runWrite(
      makeAssignQuoteRequestCommand(admin.commandDeps, { ...write, quoteRequestId: id, adminUserId }),
      { notifies: false },
    );
    return toQuoteRequestRecord(rfq);
  }

  async approve(
    id: string,
    input: AdminApproveQuoteRequest,
    options: AggregateCommandOptions = {},
  ): Promise<QuoteRequestRecord> {
    const { note } = adminApproveQuoteRequestSchema.parse(input ?? {});
    const write = await this.#options(options);
    const admin = this.deps.admin();
    const rfq = await admin.runWrite(
      makeApproveQuoteRequestCommand(admin.commandDeps, { ...write, quoteRequestId: id, note }),
      { notifies: true },
    );
    return toQuoteRequestRecord(rfq);
  }

  async cancel(
    id: string,
    input: { reason: string | null },
    options: AggregateCommandOptions = {},
  ): Promise<QuoteRequestRecord> {
    const { reason } = adminCancelQuoteRequestSchema.parse({ reason: input?.reason ?? undefined });
    const write = await this.#options(options);
    const admin = this.deps.admin();
    const rfq = await admin.runWrite(
      makeCancelQuoteRequestCommand(admin.commandDeps, { ...write, quoteRequestId: id, reason }),
      { notifies: true },
    );
    return toQuoteRequestRecord(rfq);
  }

  async sendDocument(
    id: string,
    input: QuoteRequestPdfSendRequest,
    options: AggregateCommandOptions = {},
  ): Promise<QuoteRequestPdfSendResult> {
    const body = quoteRequestPdfSendRequestSchema.parse(input);
    // Sending never touches the offer: no version to compare.
    const { operator, source, extensions } = await this.#options(options);
    return this.deps.documents().send(operator, id, body, { source, extensions });
  }

  /**
   * The options as the Commands take them, with the ambient operator. An
   * invalid `source` is refused before anything is read or written.
   */
  async #options(options: AggregateCommandOptions): Promise<{
    operator: QuoteRequestOperator;
    expectedVersion: number | null;
    source: string | undefined;
    extensions: Readonly<Record<string, unknown>> | undefined;
  }> {
    if (options.source !== undefined && !aggregateCommandSourceSchema.safeParse(options.source).success) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'source must be a lower-case code of at most 64 characters.',
        [{ path: 'source', issue: 'invalid_format' }],
      );
    }
    return {
      operator: await this.deps.operator(),
      expectedVersion: options.expectedVersion ?? null,
      source: options.source,
      extensions: options.extensions,
    };
  }
}
