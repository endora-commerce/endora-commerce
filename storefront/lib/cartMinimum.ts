import { tForLocale } from './i18n/messages';
import { BELOW_MINIMUM_CODES, CART_ERRORS } from './commerce-errors';
import { formatCount } from './orderMinimum';
import { readCount } from './url-typed-values';

/**
 * Feature 155 — the cart's and checkout's reading of the server's order-minimum verdicts
 * (FR-013, FR-037; `contracts/cart-and-checkout-api.md` §3, §8).
 *
 * The server judges; these helpers only word its verdict and keep the interface from offering
 * a step it would refuse. Pure and React-free, so the storefront's node-only tests can assert
 * them and the cart line, the cart page and the checkout page share one answer.
 */

/** The cart view's `belowMinimum` (§3): set when the line is below a minimum and not exempt. */
export interface CartLineBelowMinimum {
  kind: 'pieces' | 'packaging_unit';
  minimum: number;
  packagingUnitName?: string | undefined;
}

/** The cart-view line fields these helpers read. */
export interface CartLineMinimumFields {
  quantity: number;
  /** The product's current pieces minimum; `null`/absent = none. */
  minOrderQuantity?: number | null | undefined;
  belowMinimum?: CartLineBelowMinimum | null | undefined;
  unavailable?: boolean | undefined;
}

/** The checkout preview's `belowMinimumLines` entry (§8). */
export interface CheckoutBelowMinimumLine {
  cartItemId: string;
  productId: string;
  productName?: string | undefined;
  kind: 'pieces' | 'packaging_unit' | 'product_unavailable';
  minimum?: number | undefined;
  packagingUnitName?: string | undefined;
}

/** "Below the minimum (10 pcs)" / "(2 × Pallet)" for one verdict. */
function verdictText(below: CartLineBelowMinimum, locale: string): string {
  const t = tForLocale(locale);
  if (below.kind === 'pieces') {
    return t('order.minimum.below.pieces').replace('{count}', formatCount(below.minimum, locale));
  }
  const unitName = below.packagingUnitName;
  if (unitName === undefined || unitName === '') {
    return t('order.minimum.below.unitsUnnamed').replace('{units}', formatCount(below.minimum, locale));
  }
  return (
    t('order.minimum.below.units')
      .replace('{units}', formatCount(below.minimum, locale))
      // The operator-authored name goes in last, so a brace in it is never read as a placeholder.
      .replace('{unit}', () => unitName)
  );
}

/** The sentence a cart line below a minimum carries, or `null` when it is not below one. */
export function belowMinimumText(
  line: { belowMinimum?: CartLineBelowMinimum | null | undefined },
  locale: string,
): string | null {
  return line.belowMinimum ? verdictText(line.belowMinimum, locale) : null;
}

/**
 * The lowest quantity the cart line's input offers.
 *
 * A line the server flags below the pieces minimum floors at that minimum. Any other line
 * floors at the minimum **but never above its own quantity**: the server may hold a line
 * under the minimum without flagging it — a quote line still at its negotiated quantity
 * (FR-028), or one variant of a product whose total across lines meets the minimum — and a
 * floor above it would make the browser refuse every edit of that line, including setting it
 * back to the quote's quantity.
 */
export function cartLineFloor(line: CartLineMinimumFields): number {
  const minimum =
    typeof line.minOrderQuantity === 'number' && line.minOrderQuantity > 1 ? Math.floor(line.minOrderQuantity) : 1;
  if (line.belowMinimum?.kind === 'pieces') return Math.max(minimum, line.belowMinimum.minimum, 1);
  return Math.max(1, Math.min(minimum, line.quantity));
}

/**
 * The one-step fix a line below the pieces minimum offers ("Set to 10 pcs"), or `null`.
 * Offered only for a pieces verdict on a single-piece line: a packaging line's quantity
 * counts pieces of a unit, and its fix is the buyer's choice of how many units.
 */
export function cartLineFixQuantity(line: CartLineMinimumFields & { packagingUnitName?: string | null }): number | null {
  if (line.belowMinimum?.kind !== 'pieces' || line.packagingUnitName) return null;
  return line.belowMinimum.minimum > line.quantity ? line.belowMinimum.minimum : null;
}

/** Whether the cart may go on to checkout: not while any line is below a minimum or gone. */
export function cartBlocksCheckout(view: {
  items: ReadonlyArray<{
    unavailable?: boolean | undefined;
    unavailableReason?: string | null | undefined;
    belowMinimum?: CartLineBelowMinimum | null | undefined;
  }>;
}): boolean {
  return view.items.some((item) => item.unavailable === true || (item.belowMinimum ?? null) !== null);
}

/**
 * Whether the checkout preview allows placing the order. A preview that could not be read
 * (`null`) does not block: the preview is advisory and placement binds (contract §8).
 */
export function canPlaceOrder(
  preview: { belowMinimumLines?: ReadonlyArray<CheckoutBelowMinimumLine> | undefined } | null,
): boolean {
  return (preview?.belowMinimumLines?.length ?? 0) === 0;
}

/**
 * A cart line's name for the buyer — the packaging-qualified display name, the product name,
 * the SKU — and never a raw id: a line whose product record is gone (FR-037) has none of the
 * first three, and a UUID is not a name.
 */
export function cartLineDisplayName(
  item: { displayName?: string | null; productName?: string | null; productSku?: string | null; productId?: string },
  locale: string,
): string {
  return item.displayName || item.productName || item.productSku || tForLocale(locale)('cart.line.unknownProduct');
}

