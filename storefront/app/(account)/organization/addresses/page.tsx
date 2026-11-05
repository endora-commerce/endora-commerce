import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getSessionCookie } from '../../../../lib/session';
import { listAddresses } from '../../../../lib/api/organization';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { getServerContext } from '../../../../lib/server-context';
import { getMe } from '../../../../lib/api/account';
import { memberSession } from '../../../../lib/commerce-permissions';
import { mayManageOrganizationAddresses } from '../../../../lib/account/organization-addresses';
import { organizationAreaAccess } from '../../../../lib/account/organization-area';
import { AddressBook } from '../../../../components/account/AddressBook';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Organization addresses (T155) — a company member's one address book
 * (`specs/173-b2c-address-book-merge/` OD-11). Anyone in the org can list the
 * delivery and billing addresses; the backend tags one of each kind as the
 * default for downstream checkout (FR-046). It is rendered by the same
 * `AddressBook` as `/addresses`.
 *
 * Feature 170 (`specs/170-organization-roles/` WP-16; FR-057, OR-8) — adding,
 * removing and making one the default need `addresses.manage`, which the API
 * enforces. A member whose role lacks it reads the list without the controls
 * and gets one line saying why (owner ruling of 2026-11-04). A session that
 * cannot be read keeps the controls — the API is the gate.
 *
 * Issue #757 — a personal Organization's member is sent to `/addresses`, which
 * is their "My addresses" over the same book.
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
  const { locale } = await getServerContext();

  return (
    <AddressBook
      heading="account.addresses.organizationHeading"
      addresses={addresses}
      canManage={mayManageOrganizationAddresses(memberSession(me))}
      locale={locale}
      returnTo="/organization/addresses"
      status={params.status}
      error={params.error}
    />
  );
}
