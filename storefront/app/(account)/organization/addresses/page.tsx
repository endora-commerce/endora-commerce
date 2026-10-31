import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../../lib/session';
import { createAddress, deleteAddress, listAddresses } from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';
import { CountryPicker } from '../../../../lib/dictionary/pickers/CountryPicker';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale, type MessageKey } from '../../../../lib/i18n/messages';
import { codeLabel } from '../../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Organization addresses (T155). Anyone in the org can list/create/remove
 * delivery + billing addresses; the backend tags one of each kind as the
 * default for downstream checkout (FR-046).
 */

export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const params = await searchParams;
  const addresses = await listAddresses(session);
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  return (
    <>
      <h2>{t('account.addresses.organizationHeading')}</h2>
      {params.status === 'created' ? (
        <p className="b2b-auth__success">{t('account.addresses.created')}</p>
      ) : null}
      {params.status === 'removed' ? (
        <p className="b2b-auth__success">{t('account.addresses.removed')}</p>
      ) : null}
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.addresses.col.kind')}</th>
            <th>{t('account.addresses.col.recipient')}</th>
            <th>{t('account.addresses.col.address')}</th>
            <th>{t('account.addresses.col.default')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {addresses.map((a) => (
            <tr key={a.id}>
              <td>{codeLabel(t, 'account.addressKind', a.kind)}</td>
              <td>{a.recipientName}</td>
              <td>
                {a.street}, {a.postalCode} {a.city}, {a.country}
              </td>
              <td>{a.isDefault ? t('account.addresses.isDefaultShort') : ''}</td>
              <td>
                <form action={removeAddressAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit">{t('account.common.remove')}</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t('account.addresses.add.heading')}</h3>
      <form action={createAddressAction} className="b2b-auth__form">
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-kind">{t('account.addresses.col.kind')}</label>
            <select id="addr-kind" name="kind" defaultValue="delivery">
              <option value="delivery">{t('account.addressKind.delivery')}</option>
              <option value="billing">{t('account.addressKind.billing')}</option>
            </select>
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-recipient">{t('account.addresses.col.recipient')}</label>
            <input id="addr-recipient" name="recipientName" required maxLength={160} placeholder=" " />
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="addr-street">{t('account.addresses.add.street')}</label>
          <input id="addr-street" name="street" required maxLength={255} placeholder=" " />
        </div>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-city">{t('checkout.address.city')}</label>
            <input id="addr-city" name="city" required maxLength={120} placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-postal">{t('checkout.address.postalCode')}</label>
            <input id="addr-postal" name="postalCode" required maxLength={20} placeholder=" " />
          </div>
        </div>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-country">{t('account.addresses.add.country')}</label>
            <CountryPicker
              id="addr-country"
              name="country"
              required
              defaultValue="PL"
            />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-phone">{t('checkout.address.phone')}</label>
            <input id="addr-phone" name="phone" maxLength={32} placeholder=" " />
          </div>
        </div>
        <label>
          <input type="checkbox" name="isDefault" value="true" /> {t('account.addresses.add.makeDefault')}
        </label>
        <div className="b2b-auth__actions">
          <button type="submit">{t('account.addresses.add.submit')}</button>
        </div>
      </form>
    </>
  );
}

/** A server action's own refusal, in the page's language. */
async function failure(key: MessageKey): Promise<string> {
  const { locale } = await getServerContext();
  return tForLocale(locale)(key);
}

async function createAddressAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const phone = (formData.get('phone') as string | null) || undefined;
  try {
    await createAddress(session, {
      kind: ((formData.get('kind') as string) ?? 'delivery') as 'delivery' | 'billing',
      recipientName: (formData.get('recipientName') as string) ?? '',
      street: (formData.get('street') as string) ?? '',
      city: (formData.get('city') as string) ?? '',
      postalCode: (formData.get('postalCode') as string) ?? '',
      country: ((formData.get('country') as string) ?? '').toUpperCase(),
      ...(phone ? { phone } : {}),
      ...(formData.get('isDefault') ? { isDefault: true } : {}),
    });
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.addresses.saveFailed');
    return await localeRedirect(`/organization/addresses?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/addresses?status=created`);
}

async function removeAddressAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await deleteAddress(session, id);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.detail : await failure('account.addresses.removeFailed');
    return await localeRedirect(`/organization/addresses?error=${encodeURIComponent(message)}`);
  }
  return await localeRedirect(`/organization/addresses?status=removed`);
}
