/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/lib` (feature 091, P3).
 *
 * `useAuth` is what a screen calls to gate a control the signed-in operator may not use.
 * Phase 1b left it here, so a module package could not name it and sixteen packaged
 * modules rendered every control live to a read-only operator — who filled the form in
 * and got a 403 on save. P3 publishes it; the screen-side repairs are each owner's.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's own
 * bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference equality across
 * the seam, because a second React context passes every structural comparison and still
 * breaks at runtime — `useAuth` throws when its context is `null`, so a duplicate is a
 * blank screen rather than a subtle wrong answer.
 */
export { AuthProvider, useAuth } from '@endora-commerce/admin-kit/lib';
export type { AdminMe, AuthProviderProps } from '@endora-commerce/admin-kit/lib';
