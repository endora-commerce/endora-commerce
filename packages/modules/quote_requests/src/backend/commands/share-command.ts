import { LockMode } from '@mikro-orm/core';
import {
  ERROR_CODES,
  QUOTE_REQUEST_HOOKABLE_ACTIONS,
  type CustomerAccountReadPort,
  type QuoteRequestShareHookData,
  type SalesRepAssignmentPort,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { adminCanSeeOrganization, isPlatformWideScope } from '../services/admin-org-visibility.js';
import { loadArrangedQuoteLines } from '../services/line-order.js';
import {
  applyShare,
  customerUnavailability,
  customerUnavailableError,
  unpricedLinesRefusal,
  type ApplyShareDeps,
} from '../services/operator-quote-sharing.js';

/**
 * `quote_request.share` — an operator shares an unshared quote with its
 * customer (`specs/192-quote-request-draft-share/`, research R-4;
 * `contracts/admin-api.md` §1; `contracts/share-hook.md`).
 *
 * A Command on the bus, so the share is audited by the bus (Principle XIII)
 * and is the point other modules refuse a share at: the action is declared
 * hookable (`beforeCommit`), and every present hook runs after `run`, inside
 * this transaction, on the row already written shared. A hook's refusal rolls
 * back the row, the `shared` entry and the `prepared` records together, so
 * the quote stays unshared and nobody is told (FR-028).
 *
 * Not reversible: a share sends e-mail, which no undo can recall.
 *
 * The checks run in the contract's order and each refusal writes nothing:
 * visibility → already shared → status → version → unpriced lines →
 * customer. The row is read `for update`, so concurrent shares serialise and
 * the second reads it shared (FR-024, R-6).
 */

export interface ShareCommandDeps extends ApplyShareDeps {
  readonly salesRepScope: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  /** Whether the ambient scope reaches every organisation. Injectable for the unit test only. */
  readonly isPlatformAdmin?: () => boolean;
  /** The share's moment. Injectable for the unit test only. */
  readonly now?: () => Date;
}

export interface ShareQuoteRequestInput {
  readonly quoteRequestId: string;
  /** `If-Match`, when the caller sent one. */
  readonly expectedVersion: number | null;
  /** Recorded on the `shared` entry as the actor's role, as every admin entry is. */
  readonly roleLabel: string | null;
}

export interface ShareQuoteRequestResult {
  readonly quote: QuoteRequest;
}

const notFound = (): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');

export function makeShareQuoteRequestCommand(
  input: ShareQuoteRequestInput,
  deps: ShareCommandDeps,
): Command<ShareQuoteRequestResult> {
  return {
    action: QUOTE_REQUEST_HOOKABLE_ACTIONS.share.action,
    objectType: QUOTE_REQUEST_HOOKABLE_ACTIONS.share.objectType,
    objectId: input.quoteRequestId,
    run: async ({ em, actor }) => {
      if (!isUuidShape(input.quoteRequestId)) throw notFound();
      const quote = await em.findOne(QuoteRequest, { id: input.quoteRequestId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      if (!quote) throw notFound();
      // A quote of an organisation the caller may not see answers as an unknown one.
      const reach = await adminCanSeeOrganization(
        deps.salesRepScope,
        actor.actorAdminUserId,
        quote.organizationId,
        deps.isPlatformAdmin ?? isPlatformWideScope,
      );
      if (!reach) throw notFound();
      if (quote.sharedWithCustomer) {
        throw new HttpError(409, ERROR_CODES.RFQ_ALREADY_SHARED, 'Quote Request is already shared with its customer.');
      }
      if (quote.status !== 'Created from admin') {
        throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request cannot be shared in its current state.');
      }
      if (input.expectedVersion !== null && quote.version !== input.expectedVersion) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
      }
      const unpriced = unpricedLinesRefusal(await loadArrangedQuoteLines(em, quote.id));
      if (unpriced) throw unpriced;
      const unavailable = customerUnavailability(
        await deps.customerAccounts.findById(quote.customerAccountId),
        quote.organizationId,
      );
      if (unavailable) throw customerUnavailableError(unavailable);

      const before = {
        sharedWithCustomer: false,
        expiresAt: quote.expiresAt?.toISOString() ?? null,
        version: quote.version,
      };
      await applyShare(
        em,
        quote,
        { adminUserId: actor.actorAdminUserId, roleLabel: input.roleLabel },
        (deps.now ?? (() => new Date()))(),
        deps,
      );
      await em.flush();
      return {
        result: { quote },
        // `specs/conventions/audit-state.md` list 1: a boolean, a date, a count.
        before,
        after: { sharedWithCustomer: true, expiresAt: quote.expiresAt?.toISOString() ?? null, version: quote.version },
      };
    },
    hookData: ({ quote }): QuoteRequestShareHookData => ({
      quoteRequestId: quote.id,
      organizationId: quote.organizationId,
      customerAccountId: quote.customerAccountId,
      salesChannelId: quote.salesChannelId ?? null,
      currentRevisionNumber: quote.currentRevisionNumber,
      expiresAt: quote.expiresAt?.toISOString() ?? null,
    }),
  };
}
