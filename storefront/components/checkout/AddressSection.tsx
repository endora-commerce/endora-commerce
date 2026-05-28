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
}

function label(a: AddressSummary): string {
  return `${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}, ${a.country}`;
}

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
      />
      <input
        name={`${prefix}_street`}
        placeholder={t('checkout.address.street')}
        required={required}
      />
      <input
        name={`${prefix}_postalCode`}
        placeholder={t('checkout.address.postalCode')}
        required={required}
      />
      <input
        name={`${prefix}_city`}
        placeholder={t('checkout.address.city')}
        required={required}
      />
      <input
        name={`${prefix}_country`}
        placeholder={t('checkout.address.country')}
        required={required}
        maxLength={2}
      />
      <input name={`${prefix}_phone`} placeholder={t('checkout.address.phone')} />
    </div>
  );
}

export function AddressSection({
  deliveryAddresses,
  billingAddresses,
  locale,
}: AddressSectionProps): React.ReactNode {
  const t = tForLocale(locale);
  const [shippingMode, setShippingMode] = useState<'saved' | 'new'>(
    deliveryAddresses.length > 0 ? 'saved' : 'new',
  );
  const [billingSame, setBillingSame] = useState(true);
  const [billingMode, setBillingMode] = useState<'saved' | 'new'>(
    billingAddresses.length > 0 ? 'saved' : 'new',
  );

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
          <select name="deliveryAddressId" defaultValue={deliveryAddresses[0]!.id}>
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
            <select name="billingAddressId" defaultValue={billingAddresses[0]!.id}>
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
