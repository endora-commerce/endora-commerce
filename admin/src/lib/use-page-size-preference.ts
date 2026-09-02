/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/lib` (feature 091, P3).
 *
 * Phase 1b split `PAGE_SIZE_OPTIONS` into the kit and left the hook here, because the
 * hook reads the signed-in admin's id to key its `localStorage` entry. That id comes from
 * `useAuth`, which the kit publishes now, so the split has nothing left to separate.
 * `PAGE_SIZE_OPTIONS` is forwarded from here too, because every existing caller names it
 * at this path.
 *
 * **The forwarding is the identity, not a copy** —
 * `admin/test/kit/admin-kit-identity.test.ts` asserts it by reference.
 */
export { PAGE_SIZE_OPTIONS, usePageSizePreference } from '@endora-commerce/admin-kit/lib';
export type { PageSizeOption } from '@endora-commerce/admin-kit/lib';
