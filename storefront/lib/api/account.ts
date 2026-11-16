import type { CustomerMeResponse, PatchCustomerPreferredLanguageResponse } from '@endora-commerce/contracts';
import type { RequestContext } from './client';
import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Authenticated storefront account flows. Every call requires an active
 * `b2b_session` cookie which is forwarded to the backend.
 */

/**
 * `GET /api/v1/me` as `@endora-commerce/contracts` publishes it (issue #599).
 *
 * Read the member's `organizationRole` through `isAdministrator` and `can` in
 * `lib/organization-permissions.ts`, never directly. Gate the
 * organization-management screens on `organization.isPersonal`, never on the
 * role (feature 170, PR-3, FR-070a). `organization.canTransact` and
 * `organization.moderationMessage` drive the cart and checkout order CTAs and
 * banners (feature 026).
 */
export type MeResult = CustomerMeResponse['data'];
export type CurrentCustomer = MeResult['customerAccount'];
export type CurrentOrganization = NonNullable<MeResult['organization']>;

export type OrganizationLifecycleStatus = CurrentOrganization['status'];

export async function getMe(sessionCookie: string): Promise<MeResult> {
  return apiGetAuthed<MeResult>({ path: '/api/v1/me', sessionCookie });
}

/**
 * Issue #652 (D-292) — the buyer's choice of e-mail language. The backend
 * accepts a language the request's channel offers and answers it in the
 * channel's spelling; anything else is refused (422).
 */
export async function updatePreferredLanguage(
  sessionCookie: string,
  ctx: RequestContext | undefined,
  preferredLanguage: string,
): Promise<string | null> {
  const result = await apiMutate<PatchCustomerPreferredLanguageResponse['data']>({
    method: 'PATCH',
    path: '/api/v1/me/customer/preferred-language',
    body: { preferredLanguage },
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
  return result.data?.preferredLanguage ?? null;
}

export async function changePassword(
  sessionCookie: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiMutate<null>({
    method: 'POST',
    path: '/api/v1/me/password',
    body: { currentPassword, newPassword },
    sessionCookie,
  });
}
