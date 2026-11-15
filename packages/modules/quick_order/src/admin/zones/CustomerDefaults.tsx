import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { INERT_SAVE_SESSION } from '@endora-commerce/admin-kit/lib';
import { DefaultPreferencesPanel } from '../components/DefaultPreferencesPanel.js';

/**
 * The customer's default ordering preferences (feature 091, P7b).
 *
 * `customers`' `CustomerDetail.tsx` used to import `DefaultPreferencesPanel` by
 * path and pass `scope="customer"` — the single key of
 * `backend/scripts/ledgers/cross-module-imports/customers.ts`, whose shard this
 * contribution deletes. The place is `customer.detail.after` now and the scope
 * is *this module's* constant.
 *
 * The twin of `OrganizationDefaults`, and deliberately a second file rather
 * than a `match` on one shared member — see the note there.
 *
 * **No `match`, and it is a decision rather than an omission.** This place has
 * one host and one mount, so there is nothing to narrow.
 * `admin/test/modules/quick_order/quick-order-zones.test.tsx` asserts it absent
 * so a later author cannot add one quietly.
 */
export type CustomerDefaultsProps = AdminZoneProps<'customer.detail.after'>;

export function CustomerDefaults({ customerId, saveSession }: CustomerDefaultsProps): ReactNode {
  // Feature 180 — the customer detail's Save writes the defaults once that screen runs a session
  // (WP-8, #1241). While it still hands the inert handle the panel keeps its own Save: forwarding
  // the inert handle would leave the defaults with no way to be saved. That guard goes with the
  // standalone branch once every host passes a live session.
  return (
    <DefaultPreferencesPanel
      scope="customer"
      scopeId={customerId}
      {...(saveSession === INERT_SAVE_SESSION ? {} : { saveSession })}
    />
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default CustomerDefaults;
