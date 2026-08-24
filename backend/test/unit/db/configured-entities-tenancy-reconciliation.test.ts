import { describe, it, expect } from 'vitest';
import { configuredEntities } from '../../../src/db/configured-entities.js';
import {
  TransitivelyScoped,
  UnresolvableTenantParentError,
} from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 080, T049 (D-169) — the boot seam refuses a tenancy chain that does
 * not resolve.
 *
 * `transitive-parent-resolution.test.ts` proves the refusal itself; this proves
 * it is *wired*, which is a separate claim and the one that goes stale. Deleting
 * the `assertTransitiveParentsResolve()` call from `configured-entities.ts`
 * leaves every assertion in that file green, and leaves the platform booting
 * with an entity that has no reachable tenant predicate (Principle XI,
 * non-negotiable).
 *
 * The fixture enters at the decorator, as it does there: the record under test
 * is the one `@TransitivelyScoped` wrote. It poisons the module-level registry,
 * so this file makes no other claim and lives alone.
 */
describe('configuredEntities reconciles the tenancy chains', () => {
  it('refuses to configure the ORM when a parent name resolves to nothing', async () => {
    @TransitivelyScoped('AnEntityThisPlatformDoesNotHave', 'phantomId')
    class EntityWithNoReachableTenant {}
    void EntityWithNoReachableTenant;

    await expect(configuredEntities()).rejects.toThrow(UnresolvableTenantParentError);
    await expect(configuredEntities()).rejects.toThrow(/EntityWithNoReachableTenant/);
    await expect(configuredEntities()).rejects.toThrow(/AnEntityThisPlatformDoesNotHave/);
  });
});
