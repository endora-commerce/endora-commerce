import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getSessionCookie } from '../../../lib/session';
import { listAddresses } from '../../../lib/api/organization';
import { getMe } from '../../../lib/api/account';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { getServerContext } from '../../../lib/server-context';
import { memberSession } from '../../../lib/commerce-permissions';
import { mayManageOrganizationAddresses } from '../../../lib/account/organization-addresses';
import { isPersonalOrganization } from '../../../lib/account/organization-area';
import { AddressBook } from '../../../components/account/AddressBook';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * "My addresses" — a B2C customer's one address book
 * (`specs/173-b2c-address-book-merge/` FR-001, OD-1): their personal
 * Organization's, the book checkout offers and saves to. The personal address
 * book this page used to show is retired.
 *
 * A company member's one address entry is the company's book, so this page
 * sends them to `/organization/addresses` (FR-004, OD-11). A customer with no
 * Organization — legacy data, invalid under Principle XI — has no address page
 * and goes to `/account`.
 */
export default async function MyAddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const me = await getMe(session);
  if (!me.organization) return await localeRedirect('/account');
  if (!isPersonalOrganization(me.organization)) return await localeRedirect('/organization/addresses');
  const [params, addresses, { locale }] = await Promise.all([
    searchParams,
    listAddresses(session),
    getServerContext(),
  ]);

  return (
    <AddressBook
      heading="account.addresses.heading"
      addresses={addresses}
      canManage={mayManageOrganizationAddresses(memberSession(me))}
      locale={locale}
      returnTo="/addresses"
      status={params.status}
      error={params.error}
    />
  );
}
