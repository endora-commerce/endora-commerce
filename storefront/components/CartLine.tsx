import type { ReactNode } from 'react';
import type { DisplayMode } from '@endora-commerce/contracts';
import { moneyByMode } from '../lib/i18n/money';
import { tForLocale } from '../lib/i18n/messages';
import {
  belowMinimumText,
  cartLineFixQuantity,
  cartLineFloor,
  type CartLineBelowMinimum,
  type CartLineEditError,
} from '../lib/cartMinimum';
import { formatCount } from '../lib/orderMinimum';
import { LocalizedAnchor } from '../lib/i18n/localized-link';

/**
 * CartLine — Industria-themed cart row (feature 027 US1).
 *
 * Matches the layout from
 * `specs/b2b-platform-storefront-ui/project/industria-views-checkout.jsx`
 * (checkout step 0 — the cart): a 6-column grid
 *   [media | name+sku | qty stepper | unit price | line total | remove]
 * with a per-line `<form>` for each mutation so SSR / no-JS still works.
 *
 * The 500 ms auto-save debounce on the qty input is browser-side state
 * the parent page wires; the SSR shell ships a small "↻" submit button.
 */

export interface CartLineViewModel {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
  unavailable?: boolean;
  unavailableReason?: 'out_of_stock' | 'not_purchasable' | 'no_price_in_customer_list' | null;
  /** Resolved + display-ready name; the parent looked it up. */
  productName: string;
  /** Optional SKU surfaced above the name. */
  sku?: string | null;
  /** Optional PDP slug — when set the name links back to the product card. */
  productSlug?: string | null;
  /** Feature 043 — set when the line was added as a packaging unit. */
  packagingUnitName?: string | null;
  /** Feature 155 — the product's current pieces minimum (`null` = none). */
  minOrderQuantity?: number | null;
  /** Feature 155 — the server's verdict: this line is below a minimum and not exempt. */
  belowMinimum?: CartLineBelowMinimum | null;
}

interface CartLineProps {
  line: CartLineViewModel;
  updateAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
  saveToListAction: (formData: FormData) => Promise<void>;
  /** Active Sales Channel display locale (e.g. `pl-PL`). */
  locale?: string;
  /** Settings-resolved price display mode — drives net/gross rendering so the
   *  cart matches the PDP and product cards. Defaults to `net_only`. */
  displayMode?: DisplayMode;
  /**
   * U4 — the server refused this line's last quantity edit: its sentence (in the request's
   * language) shown beside the field, and the value the buyer typed kept in it.
   */
  editError?: CartLineEditError | null;
  /**
   * `specs/170-organization-roles/` (FR-030, FR-057) — `false` for a signed-in member whose role
   * lacks `carts.create`: the quantity is shown as text and no line can be changed or removed.
   * The page states why once, above the lines. Defaults to `true` (a guest always edits, PR-4).
   */
  editable?: boolean;
  /** FR-047 — `false` for a member whose role lacks `shopping_lists.create`. Defaults to `true`. */
  canSaveToList?: boolean;
  strings: {
    qtyLabel: string;
    unitPriceLabel: string;
    lineTotalLabel: string;
    removeLabel: string;
    saveToListLabel: string;
    updateLabel?: string;
    netSuffix: string;
    grossSuffix: string;
    unavailable: {
      out_of_stock: string;
      not_purchasable: string;
      no_price_in_customer_list: string;
    };
  };
}

