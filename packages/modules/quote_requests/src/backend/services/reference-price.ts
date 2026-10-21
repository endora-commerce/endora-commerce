import { ERROR_CODES, type BuyerLinePricePort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/**
 * Feature 146 — the reference price a quote line stores at a customer write
 * (FR-001, FR-008; `specs/146-quote-request-pricing-history/research.md` R2,
 * R3).
 *
 * The reference is what the request's **owner** would pay for the line on a
 * normal order, on the channel the request was raised on, at that moment —
 * asked of `price_lists` through `buyerLinePricePort`. It is never taken from
 * the client. The one exception is a reference an in-process caller already
 * holds as a server-side snapshot (`carts`' conversion, whose cart line price is
 * the reference), passed as `supplied` and used verbatim.
 */

/** A stored reference: a 2-dp decimal string and an ISO 4217 code. */
export interface LineReference {
  amount: string;
  currency: string;
}

/** The part of a quote line the reference is resolved for. */
export interface ReferencePriceLine {
  productId: string;
  variantId?: string | null | undefined;
  /** In base pieces — the unit every quote line's quantity is in. */
  quantity: number;
}

export interface ReferencePriceRequest {
  /** The request's owner — never the acting user (spec Assumptions). */
  owner: { customerAccountId: string; organizationId: string };
  /** The channel the request was raised on; `null` = the system default. */
  salesChannelId: string | null;
  lines: readonly ReferencePriceLine[];
  /** Index-aligned with `lines`; a non-`null` entry is used as is and not resolved. */
  supplied?: ReadonlyArray<LineReference | null>;
  /**
   * Feature 160 — the currency the request is priced in. A quote request carries
   * no currency of its own today (issue #303's quote-line half), so callers
   * omit it and the reference is in the channel's default currency, which is the
   * request's currency.
   */
  currencyCode?: string;
}

/**
 * How many lines one port call carries (threat model T11). An in-process
 * caller — cart conversion, quick order, a shopping list — is not bound by the
 * HTTP schema's 200-line cap, so a large request becomes several bounded
 * queries rather than one unbounded `IN` list.
 */
export const REFERENCE_PRICE_CHUNK_SIZE = 100;

/**
 * One reference per line, index-aligned with `request.lines`; `null` = no
 * stored reference (the read side then shows the current price, FR-006).
 *
 * A port answer of `price: null` is "no price" for that line. A **thrown**
 * error — a pricing read that failed, an unknown channel — is tolerated: the
 * resolved lines get no reference and the customer's write proceeds, because
 * the reference is informational (spec Assumptions; research R2). That one
 * `catch` re-throws `ModuleDisabledError` first: a switched-off owner is about
 * the whole operation, and absorbing it would turn fail-closed into fail-open
 * (composition rule 7, `check:port-catches`).
 *
 * The query carries the line's `quantity` and nothing else about its unit — a
 * packaging unit's base quantity never enters it (threat model T6): a quote
 * line's quantity is already in base pieces.
 */
export async function resolveReferencePrices(
  port: BuyerLinePricePort,
  request: ReferencePriceRequest,
): Promise<Array<LineReference | null>> {
  const out: Array<LineReference | null> = request.lines.map((_, index) => {
    const supplied = request.supplied?.[index];
    return supplied ? { amount: supplied.amount, currency: supplied.currency } : null;
  });
  const toResolve = request.lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => !request.supplied?.[index]);
  if (toResolve.length === 0) return out;

  const resolved = new Map<number, LineReference>();
  try {
    for (let start = 0; start < toResolve.length; start += REFERENCE_PRICE_CHUNK_SIZE) {
      const chunk = toResolve.slice(start, start + REFERENCE_PRICE_CHUNK_SIZE);
      const answers = await port.resolveForBuyer({
        buyer: {
          customerAccountId: request.owner.customerAccountId,
          organizationId: request.owner.organizationId,
        },
        salesChannelId: request.salesChannelId,
        ...(request.currencyCode ? { currencyCode: request.currencyCode } : {}),
        lines: chunk.map(({ line, index }) => ({
          key: String(index),
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
        })),
      });
      for (const answer of answers) {
        if (!answer.price) continue;
        const amount = Number(answer.price.amount);
        if (!Number.isFinite(amount) || amount < 0) continue;
        // What `numeric(12,2)` holds, checked on the stored text: a larger
        // amount would fail the insert. Such a line stores no reference
        // (research R2) rather than failing the customer's request.
        const stored = amount.toFixed(2);
        if (!AMOUNT_PATTERN.test(stored)) continue;
        resolved.set(Number(answer.key), {
          amount: stored,
          currency: answer.price.currency,
        });
      }
    }
  } catch (error) {
    // Research R2: the reference is informational, so a pricing failure must
    // not block the customer's request — it is stored with no reference, and
    // the admin screen falls back to the current price (FR-006). Not for a
    // switched-off owner, which is the operation's answer, not this line's.
    rethrowIfModuleDisabled(error);
    return out;
  }
  for (const [index, reference] of resolved) out[index] = reference;
  return out;
}

