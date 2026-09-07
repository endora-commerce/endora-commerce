import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { getMe } from '../../../lib/api/account';
import { listPaymentMethods, listDeliveryMethods } from '../../../lib/api/methods';
import { listAddresses, type AddressSummary } from '../../../lib/api/organization';
import {
  getQuickOrderPreference,
  upsertQuickOrderPreference,
} from '../../../lib/api/quick-order';
import { StorefrontApiError } from '../../../lib/api/client';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Default ordering preferences (feature 039 / US2). Lets a customer set their
 * own default payment method, delivery method, billing address, and shipping
 * address. Each is optional — an empty selection inherits the organization
 * default. The selections are applied automatically at checkout.
 */

function localized(name: Record<string, string>, locale: string): string {
  return name[locale] ?? name['en-US'] ?? Object.values(name)[0] ?? '';
}

function addressLabel(a: AddressSummary): string {
  return `${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}, ${a.country}`;
}

export default async function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/preferences');
  const sp = await searchParams;
  const { locale } = await getServerContext();

  const [me, paymentMethods, deliveryMethods, deliveryAddresses, billingAddresses] =
    await Promise.all([
      getMe(session),
      listPaymentMethods(),
      listDeliveryMethods(),
      listAddresses(session, 'delivery'),
      listAddresses(session, 'billing'),
    ]);

  const current = await getQuickOrderPreference(session, 'customer', me.customerAccount.id).catch(
    () => null,
  );

  return (
    <>
      <h2>Default ordering preferences</h2>
      <p className="b2b-auth__hint">
        These are applied automatically at checkout. Leave a field blank to inherit your
        organization&apos;s default.
      </p>

      {sp.saved ? <p className="b2b-auth__success">Preferences saved.</p> : null}
      {sp.error ? <p className="b2b-auth__error">{sp.error}</p> : null}

      <form action={saveAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="defaultPaymentMethodId">Default payment method</label>
          <select
            id="defaultPaymentMethodId"
            name="defaultPaymentMethodId"
            defaultValue={current?.defaultPaymentMethodId ?? ''}
          >
            <option value="">(inherit organization default)</option>
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {localized(m.name, locale)}
              </option>
            ))}
          </select>
        </div>

        <div className="b2b-auth__field">
          <label htmlFor="defaultDeliveryMethodId">Default delivery method</label>
          <select
            id="defaultDeliveryMethodId"
            name="defaultDeliveryMethodId"
            defaultValue={current?.defaultDeliveryMethodId ?? ''}
          >
            <option value="">(inherit organization default)</option>
            {deliveryMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {localized(m.name, locale)}
              </option>
            ))}
          </select>
        </div>

        <div className="b2b-auth__field">
          <label htmlFor="defaultBillingAddressId">Default billing address</label>
          <select
            id="defaultBillingAddressId"
            name="defaultBillingAddressId"
            defaultValue={current?.defaultBillingAddressId ?? ''}
          >
            <option value="">(inherit organization default)</option>
            {billingAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {addressLabel(a)}
              </option>
            ))}
          </select>
        </div>

        <div className="b2b-auth__field">
          <label htmlFor="defaultShippingAddressId">Default shipping address</label>
          <select
            id="defaultShippingAddressId"
            name="defaultShippingAddressId"
            defaultValue={current?.defaultShippingAddressId ?? ''}
          >
            <option value="">(inherit organization default)</option>
            {deliveryAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {addressLabel(a)}
              </option>
            ))}
          </select>
        </div>

        <div className="b2b-auth__actions">
          <button type="submit">Save preferences</button>
        </div>
      </form>
    </>
  );
}

async function saveAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const me = await getMe(session);

  const field = (name: string): string | null => {
    const value = ((formData.get(name) as string) ?? '').trim();
    return value.length > 0 ? value : null;
  };

  try {
    await upsertQuickOrderPreference(session, {
      scope: 'customer',
      scopeId: me.customerAccount.id,
      defaultPaymentMethodId: field('defaultPaymentMethodId'),
      defaultDeliveryMethodId: field('defaultDeliveryMethodId'),
      defaultBillingAddressId: field('defaultBillingAddressId'),
      defaultShippingAddressId: field('defaultShippingAddressId'),
    });
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not save preferences.';
    redirect(`/preferences?error=${encodeURIComponent(message)}`);
  }
  redirect('/preferences?saved=1');
}
