/**
 * Feature 050 — test harness default tenant scope.
 *
 * Establishes a `system` TenantContext around every test's setup/body so direct
 * EM seeding/cleanup (`em.create`, `em.nativeDelete`, direct-service tests) works
 * without wrapping each site in `withSystemScope`. Registered as global
 * `beforeAll`/`beforeEach` hooks so the `enterWith` runs inside each test's own
 * async context (a module-load `enterWith` would not propagate to the tests).
 *
 * This does NOT weaken request-path verification: the request pipeline's
 * onRequest hook wraps each request in `runInTenantContext(scopedCtx, ...)`,
 * nesting over (and overriding) this default for the request's duration. The
 * cross-tenant integration tests therefore still exercise the real scoped
 * context. Genuine fail-closed behavior is covered by the tenancy unit tests via
 * `runWithoutTenantContext`.
 *
 * **This file may not import `@endora-commerce/platform/composition`, and the
 * scope it enters is a literal for that reason alone.** A setup file is
 * evaluated before every test file's own module graph, so a module it imports
 * has its own imports bound before that file's `vi.mock` registrations exist —
 * and the composition barrel eagerly evaluates `compose-app.ts`, which binds
 * `loadModulePresence` out of the real lifecycle module. Naming it here makes
 * `composeApp` unmockable for the whole suite. It was named here, from
 * `specs/110-instance-repository/` T119b until this repair, and the presence
 * override two kernel integration files depend on stopped applying in silence:
 * a composition missing a module its own manifest declares required started
 * instead of refusing (issue #258). See `harness-tenant-scope.ts` for the value
 * and `test/unit/harness/setup-file-imports.test.ts` for the guard.
 */
import { beforeAll, beforeEach } from 'vitest';
import { enterTenantContext } from '../src/tenancy/tenant-context.js';
import { HARNESS_DEFAULT_SCOPE } from './harness-tenant-scope.js';

const applyDefault = (): void => {
  enterTenantContext(HARNESS_DEFAULT_SCOPE);
};

beforeAll(applyDefault);
beforeEach(applyDefault);
