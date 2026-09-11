/**
 * The tenant context `test/tenancy-setup.ts` establishes around every test.
 *
 * **It is a literal rather than a `systemTenantContext(...)` call, and that is
 * the point of this file.** `setupFiles` are evaluated before every test file's
 * own module graph, so anything a setup file imports has its imports bound
 * before that file's `vi.mock` registrations exist.
 * `systemTenantContext` is published on `@endora-commerce/platform/composition`,
 * whose barrel eagerly evaluates `composition/compose-app.ts` — which binds
 * `loadModulePresence` out of the real `lifecycle/index.ts`. A setup file that
 * names that barrel therefore makes `composeApp` unmockable for the whole
 * suite: `specs/110-instance-repository/` T119b moved this one import and the
 * presence override in `test/integration/kernel/required-module-absent.test.ts`
 * and `deactivated-boot.test.ts` stopped applying **silently**, which let a
 * composition missing a module its manifest declares required start instead of
 * refusing (issue #258).
 *
 * Publishing `systemTenantContext` on `./tenancy` is not the alternative:
 * `packages/platform/src/tenancy/index.ts` states in as many words that the
 * request-pipeline group is not module-facing and is deliberately off that
 * barrel, and this harness is not a module.
 *
 * The duplication is held to the original by
 * `test/unit/harness/setup-file-imports.test.ts`, which compares this value to
 * `systemTenantContext(reason)` — from a test file, where naming the barrel is
 * free — so the literal cannot drift from the constructor it stands in for.
 */
import type { TenantContext } from '../src/tenancy/tenant-context.js';

/**
 * Named apart from the context so the guard can hand the identical string to
 * `systemTenantContext` — `TenantContext['reason']` is optional, so reading it
 * back off the value would compare an argument the compiler cannot narrow.
 */
export const HARNESS_DEFAULT_SCOPE_REASON = 'test-harness default scope';

export const HARNESS_DEFAULT_SCOPE: TenantContext = {
  mode: 'system',
  actor: { kind: 'system' },
  reason: HARNESS_DEFAULT_SCOPE_REASON,
};
