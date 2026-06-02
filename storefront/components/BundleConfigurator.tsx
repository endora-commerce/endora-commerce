import type { ReactNode } from 'react';

/**
 * Feature 002 US5 — bundle configurator on the PDP. SSR-renders a per-slot
 * <fieldset> with a labelled <select> of options + a quantity input
 * carrying min/max attributes from the slot. The "Add to cart" CTA is
 * `aria-disabled` when any slot is required (minQuantity > 0) so SSR
 * users see it's blocked until they pick a configuration; client-side
 * enhancement will toggle it after live `/bundle-configuration/validate`.
 */

export interface BundleConfiguratorSlot {
  id: string;
  name: Record<string, string>;
  minQuantity: number;
  maxQuantity: number;
  position: number;
  options: Array<{
    id: string;
    defaultQuantity: number;
    position: number;
    product: {
      id: string;
      sku: string;
      slug: string;
      name: string;
      primaryAssetUrl: string | null;
      price: { amount: number; currency: string } | null;
    };
  }>;
}

export interface BundleConfiguratorLabels {
  addToCart: string;
  requiredSlot: string;
}

function localize(blob: Record<string, string>, locale: string): string {
  return blob[locale] ?? blob['en-US'] ?? Object.values(blob)[0] ?? '';
}

export function BundleConfigurator(props: {
  productSlug: string;
  slots: BundleConfiguratorSlot[];
  labels: BundleConfiguratorLabels;
  locale: string;
}): ReactNode {
  if (props.slots.length === 0) return null;

  const hasRequiredSlot = props.slots.some((s) => s.minQuantity > 0);

  return (
    <form
      className="flex flex-col gap-4"
      action={`/p/${props.productSlug}/configure`}
      method="post"
    >
      {props.slots.map((slot) => {
        const slotName = localize(slot.name, props.locale);
        const required = slot.minQuantity > 0;
        return (
          <fieldset key={slot.id} className="rounded-md border border-line p-[12px]">
            <legend className="font-medium">
              {slotName}
              {required ? (
                <span className="text-muted">
                  {' '}
                  ({props.labels.requiredSlot})
                </span>
              ) : null}
            </legend>
            <label htmlFor={`slot-${slot.id}-option`} className="block">
              {slotName}
              <select
                id={`slot-${slot.id}-option`}
                name={`slot[${slot.id}][optionId]`}
                className="mt-1 w-full rounded-sm border border-line px-[8px] py-[6px]"
                {...(required ? { required: true } : {})}
              >
                {required ? <option value="">—</option> : <option value="">—</option>}
                {slot.options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.product.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`slot-${slot.id}-quantity`} className="mt-2 block">
              <input
                id={`slot-${slot.id}-quantity`}
                name={`slot[${slot.id}][quantity]`}
                type="number"
                min={String(slot.minQuantity)}
                max={String(slot.maxQuantity)}
                defaultValue={String(Math.max(slot.minQuantity, 1))}
                className="w-[6rem] rounded-sm border border-line px-[8px] py-[6px]"
              />
            </label>
          </fieldset>
        );
      })}
      <button
        type="submit"
        className="b2b-cta"
        {...(hasRequiredSlot ? { 'aria-disabled': 'true' } : {})}
      >
        {props.labels.addToCart}
      </button>
    </form>
  );
}
