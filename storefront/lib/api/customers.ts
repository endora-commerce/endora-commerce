import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Feature 040 — storefront wrappers for the customer self-service defaults.
 * All calls are session-authenticated.
 *
 * The personal address book's functions are gone with the book
 * (`specs/173-b2c-address-book-merge/` release 1): its endpoints answer
 * `410 CUSTOMER_ADDRESS_BOOK_RETIRED`. Every customer's addresses are their
 * Organization's — `listAddresses`, `createAddress`, `updateAddress` and
 * `deleteAddress` in `./organization`.
 */

/** The address defaults are the Organization book's, read-only here: they are set on that book. */
export interface CustomerDefaults {
  paymentMethodId: string | null;
  deliveryMethodId: string | null;
  billingAddressId: string | null;
  shippingAddressId: string | null;
}

export async function getMyDefaults(sessionCookie: string): Promise<CustomerDefaults> {
  return apiGetAuthed<CustomerDefaults>({
    path: '/api/v1/me/customer/defaults',
    sessionCookie,
  });
}

export async function setMyDefaults(
  sessionCookie: string,
  patch: Partial<Pick<CustomerDefaults, 'paymentMethodId' | 'deliveryMethodId'>>,
): Promise<CustomerDefaults> {
  const result = await apiMutate<CustomerDefaults>({
    method: 'PUT',
    path: '/api/v1/me/customer/defaults',
    body: patch,
    sessionCookie,
  });
  return result.data!;
}
