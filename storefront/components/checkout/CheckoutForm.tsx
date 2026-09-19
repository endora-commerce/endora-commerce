'use client';

import { type ReactNode } from 'react';
import { ensureShippingAdapterDataOnFormData } from '../../lib/checkout/shipping-adapter-data';

/**
 * Checkout `<form>` wrapper (feature 068).
 *
 * The one thing it does is the reason it is a client component: it re-applies
 * the delivery adapter's hidden fields onto `FormData` before the Server Action
 * runs, because a carrier picker may render them outside this element (a map
 * panel in a portal). See `lib/checkout/shipping-adapter-data.ts` for the
 * field-name convention.
 *
 * It used to gate submission on an InPost-specific rule — a Polish mobile number
 * on the delivery address — which left a vendor's business rule and an import of
 * that vendor's contract module in the free checkout. The rule is enforced where
 * it belongs, in the carrier adapter's own `validate` (which is what actually
 * refuses the order); the client-side copy went with the carrier's storefront
 * fragment (`specs/134-paid-module-extraction/`, ruling O-1(b)).
 */
export function CheckoutForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <form
      className={className}
      action={async (formData) => {
        ensureShippingAdapterDataOnFormData(formData);
        await action(formData);
      }}
    >
      {children}
    </form>
  );
}
