import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionCookie } from '../../../../lib/session';
import { createAddress, deleteAddress, listAddresses } from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';

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
  if (!session) redirect('/login');
  const params = await searchParams;
  const addresses = await listAddresses(session);

  return (
    <>
      <h2>Addresses</h2>
      {params.status === 'created' ? (
        <p className="b2b-auth__success">Address added.</p>
      ) : null}
      {params.status === 'removed' ? (
        <p className="b2b-auth__success">Address removed.</p>
      ) : null}
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
          {addresses.map((a) => (
            <tr key={a.id}>
              <td>{a.kind}</td>
              <td>{a.recipientName}</td>
              <td>
                {a.street}, {a.postalCode} {a.city}, {a.country}
              </td>
              <td>{a.isDefault ? 'yes' : ''}</td>
              <td>
                <form action={removeAddressAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add an address</h3>
      <form action={createAddressAction} className="b2b-auth__form">
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
            <input id="addr-recipient" name="recipientName" required maxLength={160} />
          </div>
        </div>
        <div className="b2b-auth__field">
          <label htmlFor="addr-street">Street</label>
          <input id="addr-street" name="street" required maxLength={255} />
        </div>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-city">City</label>
            <input id="addr-city" name="city" required maxLength={120} />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-postal">Postal code</label>
            <input id="addr-postal" name="postalCode" required maxLength={20} />
          </div>
        </div>
        <div className="b2b-auth__row">
          <div className="b2b-auth__field">
            <label htmlFor="addr-country">Country (ISO-2)</label>
            <input
              id="addr-country"
              name="country"
              required
              minLength={2}
              maxLength={2}
              placeholder="PL"
            />
          </div>
          <div className="b2b-auth__field">
            <label htmlFor="addr-phone">Phone (optional)</label>
            <input id="addr-phone" name="phone" maxLength={32} />
          </div>
        </div>
        <label>
          <input type="checkbox" name="isDefault" value="true" /> Make this the default for its
          kind
        </label>
        <div className="b2b-auth__actions">
          <button type="submit">Add address</button>
        </div>
      </form>
    </>
  );
}

async function createAddressAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
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
      err instanceof StorefrontApiError ? err.message : 'Could not save address.';
    redirect(`/organization/addresses?error=${encodeURIComponent(message)}`);
  }
  redirect(`/organization/addresses?status=created`);
}

async function removeAddressAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await deleteAddress(session, id);
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : 'Could not remove address.';
    redirect(`/organization/addresses?error=${encodeURIComponent(message)}`);
  }
  redirect(`/organization/addresses?status=removed`);
}
