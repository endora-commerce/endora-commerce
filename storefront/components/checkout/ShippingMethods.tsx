import type { ReactNode } from 'react';
import type { DeliveryMethodSummary } from '../../lib/api/methods';
import { resolveShippingMethodRenderer } from '../../lib/shipping-renderers/registry';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Checkout "Shipping methods" section (feature 035, US2). Renders each eligible
 * method through its registered renderer, falling back to the platform default
 * (FR-016/FR-017). Communicates the empty state instead of an actionable but
 * empty list (US2 AC4).
 *
 * The empty state is one sentence for two causes — a shop that configured no
 * method, and a platform whose `delivery_methods` module an operator switched
 * off. `listDeliveryMethods` degrades the module refusal to an empty list
 * precisely so both arrive here, because a buyer cannot act on the difference
 * between them.
 */
export function ShippingMethods({
  methods,
  preferredId,
  locale,
}: {
  methods: DeliveryMethodSummary[];
  /** Feature 039 — pre-select this method (the resolved default) when present. */
  preferredId?: string | null;
  locale?: string | undefined;
}): ReactNode {
  const preferredIdx = preferredId ? methods.findIndex((m) => m.id === preferredId) : -1;
  const selectedIdx = preferredIdx >= 0 ? preferredIdx : 0;
  const t = tForLocale(locale ?? 'en-US');
  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>Delivery method</legend>
      {methods.length === 0 ? (
        <p className="muted">{t('checkout.delivery.none')}</p>
      ) : (
        methods.map((m, i) => {
          const Renderer = resolveShippingMethodRenderer(m.rendererKey);
          return <Renderer key={m.id} method={m} defaultChecked={i === selectedIdx} />;
        })
      )}
    </fieldset>
  );
}
