import type { ReactNode } from 'react';
import type { DeliveryMethodSummary } from '../../lib/api/methods';
import { resolveShippingMethodRenderer } from '../../lib/shipping-renderers/registry';
/** Feature 068 — register InPost locker Geowidget renderer before resolve. */
import '../../lib/shipping-renderers/inpost-locker';

/**
 * Checkout "Shipping methods" section (feature 035, US2). Renders each eligible
 * method through its registered renderer, falling back to the platform default
 * (FR-016/FR-017). Communicates the empty state instead of an actionable but
 * empty list (US2 AC4).
 */
export function ShippingMethods({
  methods,
  preferredId,
  locale,
}: {
  methods: DeliveryMethodSummary[];
  /** Feature 039 — pre-select this method (the resolved default) when present. */
  preferredId?: string | null;
  /** Feature 068 — locale for adapter-specific checkout copy (e.g. InPost). */
  locale?: string | undefined;
}): ReactNode {
  const preferredIdx = preferredId ? methods.findIndex((m) => m.id === preferredId) : -1;
  const selectedIdx = preferredIdx >= 0 ? preferredIdx : 0;
  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>Delivery method</legend>
      {methods.length === 0 ? (
        <p className="muted">
          No delivery method is available for your account on this sales channel.
        </p>
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
