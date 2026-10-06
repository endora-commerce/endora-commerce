import type { QuoteRequestReadPort, QuoteRequestRecord } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { quoteRequestAmount, type ValueQuoteRequestLine } from '../domain/value-calculation.js';

/** A Quote Request as this module reads it: the record, its lines as money, and what it is worth. */
export interface CrmQuoteRequestDocument {
  record: QuoteRequestRecord;
  lines: ValueQuoteRequestLine[];
  /** `Σ quantity × unit price` over the lines, two places. */
  amount: string;
  /** The currency of the first line — what the quote desk shows the total in — or `null` with no lines. */
  currency: string | null;
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
 * **What a line is valued at** is the agreed unit price, or the price the
 * customer asked for while none has been agreed — the two the quote desk shows
 * per line (`RfqDetail.tsx`), multiplied by the quantity and nothing else: the
 * desk does not multiply by the packaging unit's base quantity, so neither does
 * this. Quote prices are net of tax.
 *
 * A function rather than an object literal at the composition site, as the
 * notifier is and for its reason: `check:port-catches` follows the port through
 * the value.
 */
export function createCrmQuoteRequests(port: QuoteRequestReadPort): CrmQuoteRequests {
  return {
    isPresent: () => effectiveState.isPresent('quote_requests'),
    async load(id: string): Promise<CrmQuoteRequestDocument | null> {
      const record = await port.findById(id);
      if (!record) return null;
      const items = await port.listItems(record.id);
      const lines = items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.agreedUnitPrice ?? item.desiredUnitPrice,
        currency: item.lineCurrency,
      }));
      return {
        record,
        lines,
        amount: quoteRequestAmount(lines),
        currency: lines[0]?.currency ?? null,
      };
    },
  };
}