export function CartLine({
  line,
  updateAction,
  removeAction,
  saveToListAction,
  locale,
  displayMode = 'net_only',
  editError = null,
  editable = true,
  canSaveToList = true,
  strings,
}: CartLineProps): ReactNode {
  const suffixFor = (kind: 'net' | 'gross' | null): string =>
    kind === 'net' ? strings.netSuffix : kind === 'gross' ? strings.grossSuffix : '';
  // `unitPrice`: the line's unit price, shown with its significant places, up to
  // four; the line total is an amount and shows two (owner ruling of 2026-10-25).
  const renderPrice = (m: { amount: number; currency: string }, unitPrice = false): ReactNode => {
    const priced = moneyByMode(m, displayMode, locale, undefined, { unitPrice });
    return (
      <>
        <span>
          {priced.primary}
          {priced.primaryKind ? (
            <span className="ml-[3px] text-[10px] font-normal text-muted">{suffixFor(priced.primaryKind)}</span>
          ) : null}
        </span>
        {priced.secondary ? (
          <span className="block text-[11px] font-normal text-muted">
            {priced.secondary}
            <span className="ml-[3px] text-[10px]">{suffixFor(priced.secondaryKind)}</span>
          </span>
        ) : null}
      </>
    );
  };
  const unavailableLabel =
    line.unavailable && line.unavailableReason
      ? strings.unavailable[line.unavailableReason]
      : null;
  const activeLocale = locale ?? 'en-US';
  // Feature 155 (FR-037) — the product record is gone: nothing about the line can be
  // changed or kept, so the only action left is to remove it.
  const gone = line.unavailable === true && line.unavailableReason === 'not_purchasable';
  // Feature 155 (FR-013) — the server's below-minimum verdict, worded beside the name.
  const belowText = gone ? null : belowMinimumText(line, activeLocale);
  const belowId = `cart-line-${line.id}-minimum`;
  const floor = cartLineFloor(line);
  const fixQuantity = gone ? null : cartLineFixQuantity(line);
  // U4 — the product's minimum, stated under the stepper so a disabled "−" at the floor says
  // why. The product's minimum, not the floor: a quote-exempt line floors at its own quantity.
  const minimumHint =
    typeof line.minOrderQuantity === 'number' && line.minOrderQuantity > 1
      ? tForLocale(activeLocale)('cart.line.minimumHint').replace(
          '{count}',
          formatCount(line.minOrderQuantity, activeLocale),
        )
      : null;
  const floorId = `cart-line-${line.id}-floor`;
  const qtyErrorId = `cart-line-${line.id}-qty-error`;
  const inputDescribedBy = [editError ? qtyErrorId : null, belowText ? belowId : null]
    .filter((id): id is string => id !== null)
    .join(' ');
  const minusDisabled = line.quantity <= floor;
  return (
    <div
      className={`cart-line grid grid-cols-[56px_1fr_130px_110px_130px_28px] items-center gap-[14px] border-b border-line px-[22px] py-[14px] last:border-b-0${
        line.unavailable ? ' opacity-60' : ''
      }`}
    >
      <div
        className="grid h-[56px] w-[56px] place-items-center rounded-sm bg-surface-alt text-line-strong [&_svg]:h-[60%] [&_svg]:w-[60%] max-[720px]:[grid-area:media]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 6V4h8v2" />
        </svg>
      </div>

      <div className="flex min-w-0 flex-col gap-[2px] max-[720px]:[grid-area:body]">
        {line.sku ? (
          <span className="truncate font-mono text-[11px] uppercase text-muted">{line.sku}</span>
        ) : null}
        {line.productSlug ? (
          <LocalizedAnchor
            href={`/p/${encodeURIComponent(line.productSlug)}`}
            className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-fg no-underline hover:underline"
          >
            {line.productName}
          </LocalizedAnchor>
        ) : (
          <span className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-fg">
            {line.productName}
          </span>
        )}
        {unavailableLabel ? (
          <span className={`mt-[2px] text-[11px] ${gone ? 'font-semibold text-bad' : 'text-muted'}`}>
            {unavailableLabel}
          </span>
        ) : null}
        {belowText ? (
          <div className="mt-[2px] flex flex-wrap items-center gap-x-2 gap-y-1">
            <span id={belowId} className="inline-flex items-center gap-1 text-[12px] font-semibold text-warn">
              <svg
                viewBox="0 0 24 24"
                width={13}
                height={13}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              {belowText}
            </span>
            {fixQuantity !== null && editable ? (
              // Its own form: the stepper's input holds a value below its `min`, and a form
              // with an invalid control refuses every native submit.
              <form action={updateAction}>
                <input type="hidden" name="itemId" value={line.id} />
                <button
                  type="submit"
                  name="quantity"
                  value={fixQuantity}
                  formNoValidate
                  aria-describedby={belowId}
                  className="cursor-pointer rounded-sm border border-line bg-surface px-[8px] py-[2px] text-[12px] font-medium text-fg hover:border-line-strong hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[720px]:min-h-[44px]"
                >
                  {tForLocale(activeLocale)('cart.line.setToMinimum').replace(
                    '{count}',
                    String(fixQuantity),
                  )}
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
        {gone || !editable ? null : (
          // U4 — the refused edit's sentence. Mounted empty on every line so the polite live
          // region exists before it carries text (WCAG 4.1.3); the input points at it.
          <p id={qtyErrorId} role="status" className="m-0 text-[12px] font-semibold text-bad">
            {editError?.message ?? ''}
          </p>
        )}
        {gone || !canSaveToList ? null : (
          <form action={saveToListAction} className="mt-1">
            <input type="hidden" name="itemId" value={line.id} />
            <button
              type="submit"
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted underline underline-offset-2"
            >
              {strings.saveToListLabel}
            </button>
          </form>
        )}
      </div>

      {gone ? (
        <span className="max-[720px]:[grid-area:stepper]" aria-hidden="true" />
      ) : !editable ? (
        // A read-only line still says how many it holds: the number, without a control.
        <span className="font-mono text-[13px] text-fg max-[720px]:[grid-area:stepper]">
          <span className="sr-only">{strings.qtyLabel}: </span>
          {line.quantity}
        </span>
      ) : (
        // `noValidate`: the browser's own `min` bubble speaks the browser's language and refuses
        // the 0 that removes the line (FR-007). The server action validates and the buyer reads
        // our sentence beside the field instead (U4).
        <form action={updateAction} noValidate className="max-[720px]:[grid-area:stepper]">
          <input type="hidden" name="itemId" value={line.id} />
          {/* The form's default button: Enter in the quantity input submits the first
              submit button in tree order. Nameless, so the typed `quantity` is what
              posts; without it Enter pressed "−" (a step down, or nothing at the floor). */}
          <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
            {strings.qtyLabel}
          </button>
          <div className="qty__stepper" role="group" aria-label={strings.qtyLabel}>
            {/* The steppers post `step`, not `quantity`: the input posts `quantity` too and
                sits between them, so the first `quantity` in the form data would be the
                input's for "+" (a no-op, or a refusal on a line below its minimum). */}
            <button
              type="submit"
              name="step"
              value={Math.max(floor, line.quantity - 1)}
              disabled={minusDisabled}
              formNoValidate
              aria-label="−"
              title="−"
              {...(minusDisabled && minimumHint ? { 'aria-describedby': floorId } : {})}
            >
              −
            </button>
            <input
              type="number"
              name="quantity"
              min={floor}
              defaultValue={editError?.typed ?? line.quantity}
              aria-label={strings.qtyLabel}
              {...(belowText || editError ? { 'aria-invalid': true } : {})}
              {...(inputDescribedBy ? { 'aria-describedby': inputDescribedBy } : {})}
            />
            <button
              type="submit"
              name="step"
              value={Math.max(line.quantity + 1, floor)}
              formNoValidate
              aria-label="+"
              title="+"
            >
              +
            </button>
          </div>
          {minimumHint ? (
            <p id={floorId} className="m-0 mt-1 text-[11px] text-muted">{minimumHint}</p>
          ) : null}
        </form>
      )}

      <span
        className="text-right font-mono text-[13px] text-fg-soft max-[720px]:[grid-area:unit]"
        aria-label={strings.unitPriceLabel}
      >
        {renderPrice(line.unitPrice, true)}
      </span>

      <span
        className="text-right font-mono text-[14px] font-semibold text-fg max-[720px]:[grid-area:total]"
        aria-label={strings.lineTotalLabel}
      >
        {renderPrice(line.lineTotal)}
      </span>

      {editable ? (
        <form action={removeAction} className="max-[720px]:justify-self-start max-[720px]:[grid-area:actions]">
          <input type="hidden" name="itemId" value={line.id} />
          <button
            type="submit"
            className="grid h-[28px] w-[28px] cursor-pointer place-items-center rounded-sm border border-transparent bg-transparent text-muted transition hover:bg-surface-alt hover:text-bad"
            aria-label={strings.removeLabel}
            title={strings.removeLabel}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </form>
      ) : (
        <span className="max-[720px]:[grid-area:actions]" aria-hidden="true" />
      )}
    </div>
  );
}
