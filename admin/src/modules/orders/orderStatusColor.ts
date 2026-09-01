/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/lib` (feature 091, batch 8).
 *
 * `returns`' list rendered its own status badges with `orderStatusBadgeStyle`,
 * which `backend/scripts/ledgers/cross-module-imports/returns.ts` recorded with
 * the retiring condition this satisfies: *"the helper is generic and moves into
 * the kit"*. It is — two pure functions over a hex string that cannot tell an
 * order status from a return status.
 *
 * **The published name is `statusBadgeStyle`.** A kit symbol named after a
 * module is R6's rule wearing a different hat, and the caller that made the
 * generality visible is `returns`. `orders`' own four call sites keep the old
 * spelling through this alias rather than being rewritten for a rename that is
 * not about them.
 *
 * The two colour constants are `@endora-commerce/contracts`' and are forwarded
 * from there, exactly as they were before the move: the kit does not re-export
 * them, because a second name for one constant is two things that can disagree.
 */
export { ORDER_STATUS_COLOR_PRESETS, ORDER_STATUS_DEFAULT_COLOR } from '@endora-commerce/contracts';
export {
  readableTextColor,
  statusBadgeStyle,
  statusBadgeStyle as orderStatusBadgeStyle,
} from '@endora-commerce/admin-kit/lib';
