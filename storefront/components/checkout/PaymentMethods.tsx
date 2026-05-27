import type { ReactNode } from 'react';
import type { PaymentMethodSummary } from '../../lib/api/methods';
import { resolvePaymentMethodRenderer } from '../../lib/payment-renderers/registry';

/**
 * Checkout "Payment methods" section (feature 034, US2). Renders each eligible
 * method through its registered renderer, falling back to the platform default
 * (FR-016/FR-017). Communicates the empty state instead of an actionable but
 * empty list (US2 AC4).
 */
export function PaymentMethods({
  methods,
  currency,
}: {
  methods: PaymentMethodSummary[];
  currency?: string | undefined;
}): ReactNode {
  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>Payment method</legend>
      {methods.length === 0 ? (
        <p className="muted">
          No payment method is available for your account on this sales channel.
        </p>
      ) : (
        methods.map((m, i) => {
          const Renderer = resolvePaymentMethodRenderer(m.rendererKey);
          return <Renderer key={m.id} method={m} defaultChecked={i === 0} currency={currency} />;
        })
      )}
    </fieldset>
  );
}
