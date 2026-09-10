/**
 * The ambient tenant scope every test in this package runs inside
 * (`specs/110-instance-repository/`, T119a).
 *
 * This is `backend/test/tenancy-setup.ts` translated, not reinvented: feature
 * 050 established a `system` TenantContext around every backend test's setup
 * and body so that direct `EntityManager` seeding and direct-service tests do
 * not each have to wrap themselves in `withSystemScope`. The tests that moved
 * into this package were written under that harness and four of them *observe*
 * it — `runWithoutTenantContext` can only be shown to clear and restore a
 * caller's context if there is a caller context to clear.
 *
 * It is a setup file rather than a `beforeEach` in the four files that notice,
 * for the reason the backend's is one: the precondition belongs to the run, and
 * a per-file copy is a precondition the fifty-first file will not have. The
 * `enterWith` runs inside each test's own async context — a module-load call
 * would not propagate.
 *
 * The specifiers are relative, and that is this whole task's point: a test
 * inside the package names its subject directly instead of asking the barrels
 * for an address (D-160.8).
 */
import { beforeAll, beforeEach } from 'vitest';

import { systemTenantContext } from './src/tenancy/resolve-tenant-context.js';
import { enterTenantContext } from './src/tenancy/tenant-context.js';

const applyDefault = (): void => {
  enterTenantContext(systemTenantContext('platform-package test default scope'));
};

beforeAll(applyDefault);
beforeEach(applyDefault);
