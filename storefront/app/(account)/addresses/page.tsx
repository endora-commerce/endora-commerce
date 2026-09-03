import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../lib/session';
import {
  createMyAddress,
  deleteMyAddress,
  listMyAddresses,
  setMyDefaultAddress,
} from '../../../lib/api/customers';
import { StorefrontApiError } from '../../../lib/api/client';
import { CountryPicker } from '../../../lib/dictionary/pickers/CountryPicker';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Feature 040, US2 — the customer's personal address book. Works for org-less
 * and org-bound customers (org-bound customers additionally see their
 * Organization's shared addresses, read-only). One default per kind.
 */
export default async function MyAddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const params = await searchParams;
  const book = await listMyAddresses(session);

  return (
    <>
      <h2>My addresses</h2>
      {params.status === 'created' ? <p className="b2b-auth__success">Address added.</p> : null}
      {params.status === 'removed' ? <p className="b2b-auth__success">Address removed.</p> : null}
      {params.status === 'default' ? <p className="b2b-auth__success">Default updated.</p> : null}
      {params.error ? <p className="b2b-auth__error">{params.error}</p> : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Recipient</th>
            <th>Address</th>
            <th>Default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {book.personal.length === 0 ? (
            <tr>
              <td colSpan={5}>No addresses yet.</td>
            </tr>
          ) : (
            book.personal.map((a) => (
              <tr key={a.id}>
                <td>{a.kind}</td>
                <td>{a.recipientName}</td>
                <td>
                  {a.street}, {a.postalCode} {a.city}, {a.country}
                </td>
                <td>
                  {a.isDefault ? (
                    'Default'
                  ) : (
                    <form action={setDefaultAction} className="inline">
                      <input type="hidden" name="addressId" value={a.id} />
                      <button type="submit">Make default</button>
                    </form>
                  )}
                </td>
                <td>
                  <form action={removeAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="addressId" value={a.id} />
                    <button type="submit">Remove</button>
                  </form>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {book.organization.length > 0 ? (
        <>
          <h3>Organization addresses</h3>
          <p className="b2b-account__hint">Shared addresses you can use at checkout.</p>
          <table className="b2b-account__table">
            <tbody>
              {book.organization.map((a) => (
                <tr key={a.id}>
                  <td>{a.kind}</td>
                  <td>{a.recipientName}</td>
                  <td>
                    {a.street}, {a.postalCode} {a.city}, {a.country}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h3>Add an address</h3>
      <form action={createAction} className="b2b-auth__form">
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-kind">Kind</label>
            <select id="addr-kind" name="kind" defaultValue="delivery">
              <option value="delivery">delivery</option>
              <option value="billing">billing</option>
            </select>
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-recipient">Recipient</label>
            <input id="addr-recipient" name="recipientName" required maxLength={160} placeholder=" " />
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="addr-street">Street</label>
          <input id="addr-street" name="street" required maxLength={255} placeholder=" " />
        </div>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-city">City</label>
            <input id="addr-city" name="city" required maxLength={120} placeholder=" " />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-postal">Postal code</label>
            <input id="addr-postal" name="postalCode" required maxLength={20} placeholder=" " />
          </div>
        </div>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-country">Country</label>
            <CountryPicker id="addr-country" name="country" required defaultValue="PL" />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-phone">Phone (optional)</label>
            <input id="addr-phone" name="phone" maxLength={32} placeholder=" " />
          </div>
        </div>
        <label>
          <input type="checkbox" name="isDefault" value="true" /> Make this the default for its kind
        </label>
        <div className="b2b-auth__actions">
          <button type="submit">Add address</button>
        </div>
      </form>
    </>
  );
}

async function createAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const phone = (formData.get('phone') as string | null) || undefined;
  try {
    await createMyAddress(session, {
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
    const message = err instanceof StorefrontApiError ? err.message : 'Could not save address.';
    redirect(`/addresses?error=${encodeURIComponent(message)}`);
  }
  redirect('/addresses?status=created');
}

async function removeAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    await deleteMyAddress(session, (formData.get('addressId') as string) ?? '');
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not remove address.';
    redirect(`/addresses?error=${encodeURIComponent(message)}`);
  }
  redirect('/addresses?status=removed');
}

async function setDefaultAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  try {
    await setMyDefaultAddress(session, (formData.get('addressId') as string) ?? '');
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not set default.';
    redirect(`/addresses?error=${encodeURIComponent(message)}`);
  }
  redirect('/addresses?status=default');
}
