/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/lib` (feature 091, P3).
 *
 * The one predicate for *"may this operator see this destination at all"* (issue #230).
 * It moved with `useAuth` and `useModulePresence` because it reads both: any one of the
 * cluster crossing into the package takes the other two with it, which is why P3 is one
 * merge request and not four.
 *
 * **The forwarding is the identity, not a copy** —
 * `admin/test/kit/admin-kit-identity.test.ts` asserts it by reference.
 */
export { isSurfaceVisible, satisfiesPermission, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
export type { GatedSurface, PermissionRequirement } from '@endora-commerce/admin-kit/lib';
