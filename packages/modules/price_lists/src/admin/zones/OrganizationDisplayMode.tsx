import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { Card, CardContent } from '@endora-commerce/admin-kit/ui';
import { DisplayModeOverrideRow } from '../components/DisplayModeOverrideRow.js';

/**
 * The organization detail screen's price-display-mode override (feature 091,
 * P7b).
 *
 * `organizations`' `OrganizationDetail.tsx` used to import
 * `DisplayModeOverrideRow` by path and wrap it in a card of its own, handing it
 * `organizations.detail.pricingLabel` and `organizations.detail.pricingHint`.
 * The place is `organization.detail.after` now, and the scope is *this
 * module's* constant, because the host mounting an organization detail is the
 * only thing that could have said `'organization'`.
 *
 * **The card is the contribution's and not the host's**, which is the one
 * layout decision this wrapper makes. The zone is a stack of panels and the
 * other three contributors each render a `Card`; a bare row between them would
 * read as a rendering failure. The host cannot wrap the zone in one card
 * instead, because that would nest four cards inside a fifth. What went with
 * the host's card is its heading — `organizations.detail.pricingCard` — for
 * `DisplayModeOverrideRow`'s own reason: a host cannot title a contributor it
 * does not know, and the row already labels its control.
 *
 * **No `match`, and it is a decision rather than an omission.** `match` narrows
 * the mounts of one place (Z13); this place has one host and one mount, so
 * there is nothing to narrow.
 * `admin/test/modules/price_lists/price-lists-zones.test.tsx` asserts it absent
 * so a later author cannot add one quietly.
 */
export type OrganizationDisplayModeProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationDisplayMode({
  organizationId,
}: OrganizationDisplayModeProps): ReactNode {
  return (
    <Card className="mb-4">
      <CardContent>
        <DisplayModeOverrideRow scope="organization" targetId={organizationId} />
      </CardContent>
    </Card>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrganizationDisplayMode;