/** One row of the checkout's "cannot be ordered yet" summary. */
export interface CheckoutBelowMinimumRow {
  cartItemId: string;
  name: string;
  reasons: string[];
}

/**
 * The checkout summary rows: one per cart line, in the preview's order. A line breaking two
 * minima appears twice in the preview (§8) and once here, with both reasons; a
 * `product_unavailable` line is named by the cart's own line name, "no longer available".
 */
export function checkoutBelowMinimumRows(
  lines: ReadonlyArray<CheckoutBelowMinimumLine>,
  cartItems: ReadonlyArray<{
    id: string;
    displayName?: string | null;
    productName?: string | null;
    productSku?: string | null;
  }>,
  locale: string,
): CheckoutBelowMinimumRow[] {
  const t = tForLocale(locale);
  const itemsById = new Map(cartItems.map((item) => [item.id, item]));
  const rows = new Map<string, CheckoutBelowMinimumRow>();
  for (const line of lines) {
    const item = itemsById.get(line.cartItemId);
    let reason: string;
    if (line.kind === 'product_unavailable') {
      reason = t('cart.line.noLongerAvailable');
    } else if (line.minimum === undefined) {
      reason = t('order.minimum.below.bare');
    } else {
      reason = verdictText(
        { kind: line.kind, minimum: line.minimum, packagingUnitName: line.packagingUnitName },
        locale,
      );
    }
    const existing = rows.get(line.cartItemId);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      continue;
    }
    const name =
      item !== undefined
        ? cartLineDisplayName(item, locale)
        : line.kind !== 'product_unavailable' && line.productName
          ? line.productName
          : t('cart.line.unknownProduct');
    rows.set(line.cartItemId, { cartItemId: line.cartItemId, name, reasons: [reason] });
  }
  return [...rows.values()];
}

/** What a cart line's quantity form asks for. */
export type CartQuantityEdit = { kind: 'remove' } | { kind: 'set'; quantity: number } | { kind: 'invalid' };

/**
 * Reads the cart line's quantity form: a stepper's `step` first, else the typed `quantity`.
 *
 * The form is `noValidate` (the browser's own bubble speaks the browser's language and refused
 * the 0 that removes a line), so this is the validation: `0` removes the line (FR-007), a whole
 * number sets it, and anything else — including an empty field, which `Number('')` would read
 * as 0 and so delete the line — is invalid.
 */
export function parseCartQuantityEdit(fields: {
  step?: string | null | undefined;
  quantity?: string | null | undefined;
}): CartQuantityEdit {
  const raw = (fields.step ?? fields.quantity ?? '').trim();
  if (!/^\d+$/.test(raw)) return { kind: 'invalid' };
  const quantity = Number(raw);
  if (!Number.isSafeInteger(quantity)) return { kind: 'invalid' };
  return quantity === 0 ? { kind: 'remove' } : { kind: 'set', quantity };
}

/** A refused quantity edit, shown beside the line's field rather than at the top of the page. */
export interface CartLineEditError {
  message: string;
  /** What the buyer typed, kept in the field so the message and the value agree. */
  typed: string | null;
}

/**
 * The cart URL that reports a refused edit of one line (issue #745: a code, never a sentence).
 * A minimum refusal also carries the minimum, a whole number, so the line can say it.
 */
export function cartLineEditErrorHref(
  itemId: string,
  code: string,
  typed: string | null,
  minimum: number | null = null,
): string {
  const qs = new URLSearchParams({ errorItem: itemId, error: code });
  if (minimum !== null && Number.isSafeInteger(minimum) && minimum > 0) qs.set('min', String(minimum));
  if (typed !== null && typed !== '') qs.set('typed', typed);
  return `/cart?${qs.toString()}`;
}

/** The minimum a refusal's `details` carried, when it is a positive whole number. */
export function refusalMinimum(details: unknown): number | null {
  if (details === null || typeof details !== 'object') return null;
  const minimum = (details as { minimum?: unknown }).minimum;
  return typeof minimum === 'number' && Number.isSafeInteger(minimum) && minimum > 0 ? minimum : null;
}

/**
 * The refused edit the cart URL reports for this line, or `null`. The sentence is the page's:
 * a minimum refusal reads the carried minimum (digits only) against the line's own packaging
 * unit, and any other code reads through {@link CART_ERRORS} — a code it does not know as the
 * cart's generic failure.
 */
export function cartLineEditError(
  params: { errorItem?: string | undefined; error?: string | undefined; typed?: string | undefined; min?: string | undefined },
  line: { id: string; packagingUnitName?: string | null | undefined },
  locale: string,
): CartLineEditError | null {
  if (params.errorItem !== line.id || !params.error) return null;
  const t = tForLocale(locale);
  let message: string;
  if (BELOW_MINIMUM_CODES.has(params.error)) {
    const minimum = readCount(params.min);
    message =
      minimum === null
        ? t('order.minimum.below.bare')
        : verdictText(
            {
              kind: params.error === 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY' ? 'packaging_unit' : 'pieces',
              minimum,
              packagingUnitName: line.packagingUnitName ?? undefined,
            },
            locale,
          );
  } else {
    message = t(CART_ERRORS.errorKey(params.error)!);
  }
  // Issue #790 — what the buyer typed is read only as a whole quantity, the `min=` rule from #783;
  // anything else in the address is ignored and the field shows the line's quantity.
  return { message, typed: readCount(params.typed) !== null ? params.typed! : null };
}
