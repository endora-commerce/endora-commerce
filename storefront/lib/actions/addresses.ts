'use server';

import { createAddressRequestSchema } from '@endora-commerce/contracts';
import { createAddress, deleteAddress, updateAddress } from '../api/organization';
import { getSessionCookie } from '../session';
import { localeRedirect } from '../i18n/navigation';
import { addressBookPath } from '../account/address-book';
import {
  ADDRESS_ERRORS,
  fieldErrorsFromApi,
  fieldErrorsFromIssues,
  type AddressFormState,
} from '../account/address-errors';

/**
 * The one address book's server actions (`specs/173-b2c-address-book-merge/`),
 * shared by `/addresses` and `/organization/addresses`. Every write goes to the
 * customer's Organization book, `/api/v1/organizations/mine/addresses`, which
 * checkout reads and writes too.
 *
 * A refused *add* answers as action state, so the form keeps what was typed
 * and each field at fault gets its own sentence (issue #792). *Remove* and
 * *Make default* redirect with a code, never a sentence (issue #745).
 */

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function createAddressAction(
  _previous: AddressFormState,
  formData: FormData,
): Promise<AddressFormState> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const returnTo = addressBookPath(formData.get('returnTo'));
  const phone = text(formData, 'phone');
  // The published schema, parsed here first: its issue codes are what name a
  // field's problem. The issues' own messages are never read.
  const parsed = createAddressRequestSchema.safeParse({
    kind: text(formData, 'kind') || 'delivery',
    recipientName: text(formData, 'recipientName'),
    street: text(formData, 'street'),
    city: text(formData, 'city'),
    postalCode: text(formData, 'postalCode'),
    country: text(formData, 'country').toUpperCase(),
    ...(phone ? { phone } : {}),
    ...(formData.get('isDefault') ? { isDefault: true } : {}),
  });
  if (!parsed.success) {
    return { error: 'VALIDATION_FAILED', fields: fieldErrorsFromIssues(parsed.error.issues) };
  }
  const { phone: parsedPhone, isDefault, ...address } = parsed.data;
  try {
    await createAddress(session, {
      ...address,
      ...(parsedPhone !== undefined ? { phone: parsedPhone } : {}),
      ...(isDefault !== undefined ? { isDefault } : {}),
    });
  } catch (err) {
    const error = ADDRESS_ERRORS.failureCode(err, 'SAVE_FAILED');
    const refusal = err as { code?: unknown; details?: unknown };
    const fields = typeof refusal.code === 'string' ? fieldErrorsFromApi(refusal.code, refusal.details) : [];
    return { error, fields };
  }
  return await localeRedirect(`${returnTo}?status=created`);
}

export async function removeAddressAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const returnTo = addressBookPath(formData.get('returnTo'));
  try {
    await deleteAddress(session, text(formData, 'id'));
  } catch (err) {
    return await localeRedirect(`${returnTo}?error=${ADDRESS_ERRORS.failureCode(err, 'REMOVE_FAILED')}`);
  }
  return await localeRedirect(`${returnTo}?status=removed`);
}

export async function setDefaultAddressAction(formData: FormData): Promise<void> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login');
  const returnTo = addressBookPath(formData.get('returnTo'));
  try {
    await updateAddress(session, text(formData, 'id'), { isDefault: true });
  } catch (err) {
    return await localeRedirect(`${returnTo}?error=${ADDRESS_ERRORS.failureCode(err, 'DEFAULT_FAILED')}`);
  }
  return await localeRedirect(`${returnTo}?status=default`);
}
