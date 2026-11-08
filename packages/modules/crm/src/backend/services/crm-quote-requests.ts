import type { QuoteRequestReadPort, QuoteRequestRecord } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

/** A Quote Request as this module reads it: the record and what its owner says it is worth. */
export interface CrmQuoteRequestDocument {
  record: QuoteRequestRecord;
  /** Two places, net of tax — `quoteRequestReadPort.amountOf`'s figure (issue #456). */
  amount: string;
  /** The amount's currency — what the quote desk shows the total in — or `null` with no lines. */
  currency: string | null;
  /** `true` while not every line has an agreed price. */
  partiallyAgreed: boolean;
}

export interface CrmQuoteRequests {
  /** Whether `quote_requests` is effectively present. Ask before {@link CrmQuoteRequests.load}. */
  isPresent(): boolean;
  /**
   * The Quote Request as the caller may see it, or `null` — missing or out of
   * their scope. **Only while {@link CrmQuoteRequests.isPresent}**: with the
   * owner off the port's gate throws, and nothing here catches it.
   */
  load(id: string): Promise<CrmQuoteRequestDocument | null>;
  /**
   * The Quote Request alone, without its lines — what a reference to one shows
   * (`specs/163-projects-and-tasks/` FR-044). The same scope, the same
   * precondition as {@link CrmQuoteRequests.load}.
   */
  findRecord(id: string): Promise<QuoteRequestRecord | null>;
}

/**
 * Quote Requests, through `quote_requests`' own read port.
 *
 * That module is operator-switchable and this one only *degrades* without it
 * (the manifest's `degrades-without` edge): Opportunities and their Orders keep
 * working, a linked Quote Request renders as unavailable and adds nothing to a
 * computed value, and linking one is refused. So every caller **decides
 * presence first** — `isPresent()` — and chooses what absence means for it:
 * skip, or refuse. Nothing here, and nothing that calls this, catches a closed
 * gate as a signal.
 *
 * **What a Quote Request is worth** is `quote_requests`' to say
 * (`quoteRequestReadPort.amountOf`, issue #456): this module shows and counts
 * that figure, and values no line itself.
 *
 * A function rather than an object literal at the composition site, as the
 * notifier is and for its reason: `check:port-catches` follows the port through
 * the value.
 */
export function createCrmQuoteRequests(port: QuoteRequestReadPort): CrmQuoteRequests {
  return {
    isPresent: () => effectiveState.isPresent('quote_requests'),
    findRecord: (id: string) => port.findById(id),
    async load(id: string): Promise<CrmQuoteRequestDocument | null> {
      const record = await port.findById(id);
      if (!record) return null;
      const amount = await port.amountOf(record.id);
      if (!amount) return null;
      return { record, ...amount };
    },
  };
}
