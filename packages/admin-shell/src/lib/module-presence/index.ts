/**
 * Re-export shim — this directory's implementation now lives in
 * `@endora-commerce/admin-kit/lib` (feature 091, P3).
 *
 * The effective enabled-set as the server computed it (feature 073, FR-031). Constitution
 * XVII makes every admin surface ask it, packaged surfaces included, so it is the kit's;
 * `useSurfaceVisibility` reads it and moved in the same merge request.
 *
 * A **directory** shim: every consumer names `@/lib/module-presence` or
 * `../lib/module-presence/index.js`, and both arrive here. Nothing named
 * `ModulePresenceProvider.js` or `api.js` directly, so those two files moved without a
 * shim of their own.
 *
 * **The forwarding is the identity, not a copy** —
 * `admin/test/kit/admin-kit-identity.test.ts` asserts it by reference.
 */
export { getModulePresence, ModulePresenceProvider, setModuleActivation, useModulePresence } from '@endora-commerce/admin-kit/lib';
export type { ModulePresenceContextValue, ModulePresenceProviderProps } from '@endora-commerce/admin-kit/lib';
