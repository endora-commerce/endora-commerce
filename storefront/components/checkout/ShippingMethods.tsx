import type { ReactNode } from 'react';
import type { DeliveryMethodSummary } from '../../lib/api/methods';
import { tForLocale } from '../../lib/i18n/messages';
import { resolveShippingMethodRenderer } from '../../lib/shipping-renderers/registry';

/**
 * Checkout "Shipping methods" section (feature 035, US2). Renders each eligible
 * method through its registered renderer, falling back to the platform default
 * (FR-016/FR-017). Communicates the empty state instead of an actionable but
 * empty list (US2 AC4).
 */
export function ShippingMethods({
  methods,
  preferredId,
  locale = 'en-US',
}: {
  methods: DeliveryMethodSummary[];
  /** Feature 039 — pre-select this method (the resolved default) when present. */
  preferredId?: string | null;
  locale?: string;
}): ReactNode {
  const t = tForLocale(locale);
  const preferredIdx = preferredId ? methods.findIndex((m) => m.id === preferredId) : -1;
  const selectedIdx = preferredIdx >= 0 ? preferredIdx : 0;
  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>{t('checkout.shipping.title')}</legend>
      {methods.length === 0 ? (
        <p className="muted">{t('checkout.shipping.empty')}</p>
      ) : (
        methods.map((m, i) => {
          const Renderer = resolveShippingMethodRenderer(m.rendererKey);
          return (
            <Renderer
              key={m.id}
              method={m}
              defaultChecked={i === selectedIdx}
              locale={locale}
            />
          );
        })
      )}
    </fieldset>
  );
}
