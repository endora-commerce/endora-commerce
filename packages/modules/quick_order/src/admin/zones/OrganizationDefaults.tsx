import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { DefaultPreferencesPanel } from '../components/DefaultPreferencesPanel.js';

/**
 * The organization's default ordering preferences (feature 091, P7b).
 *
 * `organizations`' `OrganizationDetail.tsx` used to import
 * `DefaultPreferencesPanel` by path and pass `scope="organization"` — one of
 * the three keys of
 * `backend/scripts/ledgers/cross-module-imports/organizations.ts`. The place is
 * `organization.detail.after` now and the scope is *this module's* constant.
 *
 * **This wrapper and `CustomerDefaults` are the whole cost of Z13.** Under the
 * rejected shared `entity.detail.after` they would have been one contribution
 * and one `match`; under two members they are two four-line files, and in
 * exchange `unrendered-zone` answers per host instead of letting one host's
 * mount cover the other's absence.
 *
 * **No `match`, and it is a decision rather than an omission.** This place has
 * one host and one mount, so there is nothing to narrow.
 * `admin/test/modules/quick_order/quick-order-zones.test.tsx` asserts it absent
 * so a later author cannot add one quietly.
 */
export type OrganizationDefaultsProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationDefaults({ organizationId }: OrganizationDefaultsProps): ReactNode {
  return <DefaultPreferencesPanel scope="organization" scopeId={organizationId} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrganizationDefaults;
