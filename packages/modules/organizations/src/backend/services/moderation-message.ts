import type { SupportedLanguage } from '@endora-commerce/contracts';

import type { Organization } from '../entities/organization.entity.js';
import {
  organizationsProse,
  type OrganizationsProseKey,
  type OrganizationsTranslate,
} from './organizations-prose.js';

/**
 * The customer-safe sentences explaining why an Organization cannot transact,
 * in the language the response is answered in. The storefront shows them
 * verbatim beside the machine `status`; admin-only detail (the block reason)
 * is never in them.
 */

/**
 * `GET /api/v1/me`'s `moderationMessage`: the disabled-CTA tooltip and the
 * cart-banner body. `null` for an active Organization.
 */
export async function describeModerationStatus(
  translate: OrganizationsTranslate | undefined,
  status: Organization['status'],
  language: SupportedLanguage,
): Promise<string | null> {
  if (status === 'active') return null;
  const key: Record<Exclude<Organization['status'], 'active'>, OrganizationsProseKey> = {
    pending_verification: 'moderation.account.pendingVerification',
    blocked: 'moderation.account.blocked',
    rejected: 'moderation.account.rejected',
  };
  return organizationsProse(translate, key[status], language);
}

/** The checkout preflight's `reason`, for any status that is not `active`. */
export async function describeCheckoutRefusal(
  translate: OrganizationsTranslate | undefined,
  status: string,
  language: SupportedLanguage,
): Promise<string> {
  const key: OrganizationsProseKey =
    status === 'pending_verification'
      ? 'moderation.checkout.pendingVerification'
      : status === 'blocked'
        ? 'moderation.checkout.blocked'
        : status === 'rejected'
          ? 'moderation.checkout.rejected'
          : 'moderation.checkout.unavailable';
  return organizationsProse(translate, key, language);
}
