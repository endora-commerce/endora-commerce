'use client';

import { useState } from 'react';
import type { AddressSummary } from '../../lib/api/organization';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Checkout address section (feature 036, US2). Per address kind the buyer can
 * either pick a saved address or enter a new one (persisted to the org address
 * book by the server action). A "Billing same as shipping" toggle hides the
 * billing inputs and reuses the shipping address.
 *
 * Field-name contract consumed by the checkout server action:
 *   - saved shipping → `deliveryAddressId`; new shipping → `delivery_*` inputs
 *   - saved billing  → `billingAddressId`;  new billing  → `billing_*` inputs
 *   - `billingSameAsShipping` checkbox (when checked, billing inputs omitted)
 * The action treats an empty/absent id as "create from the `*_` inputs".
 */
export interface AddressSectionProps {
  deliveryAddresses: AddressSummary[];
  billingAddresses: AddressSummary[];
  /** Active storefront locale; resolves the PL/EN copy. */
  locale: string;
  /** Feature 039 — resolved default shipping address to pre-select, if any. */
  preferredShippingAddressId?: string | null;
  /** Feature 039 — resolved default billing address to pre-select, if any. */
  preferredBillingAddressId?: string | null;
}

function defaultAddressId(
  addresses: AddressSummary[],
  preferredId: string | null | undefined,
): string | undefined {
  if (preferredId && addresses.some((a) => a.id === preferredId)) return preferredId;
  return addresses[0]?.id;
}

function label(a: AddressSummary): string {
  return `${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}, ${a.country}`;
}

// Shared Tailwind styling for the checkout form controls, matching the rest of
// the storefront (border-line / surface tokens, brand focus ring).
const FIELD_CLASS =
  'h-[40px] w-full rounded-sm border border-line bg-surface px-[12px] text-[14px] text-fg outline-none transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-[color:var(--brand-600)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.16)]';
const SELECT_CLASS = 'industria-select h-[40px] w-full pr-[32px] text-[14px] text-fg';

function NewAddressFields({
  prefix,
  required,
  locale,
}: {
  prefix: string;
  required: boolean;
  locale: string;
}): React.ReactNode {
  const t = tForLocale(locale);
  return (
    <div className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <input
        name={`${prefix}_recipientName`}
        placeholder={t('checkout.address.recipientName')}
        required={required}
        className={FIELD_CLASS}
      />
      <input
        name={`${prefix}_street`}
        placeholder={t('checkout.address.street')}
        required={required}
        className={FIELD_CLASS}
      />
      <input
        name={`${prefix}_postalCode`}
        placeholder={t('checkout.address.postalCode')}
        required={required}
        className={FIELD_CLASS}
      />
      <input
        name={`${prefix}_city`}
        placeholder={t('checkout.address.city')}
        required={required}
        className={FIELD_CLASS}
      />
      <input
        name={`${prefix}_country`}
        placeholder={t('checkout.address.country')}
        required={required}
        maxLength={2}
        className={FIELD_CLASS}
      />
      <input
        name={`${prefix}_phone`}
        placeholder={t('checkout.address.phone')}
        className={FIELD_CLASS}
      />
    </div>
  );
}

export function AddressSection({
  deliveryAddresses,
  billingAddresses,
  locale,
  preferredShippingAddressId,
  preferredBillingAddressId,
}: AddressSectionProps): React.ReactNode {
  const t = tForLocale(locale);
  const [shippingMode, setShippingMode] = useState<'saved' | 'new'>(
    deliveryAddresses.length > 0 ? 'saved' : 'new',
  );
  // When a distinct billing default is resolved, surface the billing block so
  // the default actually applies (otherwise keep the "same as shipping" default).
  const [billingSame, setBillingSame] = useState(!preferredBillingAddressId);
  const [billingMode, setBillingMode] = useState<'saved' | 'new'>(
    billingAddresses.length > 0 ? 'saved' : 'new',
  );
  const deliveryDefaultId = defaultAddressId(deliveryAddresses, preferredShippingAddressId);
  const billingDefaultId = defaultAddressId(billingAddresses, preferredBillingAddressId);

  return (
    <>
      <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600 }}>{t('checkout.address.shippingTitle')}</legend>
        {deliveryAddresses.length > 0 ? (
          <label>
            <input
              type="radio"
              name="shippingMode"
              checked={shippingMode === 'saved'}
              onChange={() => setShippingMode('saved')}
            />{' '}
            {t('checkout.address.useSaved')}
          </label>
        ) : null}
        <label>
          <input
            type="radio"
            name="shippingMode"
            checked={shippingMode === 'new'}
            onChange={() => setShippingMode('new')}
          />{' '}
          {t('checkout.address.enterNew')}
        </label>

        {shippingMode === 'saved' && deliveryAddresses.length > 0 ? (
          <select name="deliveryAddressId" defaultValue={deliveryDefaultId} className={SELECT_CLASS}>
            {deliveryAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
              </option>
            ))}
          </select>
        ) : (
          <NewAddressFields prefix="delivery" required={shippingMode === 'new'} locale={locale} />
        )}
      </fieldset>

      <label style={{ display: 'block', margin: 'var(--b2b-spacing, 12px) 0' }}>
        <input
          type="checkbox"
          name="billingSameAsShipping"
          checked={billingSame}
          onChange={(e) => setBillingSame(e.target.checked)}
        />{' '}
        {t('checkout.address.sameAsShipping')}
      </label>

      {!billingSame ? (
        <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
          <legend style={{ fontWeight: 600 }}>{t('checkout.address.billingTitle')}</legend>
          {billingAddresses.length > 0 ? (
            <label>
              <input
                type="radio"
                name="billingMode"
                checked={billingMode === 'saved'}
                onChange={() => setBillingMode('saved')}
              />{' '}
              {t('checkout.address.useSaved')}
            </label>
          ) : null}
          <label>
            <input
              type="radio"
              name="billingMode"
              checked={billingMode === 'new'}
              onChange={() => setBillingMode('new')}
            />{' '}
            {t('checkout.address.enterNew')}
          </label>

          {billingMode === 'saved' && billingAddresses.length > 0 ? (
            <select name="billingAddressId" defaultValue={billingDefaultId} className={SELECT_CLASS}>
              {billingAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {label(a)}
                </option>
              ))}
            </select>
          ) : (
            <NewAddressFields
              prefix="billing"
              required={!billingSame && billingMode === 'new'}
              locale={locale}
            />
          )}
        </fieldset>
      ) : null}
    </>
  );
}
