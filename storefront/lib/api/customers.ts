import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Feature 040 — storefront wrappers for the customer self-service surfaces
 * (personal address book + defaults). All calls are session-authenticated.
 */

export interface CustomerAddress {
  id: string;
  customerAccountId: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface OrganizationAddressRef {
  id: string;
  organizationId: string;
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface CustomerAddressBook {
  personal: CustomerAddress[];
  organization: OrganizationAddressRef[];
}

export interface CustomerAddressInput {
  kind: 'delivery' | 'billing';
  recipientName: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string;
  isDefault?: boolean;
}

export async function listMyAddresses(sessionCookie: string): Promise<CustomerAddressBook> {
  return apiGetAuthed<CustomerAddressBook>({
    path: '/api/v1/me/customer/addresses',
    sessionCookie,
  });
}

export async function createMyAddress(
  sessionCookie: string,
  input: CustomerAddressInput,
): Promise<CustomerAddress> {
  const result = await apiMutate<CustomerAddress>({
    method: 'POST',
    path: '/api/v1/me/customer/addresses',
    body: input,
    sessionCookie,
  });
  return result.data!;
}

export async function deleteMyAddress(sessionCookie: string, addressId: string): Promise<void> {
  await apiMutate<null>({
    method: 'DELETE',
    path: `/api/v1/me/customer/addresses/${addressId}`,
    sessionCookie,
  });
}

export async function setMyDefaultAddress(
  sessionCookie: string,
  addressId: string,
): Promise<CustomerAddress> {
  const result = await apiMutate<CustomerAddress>({
    method: 'PUT',
    path: `/api/v1/me/customer/addresses/${addressId}/default`,
    sessionCookie,
  });
  return result.data!;
}

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
  patch: Partial<CustomerDefaults>,
): Promise<CustomerDefaults> {
  const result = await apiMutate<CustomerDefaults>({
    method: 'PUT',
    path: '/api/v1/me/customer/defaults',
    body: patch,
    sessionCookie,
  });
  return result.data!;
}
