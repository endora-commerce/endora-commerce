import { describe, it, expect } from 'vitest';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.generated.js';
import {
  assertTransitiveParentsResolve,
  resolveTransitiveParent,
  tenantClassifications,
} from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 080, T049 (D-169) — the committed platform's tenancy chains resolve.
 *
 * The refusal in `org-scoped.decorator.ts` fires at boot, out of
 * `db/configured-entities.ts`, over the entity set the ORM is about to be
 * configured with. That is the honest place for it — it is the first moment
 * every entity class is loaded, and it covers an installed package's entities
 * as well as the committed ones — but it needs a running boot, and the fast
 * unit suite has none. This file asks the same question of the same registry
 * with no database and no ORM: importing the committed entity registry runs
 * every classification decorator, and the reconciliation then has the whole
 * core population to work over.
 *
 * So a merge request that renames `Order`, deletes `Invoice` or misspells a
 * parent name fails here, in the suite that runs on every backend merge
 * request, rather than at the next boot.
 *
 * It asserts nothing *into* the registry, deliberately: the registry is a
 * module-level singleton, and a fixture written here would be indistinguishable
 * from a real misclassification. The fixtures live in
 * `transitive-parent-resolution.test.ts`, which makes no claim about the real
 * platform.
 */
describe('the committed platform’s transitive tenancy chains', () => {
  it('registers a classification for every committed entity', () => {
    // The vacuous-pass guard: everything below is a filter over the registry,
    // and an empty registry would satisfy all of it.
    expect(ALL_ENTITIES.length).toBeGreaterThan(100);
    const classified = new Set(tenantClassifications().map((meta) => meta.target as unknown));
    expect(ALL_ENTITIES.filter((entity) => !classified.has(entity as unknown))).toEqual([]);
  });

  it('resolves every @TransitivelyScoped parent name', () => {
    expect(() => assertTransitiveParentsResolve()).not.toThrow();
  });

  it('walks the two chains the platform actually has', () => {
    const transitive = tenantClassifications().filter((meta) => meta.scope === 'transitive');
    // Two, and the count is asserted so that a third arriving is read here
    // rather than inherited silently by a `find`.
    expect(transitive.map((meta) => meta.className).sort()).toEqual(['Invoice', 'KsefSubmission']);

    const invoice = transitive.find((meta) => meta.className === 'Invoice');
    const submission = transitive.find((meta) => meta.className === 'KsefSubmission');
    expect(invoice).toMatchObject({ parentClassName: 'Order', fk: 'orderId' });
    expect(submission).toMatchObject({ parentClassName: 'Invoice', fk: 'invoiceId' });

    // KsefSubmission -> Invoice -> Order, and Order carries the org column.
    const middle = resolveTransitiveParent(submission!);
    expect(middle.className).toBe('Invoice');
    const root = resolveTransitiveParent(middle);
    expect(root).toMatchObject({ className: 'Order', scope: 'org', key: 'organizationId' });
  });
});
