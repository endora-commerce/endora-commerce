import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { CartApprovalPolicyPanel } from '../components/CartApprovalPolicyPanel.js';

/**
 * The organization's cart-approval policy (feature 091, P7b; §10.5).
 *
 * The place is `organization.detail.after`, and this contribution is the one in
 * the family that adds a surface rather than moving one: the panel behind it
 * existed, was imported by nothing, and the capability it drives has been on
 * the API since feature 027 with no screen anywhere.
 *
 * **`customers:manage`, and not `carts:read`.** The contribution declares the
 * code its own routes enforce, both of them — the panel is a toggle, and a
 * control whose only action 403s is worse than an absent control. This module's
 * `carts:read` opens the cart list and says nothing about an organization's
 * policy.
 *
 * **No `match`, and it is a decision rather than an omission.** `match` narrows
 * the mounts of one place (Z13); this place has one host and one mount.
 * `admin/test/modules/carts/cart-approval-policy-zone.test.tsx` asserts it
 * absent so a later author cannot add one quietly.
 */
export type CartApprovalPolicyProps = AdminZoneProps<'organization.detail.after'>;

export function CartApprovalPolicy({ organizationId }: CartApprovalPolicyProps): ReactNode {
  return <CartApprovalPolicyPanel organizationId={organizationId} />;
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default CartApprovalPolicy;