/** At most ten integer digits — what `numeric(12,2)` holds — and at most two decimals. */
const AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Threat model T6 — the in-process `lineReferencePrices` argument of
 * `createForCustomer`, checked before anything is written.
 *
 * Only a composed module can reach it (the HTTP body cannot), so a violation is
 * a programming error in that module, answered as one: a 500, not a 400 the
 * buyer could act on. It also keeps a value out of a `numeric(12,2)` column
 * that would otherwise fail half-way through the write.
 */
export function assertValidSuppliedReferences(
  supplied: ReadonlyArray<LineReference | null>,
  itemCount: number,
): void {
  const refuse = (detail: string): never => {
    throw new HttpError(
      500,
      ERROR_CODES.INTERNAL,
      `Invariant violated: lineReferencePrices ${detail}.`,
    );
  };
  if (supplied.length !== itemCount) {
    refuse(`has ${supplied.length} entries for ${itemCount} items`);
  }
  supplied.forEach((entry, index) => {
    if (entry === null) return;
    if (typeof entry.amount !== 'string' || !AMOUNT_PATTERN.test(entry.amount)) {
      refuse(`[${index}].amount is not a non-negative decimal with at most two decimals`);
    }
    if (!Number.isFinite(Number(entry.amount))) {
      refuse(`[${index}].amount is not finite`);
    }
    if (typeof entry.currency !== 'string' || !CURRENCY_PATTERN.test(entry.currency)) {
      refuse(`[${index}].currency is not a three-letter upper-case code`);
    }
  });
}

/** The three reference columns of a quote line. */
export interface ReferenceColumns {
  referenceUnitPrice: string | null;
  referenceCurrency: string | null;
  referenceCapturedAt: Date | null;
}

/**
 * The three reference columns of a quote line, all or none — the check
 * constraint `quote_request_items_reference_all_or_none` refuses anything else.
 */
export function referenceColumns(reference: LineReference | null, capturedAt: Date): ReferenceColumns {
  return reference
    ? {
        referenceUnitPrice: reference.amount,
        referenceCurrency: reference.currency,
        referenceCapturedAt: capturedAt,
      }
    : { referenceUnitPrice: null, referenceCurrency: null, referenceCapturedAt: null };
}

/**
 * A stored line's reference columns, carried verbatim to the row that replaces
 * it on a rewrite (research R5) — capture time included, so the reference still
 * says when it was taken.
 */
export function storedReferenceColumns(row: {
  referenceUnitPrice?: string | null;
  referenceCurrency?: string | null;
  referenceCapturedAt?: Date | null;
}): ReferenceColumns {
  return row.referenceUnitPrice != null && row.referenceCurrency != null && row.referenceCapturedAt != null
    ? {
        referenceUnitPrice: row.referenceUnitPrice,
        referenceCurrency: row.referenceCurrency,
        referenceCapturedAt: row.referenceCapturedAt,
      }
    : { referenceUnitPrice: null, referenceCurrency: null, referenceCapturedAt: null };
}
