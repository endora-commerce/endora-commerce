import { describe, expectTypeOf, it } from 'vitest';
import type { AggregateCommandOptions, CustomFieldMerge } from './aggregate-ports.js';
import type {
  AdminApproveQuoteRequest,
  AdminCreateQuoteRequest,
  AdminPatchQuoteRequest,
  QuoteRequestCommandPort,
  QuoteRequestPdfSendRequest,
  QuoteRequestPdfSendResult,
  QuoteRequestRecord,
  RfqCreatedByAdminEventPayload,
} from './quote-requests.js';

/**
 * Issue #1824 (`specs/186-aggregate-ports/` T063,
 * `contracts/quote-request-command-port.md`) — the QuoteRequest aggregate's
 * write port: seven methods, each taking the admin route's input and
 * {@link AggregateCommandOptions} last. No method is optional
 * (`check:port-shape`), and the buyer's own transitions are not on it.
 */
describe('QuoteRequestCommandPort', () => {
  it('publishes exactly the seven operator-side operations', () => {
    expectTypeOf<keyof QuoteRequestCommandPort>().toEqualTypeOf<
      'create' | 'update' | 'setCustomFieldValues' | 'assign' | 'approve' | 'cancel' | 'sendDocument'
    >();
  });

  it('takes the admin routes’ inputs and answers the record', () => {
    expectTypeOf<QuoteRequestCommandPort['create']>().toEqualTypeOf<
      (input: AdminCreateQuoteRequest, options?: AggregateCommandOptions) => Promise<QuoteRequestRecord>
    >();
    expectTypeOf<QuoteRequestCommandPort['update']>().toEqualTypeOf<
      (id: string, patch: AdminPatchQuoteRequest, options?: AggregateCommandOptions) => Promise<QuoteRequestRecord>
    >();
    expectTypeOf<QuoteRequestCommandPort['setCustomFieldValues']>().toEqualTypeOf<
      (id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions) => Promise<QuoteRequestRecord>
    >();
    expectTypeOf<QuoteRequestCommandPort['assign']>().toEqualTypeOf<
      (id: string, input: { adminUserId: string | null }, options?: AggregateCommandOptions) => Promise<QuoteRequestRecord>
    >();
    expectTypeOf<QuoteRequestCommandPort['approve']>().toEqualTypeOf<
      (id: string, input: AdminApproveQuoteRequest, options?: AggregateCommandOptions) => Promise<QuoteRequestRecord>
    >();
    expectTypeOf<QuoteRequestCommandPort['cancel']>().toEqualTypeOf<
      (id: string, input: { reason: string | null }, options?: AggregateCommandOptions) => Promise<QuoteRequestRecord>
    >();
    expectTypeOf<QuoteRequestCommandPort['sendDocument']>().toEqualTypeOf<
      (id: string, input: QuoteRequestPdfSendRequest, options?: AggregateCommandOptions) => Promise<QuoteRequestPdfSendResult>
    >();
  });

  it('names the administrator on rfq.created_by_admin.v1 only when one was present', () => {
    // A create through the port under `withSystemScope` has no administrator.
    expectTypeOf<RfqCreatedByAdminEventPayload['adminUserId']>().toEqualTypeOf<string | null>();
  });
});
