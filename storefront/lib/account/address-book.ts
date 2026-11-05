/**
 * The two pages the one address book (`components/account/AddressBook.tsx`)
 * is rendered on (`specs/173-b2c-address-book-merge/`): a B2C customer's
 * "My addresses" and a company member's "Organization addresses". Both show the
 * customer's Organization book, through `/api/v1/organizations/mine/addresses`.
 */
export type AddressBookPath = '/addresses' | '/organization/addresses';

/**
 * The page an address action returns to. A form posts it as `returnTo`, which
 * anyone can edit, so only the two pages are accepted and anything else is
 * `/addresses`.
 */
export function addressBookPath(value: unknown): AddressBookPath {
  return value === '/organization/addresses' ? '/organization/addresses' : '/addresses';
}

/** The success notices the book shows, by the `?status=` code its actions redirect with. */
export const ADDRESS_BOOK_STATUS = {
  created: 'account.addresses.created',
  removed: 'account.addresses.removed',
  default: 'account.addresses.defaultUpdated',
} as const;
