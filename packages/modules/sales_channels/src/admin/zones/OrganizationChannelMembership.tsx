import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { EntityChannelMembership } from '../components/EntityChannelMembership.js';

/**
 * The channels an organization belongs to (feature 091, P7b).
 *
 * `organizations`' `OrganizationDetail.tsx` used to import
 * `EntityChannelMembership` by path and render it with
 * `entityType="organization"` — one of the three keys of
 * `backend/scripts/ledgers/cross-module-imports/organizations.ts`. The place is
 * `organization.detail.after` now, and the `entityType` is *this module's*
 * constant: an organization's detail screen is the only thing it could be.
 *
 * **Two contributions over one component, not one contribution with a `match`**
 * (Z4, Z13). This wrapper and `ProductChannelMembership` differ only in the
 * `entityType` they pass, and that is the whole cost of `organization.detail.after`
 * and `product.editor.channels` being two places rather than one name narrowed
 * per mount.
 *
 * **No `match`, and it is a decision rather than an omission.** This place has
 * one host and one mount, so there is nothing to narrow.
 * `admin/test/modules/sales_channels/organization-channels-zone.test.tsx`
 * asserts it absent so a later author cannot add one quietly.
 *
 * The host used to pass no `onChanged`, and neither does this: the panel's own
 * refresh is what the operator sees, and a zone has no callback to give it.
 */
export type OrganizationChannelMembershipProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationChannelMembership({
  organizationId,
}: OrganizationChannelMembershipProps): ReactNode {
  return <EntityChannelMembership entityType="organization" entityId={organizationId} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrganizationChannelMembership;
