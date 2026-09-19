/**
 * The checkout's carrier-neutral `shippingAdapterData` seam.
 *
 * `placeOrder` accepts `shippingAdapterData?: Record<string, unknown>` (the free
 * contract, `packages/contracts/src/orders.ts`), and the free `orders` module
 * persists it on the order. What a *carrier* contributes to it is the carrier's
 * business — a parcel locker, a service point, a delivery window — so the free
 * storefront reads it by a field-name convention instead of by naming a vendor:
 *
 *     <input type="hidden" name="shippingAdapterData.targetPoint" … />
 *
 * Any `shippingAdapterData.<key>` field on the checkout form becomes `<key>` in
 * the payload. That is the seam a shipping renderer copied in from the paid
 * repository writes to (`specs/134-paid-module-extraction/`, ruling O-1(b)), and
 * it is the far side of `lib/shipping-renderers/registry.tsx`'s renderer key.
 *
 * `ensureShippingAdapterDataOnFormData` exists because a picker may render its
 * hidden input outside the `<form>` element — a map panel in a portal, say — so
 * React's `FormData` snapshot would not carry it. The DOM read is kept in one
 * three-line wrapper and the decisions are in `mergeShippingAdapterDataInputs`,
 * which is pure: this suite is SSR-only, with no jsdom.
 */

/** Field-name prefix a carrier renderer uses to contribute adapter data. */
export const SHIPPING_ADAPTER_DATA_PREFIX = 'shippingAdapterData.';

/** One `name`/`value` pair read off the checkout form's DOM. */
export interface ShippingAdapterDataInput {
  name: string;
  value: string;
}

/**
 * Copy adapter-data inputs onto FormData, without overwriting what the form
 * already submitted — the submitted value is the one the buyer saw.
 */
export function mergeShippingAdapterDataInputs(
  formData: FormData,
  inputs: readonly ShippingAdapterDataInput[],
): void {
  for (const input of inputs) {
    if (!input.name.startsWith(SHIPPING_ADAPTER_DATA_PREFIX)) continue;
    const value = input.value.trim();
    if (!value) continue;
    if (String(formData.get(input.name) ?? '').trim()) continue;
    formData.set(input.name, value);
  }
}

/**
 * Re-apply adapter-data inputs from the document before a Server Action runs.
 * A no-op on the server, where there is no document to read.
 */
export function ensureShippingAdapterDataOnFormData(formData: FormData): void {
  if (typeof document === 'undefined') return;
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement>(
      `input[name^="${SHIPPING_ADAPTER_DATA_PREFIX}"]`,
    ),
  ].map((input) => ({ name: input.name, value: input.value }));
  mergeShippingAdapterDataInputs(formData, inputs);
}

/** Extract the optional `shippingAdapterData` payload from checkout FormData. */
export function shippingAdapterDataFromFormData(
  formData: FormData,
): Record<string, unknown> | undefined {
  const data: Record<string, unknown> = {};
  for (const [field, raw] of formData.entries()) {
    if (!field.startsWith(SHIPPING_ADAPTER_DATA_PREFIX)) continue;
    const key = field.slice(SHIPPING_ADAPTER_DATA_PREFIX.length).trim();
    if (!key) continue;
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    data[key] = value;
  }
  return Object.keys(data).length > 0 ? data : undefined;
}
