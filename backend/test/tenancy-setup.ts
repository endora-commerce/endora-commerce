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
 */
import { beforeAll, beforeEach } from 'vitest';
import { enterTenantContext } from '../src/tenancy/tenant-context.js';
import { systemTenantContext } from '@endora-commerce/platform/composition';

const applyDefault = (): void => {
  enterTenantContext(systemTenantContext('test-harness default scope'));
};

beforeAll(applyDefault);
beforeEach(applyDefault);
