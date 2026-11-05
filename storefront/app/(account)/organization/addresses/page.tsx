import type { ReactNode } from 'react';
import { getSessionCookie } from '../../../../lib/session';
import { createAddress, deleteAddress, listAddresses } from '../../../../lib/api/organization';
import { StorefrontApiError } from '../../../../lib/api/client';
import { OrganizationAddressForm } from '../../../../components/account/OrganizationAddressForm';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { ADDRESS_ERRORS, invalidAddressFields, type AddressFormState } from '../../../../lib/account/address-errors';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import { codeLabel } from '../../../../lib/account/labels';
import { getMe } from '../../../../lib/api/account';
import { memberSession } from '../../../../lib/commerce-permissions';
import { mayManageOrganizationAddresses } from '../../../../lib/account/organization-addresses';
import { organizationAreaAccess } from '../../../../lib/account/organization-area';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Organization addresses (T155). Anyone in the org can list the delivery and
 * billing addresses; the backend tags one of each kind as the default for
 * downstream checkout (FR-046).
 *
 * Feature 170 (`specs/170-organization-roles/` WP-16; FR-057, OR-8) — adding
 * and removing one needs `addresses.manage`, which the API enforces. A member
 * whose role lacks it reads the list without the *Remove* buttons and gets one
 * line saying why in place of the add form (owner ruling of 2026-11-04: a
 * member who cannot act is not shown the controls). A session that cannot be
 * read keeps today's page — the API is the gate.
 *
 * Issue #757 — a personal Organization's member, as an org-less customer, is
 * sent to their own address book, `/addresses`, which lists the
 * Organization's addresses beside theirs (the FR-070a gate).
 */

export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const params = await searchParams;
  const [addresses, me] = await Promise.all([listAddresses(session), getMe(session).catch(() => null)]);
  if (me && organizationAreaAccess(me, 'addresses') === 'absent') return await localeRedirect('/addresses');
  const canManage = mayManageOrganizationAddresses(memberSession(me));
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
      {/* Issue #745 — `?error=` is a code (the remove's); one this page does not know reads as its generic failure. */}
      {params.error ? <p className="b2b-auth__error">{t(ADDRESS_ERRORS.errorKey(params.error)!)}</p> : null}

      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.addresses.col.kind')}</th>
            <th>{t('account.addresses.col.recipient')}</th>
            <th>{t('account.addresses.col.address')}</th>
            <th>{t('account.addresses.col.default')}</th>
            {canManage ? <th></th> : null}
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
              {canManage ? (
                <td>
                  <form action={removeAddressAction}>
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit">{t('account.common.remove')}</button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {canManage ? (
        <>
          <h3>{t('account.addresses.add.heading')}</h3>
          <OrganizationAddressForm action={createAddressAction} locale={locale} />
        </>
      ) : (
        <p className="b2b-auth__hint">{t('account.addresses.manageNotAllowed')}</p>
      )}
    </>
  );
}

/**
 * Issue #745 — a refused create answers as action state: the refusal's code and, for
 * `VALIDATION_FAILED`, the fields at fault. Never the API's sentence, and nothing in the URL.
 */
async function createAddressAction(_state: AddressFormState, formData: FormData): Promise<AddressFormState> {
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
    const error = ADDRESS_ERRORS.failureCode(err, 'SAVE_FAILED');
    const fields = error === 'VALIDATION_FAILED' && err instanceof StorefrontApiError ? invalidAddressFields(err.details) : [];
    return { error, fields };
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
    return await localeRedirect(`/organization/addresses?error=${ADDRESS_ERRORS.failureCode(err, 'REMOVE_FAILED')}`);
  }
  return await localeRedirect(`/organization/addresses?status=removed`);
}
