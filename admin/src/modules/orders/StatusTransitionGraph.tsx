/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, batch 8).
 *
 * `returns`' status-workflow screen rendered `orders`' graph, which
 * `backend/scripts/ledgers/cross-module-imports/returns.ts` recorded with the
 * retiring condition this satisfies: the component takes data in and callbacks
 * out, holds no `orders` vocabulary, and is `admin-component-contribution.md`
 * Z1 question 1 — a published component, never a zone contribution.
 *
 * **The `t` prop is gone.** Both callers passed `useTranslation('core')` and the
 * component read `orderStatusConfig.*` out of it, so the prop carried the
 * component's own copy through the caller. It resolves those keys itself now,
 * out of `core`, which is the namespace they were already in (R-1).
 *
 * **The forwarding is the identity, not a copy** —
 * `admin/test/kit/admin-kit-identity.test.ts` asserts reference equality.
 */
export { StatusTransitionGraph } from '@endora-commerce/admin-kit/components';
export type {
  StatusTransitionGraphProps,
  StatusTransitionGraphStatus,
  StatusTransitionGraphTransition,
} from '@endora-commerce/admin-kit/components';
