'use client';

import { useRef, useState, type ReactNode } from 'react';
import { normalizePolishMobilePhone } from '@endora-commerce/contracts';
import { ensureInpostTargetPointOnFormData } from '../../lib/shipping-renderers/inpost-geowidget';
import { tForLocale } from '../../lib/i18n/messages';

const INPOST_ADAPTERS = new Set(['inpost_locker', 'inpost_courier']);

function selectedDeliveryAdapter(form: HTMLFormElement): string | null {
  const checked = form.querySelector<HTMLInputElement>(
    'input[name="deliveryMethodId"]:checked',
  );
  return checked?.dataset['adapter'] ?? null;
}

function resolveDeliveryPhone(form: HTMLFormElement, formData: FormData): string {
  const fromNew = String(formData.get('delivery_phone') ?? '').trim();
  if (fromNew) return fromNew;
  const select = form.querySelector<HTMLSelectElement>('select[name="deliveryAddressId"]');
  const opt = select?.selectedOptions?.[0];
  return (opt?.dataset['phone'] ?? '').trim();
}

/**
 * Checkout `<form>` wrapper (feature 068).
 *
 * Re-applies the InPost Geowidget target point onto FormData before the server
 * action, and blocks submit when an InPost method is selected without a valid
 * Polish mobile phone on the delivery address.
 */
export function CheckoutForm({
  action,
  children,
  className,
  locale = 'en',
}: {
  action: (formData: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
  locale?: string;
}): ReactNode {
  const t = tForLocale(locale);
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className={className}
      action={async (formData) => {
        ensureInpostTargetPointOnFormData(formData);
        const form = formRef.current;
        const adapter = form ? selectedDeliveryAdapter(form) : null;
        if (adapter && INPOST_ADAPTERS.has(adapter) && form) {
          const phone = resolveDeliveryPhone(form, formData);
          if (!normalizePolishMobilePhone(phone)) {
            setError(t('inpost.phone.required'));
            return;
          }
        }
        setError(null);
        await action(formData);
      }}
    >
      {error ? (
        <p className="mb-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {children}
    </form>
  );
}
