import type { OrganizationRoleRef, PatchCustomerPreferredLanguageResponse } from '@endora-commerce/contracts';
import type { RequestContext } from './client';
import { apiGetAuthed, apiMutate } from './mutations';

/**
 * Authenticated storefront account flows. Every call requires an active
 * `b2b_session` cookie which is forwarded to the backend.
 */

export interface CurrentCustomer {
  id: string;
  /** Null for standalone (org-less) customers (feature 040). */
  organizationId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  /**
   * Feature 170 (FR-056) — the member's organization role, named in the
   * response language. Read it through `isAdministrator` and `can` in
   * `lib/organization-permissions.ts`, never directly.
   */
  organizationRole: OrganizationRoleRef;
  /** The role's effective organization permission codes (FR-056). */
  permissions: string[];
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  /**
   * Issue #652 (D-292) — the language this customer's e-mails are written in,
   * as the channel that captured it spells it; `null` while unknown (the
   * store's default language is used). Absent from a backend that predates it.
   */
  preferredLanguage?: string | null;
}

export type OrganizationLifecycleStatus =
  | 'pending_verification'
  | 'active'
  | 'blocked'
  | 'rejected';

export interface CurrentOrganization {
  id: string;
  name: string;
  legalName?: string | null;
  /** `null` for a personal Organization (`specs/177-tax-id-scope/`). */
  taxId: string | null;
  status: OrganizationLifecycleStatus | string;
  vatStatus: string;
  /**
   * A personal (B2C) Organization: its one member holds *Administrator*, yet
   * the storefront offers it none of the organization-management screens —
   * gated on this flag, never on the role (feature 170, PR-3, FR-070a).
   */
  isPersonal: boolean;
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
  version?: number;
  /**
   * Feature 026 — convenience flag (`status === 'active'`). Surfaced by the
   * backend so the storefront can disable order CTAs without re-implementing
   * the rule.
   */
  canTransact?: boolean;
  /**
   * Feature 026 — localized, customer-safe explanation of the current status.
   * `null` when `canTransact` is `true`. Use as the cart/checkout banner body.
   */
  moderationMessage?: string | null;
}

export interface MeResult {
  customerAccount: CurrentCustomer;
  /** Null for standalone (org-less) customers (feature 040). */
  organization: CurrentOrganization | null;
  /** Non-null when the current session is an Admin impersonating this customer. */
  impersonation: { impersonatorAdminUserId: string } | null;
}

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
