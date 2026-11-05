import type { CustomerRegistrationOptionsResponse } from '@endora-commerce/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * Whether this store offers individual (org-less) self-registration —
 * `GET /api/v1/storefront/settings/customer-registration` (issue #756).
 *
 * `/register-customer` reads it before it renders, so a visitor on a store
 * where `customers.allow_registration_without_organization` is off is pointed
 * at the organization registration instead of filling in a form only to have
 * it refused on submit. Not cached, like the backend's answer: an operator's
 * switch should reach the next render.
 *
 * `null` when it cannot be read. Never throws: the page then renders the form
 * as it did before this read existed, and the backend's
 * `REGISTRATION_REQUIRES_ORGANIZATION` refusal stays the answer on submit.
 */
export async function getCustomerRegistrationOptions(
  ctx: RequestContext = {},
): Promise<CustomerRegistrationOptionsResponse['data'] | null> {
  try {
    const res = await apiGet<CustomerRegistrationOptionsResponse>(
      '/api/v1/storefront/settings/customer-registration',
      ctx,
    );
    return res.data;
  } catch {
    return null;
  }
}
