'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { PaymentMethodSummary } from '../../lib/api/methods';
import { resolvePaymentMethodRenderer } from '../../lib/payment-renderers/registry';
import { tForLocale } from '../../lib/i18n/messages';
import {
  filterPaymentMethodsForApplePaySupport,
  isApplePayAvailable,
} from '../../lib/apple-pay';

/**
 * Checkout "Payment methods" section (feature 034, US2). Renders each eligible
 * method through its registered renderer, falling back to the platform default
 * (FR-016/FR-017). Communicates the empty state instead of an actionable but
 * empty list (US2 AC4).
 *
 * Apple Pay (`payu_apple_pay` / `stripe_apple_pay`) is
 * omitted unless the browser exposes a usable `ApplePaySession` (Safari /
 * Apple devices).
 *
 * The empty state is one sentence for two causes — a shop that configured no
 * method, and a platform whose `payment_methods` or `payments` module an
 * operator switched off. `listPaymentMethods` degrades the module refusal to an
 * empty list precisely so both arrive here, because a buyer cannot act on the
 * difference between them.
 */
export function PaymentMethods({
  methods,
  currency,
  preferredId,
  locale,
}: {
  methods: PaymentMethodSummary[];
  currency?: string | undefined;
  /** Feature 039 — pre-select this method (the resolved default) when present. */
  preferredId?: string | null;
  locale?: string | undefined;
}): ReactNode {
  // Hide Apple Pay until client confirms support (avoids showing it on Chrome/Android).
  const [visibleMethods, setVisibleMethods] = useState(() =>
    filterPaymentMethodsForApplePaySupport(methods, false),
  );

  useEffect(() => {
    setVisibleMethods(filterPaymentMethodsForApplePaySupport(methods, isApplePayAvailable()));
  }, [methods]);

  const t = tForLocale(locale ?? 'en-US');

  const preferredIdx = preferredId
    ? visibleMethods.findIndex((m) => m.id === preferredId)
    : -1;
  const selectedIdx = preferredIdx >= 0 ? preferredIdx : 0;

  return (
    <fieldset className="b2b-auth__form border-0 p-0">
      <legend className="font-semibold">Payment method</legend>
      {visibleMethods.length === 0 ? (
        <p className="muted">{t('checkout.payment.none')}</p>
      ) : (
        visibleMethods.map((m, i) => {
          const Renderer = resolvePaymentMethodRenderer(m.rendererKey);
          return (
            <Renderer
              key={m.id}
              method={m}
              defaultChecked={i === selectedIdx}
              currency={currency}
              locale={locale}
            />
          );
        })
      )}
    </fieldset>
  );
}
