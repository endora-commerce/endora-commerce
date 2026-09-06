/**
 * The module-id collision rule, at the path its eight consumers already name.
 *
 * The rule itself is `@endora-commerce/platform/lifecycle`'s
 * (`packages/platform/src/lifecycle/services/module-id-claims.ts`) since feature
 * 115 Phase 3: it names no path in the tree that installs the platform — no
 * disk, no environment, no layout — so `contracts/operator-half.md` §1 puts it
 * in the platform, and the three-way merge that assembles the claim set from
 * core, the overlay and the installed packages moved there in the same phase.
 *
 * This file is the binding, not a shim over a build directory: the specifier is
 * **bare**, so it resolves in a client instance exactly as it does here, and it
 * is not a `RELATIVE_HOST_REACHES` reach. It keeps the path so that
 * `package-runtime.ts`, `overlay-runtime.ts`, `claimed-module-ids.ts`, this
 * directory's barrel and the four tests that name it change nothing — the same
 * property that makes the manifest registry's own move a one-file edit.
 */
export {
  assertNoModuleIdCollisions,
  moduleIdCollisions,
  ModuleIdCollisionError,
  type ModuleIdClaim,
  type ModuleIdClaimOrigin,
  type ModuleIdCollision,
} from '@endora-commerce/platform/lifecycle';
