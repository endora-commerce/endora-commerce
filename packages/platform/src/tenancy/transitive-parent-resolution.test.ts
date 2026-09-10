import { describe, it, expect } from 'vitest';
import {
  TransitivelyScoped,
  OrgScoped,
  GlobalEntity,
  tenantClassifications,
  resolveTransitiveParent,
  assertTransitiveParentsResolve,
  UnresolvableTenantParentError,
  type ClassificationMeta,
} from './org-scoped.decorator.js';

/**
 * Feature 080, T049 (D-169) — `@TransitivelyScoped` names its parent by class
 * name, so a child entity can express a Principle XI tenancy chain into a module
 * it does not import.
 *
 * **Every fixture enters at the decorator**, which is the top of the analysis:
 * the record under test is the one the decorator wrote, never one this file
 * built by hand. A test that constructed a `ClassificationMeta` literal and
 * handed it to the resolver would prove the resolver reads its own argument and
 * nothing about what the decorator records.
 *
 * This file **poisons the module-level registry on purpose** — that is what an
 * unresolvable parent is — so it makes no assertion about the real platform's
 * chains. Those live in `transitive-parent-chains.test.ts`, which reads the
 * registry the committed entity list fills and asserts nothing into it.
 */

/** The record the decorator wrote for `target`, or a failure that says so. */
function metaFor(target: unknown): ClassificationMeta {
  const found = tenantClassifications().find((meta) => (meta.target as unknown) === target);
  if (!found) throw new Error('the decorator recorded nothing for this class');
  return found;
}

describe('@TransitivelyScoped records a parent class name, not a class', () => {
  it('stores the name it was given', () => {
    @TransitivelyScoped('NamedParent', 'namedParentId')
    class RecordsItsParentByName {}

    expect(metaFor(RecordsItsParentByName)).toMatchObject({
      className: 'RecordsItsParentByName',
      scope: 'transitive',
      parentClassName: 'NamedParent',
      fk: 'namedParentId',
    });
  });

  it('resolves a parent registered AFTER the child', () => {
    // Entity classes register in import order and a child may be imported first,
    // so resolution has to be lazy. Decorating in this order is the measurement:
    // if the decorator resolved eagerly, the child would already have failed.
    @TransitivelyScoped('LateParent', 'lateParentId')
    class EarlyChild {}

    @OrgScoped()
    class LateParent {}

    const parent = resolveTransitiveParent(metaFor(EarlyChild));
    expect(parent.target).toBe(LateParent);
    expect(parent.scope).toBe('org');
  });

  it('resolves a parent registered BEFORE the child', () => {
    @OrgScoped()
    class EarlyParent {}

    @TransitivelyScoped('EarlyParent', 'earlyParentId')
    class LateChild {}

    expect(resolveTransitiveParent(metaFor(LateChild)).target).toBe(EarlyParent);
  });

  it('resolves through a parent that is itself transitively scoped', () => {
    // The real chain has two hops: KsefSubmission -> Invoice -> Order.
    @OrgScoped()
    class ChainRoot {}

    @TransitivelyScoped('ChainRoot', 'chainRootId')
    class ChainMiddle {}

    @TransitivelyScoped('ChainMiddle', 'chainMiddleId')
    class ChainLeaf {}

    const middle = resolveTransitiveParent(metaFor(ChainLeaf));
    expect(middle.target).toBe(ChainMiddle);
    expect(resolveTransitiveParent(middle).target).toBe(ChainRoot);
  });
});

describe('an unresolvable parent refuses, and never substitutes', () => {
  it('throws for a name no classified entity carries', () => {
    @TransitivelyScoped('NoSuchEntityAnywhere', 'ghostId')
    class ChildOfAGhost {}

    const meta = metaFor(ChildOfAGhost);
    expect(() => resolveTransitiveParent(meta)).toThrow(UnresolvableTenantParentError);
    // The message has to name all three, or the operator reading a failed boot
    // cannot tell which decorator to open.
    expect(() => resolveTransitiveParent(meta)).toThrow(/ChildOfAGhost/);
    expect(() => resolveTransitiveParent(meta)).toThrow(/NoSuchEntityAnywhere/);
    expect(() => resolveTransitiveParent(meta)).toThrow(/ghostId/);
  });

  it('does not fall back to an unscoped or org-scoped entity', () => {
    // The failure this refusal exists to prevent: a chain that stops resolving
    // and quietly binds to whatever else is in the registry. Both a global and
    // an org-scoped entity are present and neither may be chosen.
    @GlobalEntity()
    class SomeGlobalThing {}

    @OrgScoped()
    class SomeOrgThing {}

    @TransitivelyScoped('AbsentParentName', 'absentId')
    class WouldRatherRefuse {}

    let resolved: ClassificationMeta | undefined;
    let thrown: unknown;
    try {
      resolved = resolveTransitiveParent(metaFor(WouldRatherRefuse));
    } catch (error) {
      thrown = error;
    }
    expect(resolved).toBeUndefined();
    expect(thrown).toBeInstanceOf(UnresolvableTenantParentError);
    expect(tenantClassifications().map((m) => m.target)).toContain(SomeGlobalThing);
    expect(tenantClassifications().map((m) => m.target)).toContain(SomeOrgThing);
  });

  it('refuses an ambiguous name rather than picking one', () => {
    // MikroORM refuses two entities with one class name at discovery, so this
    // cannot arise from the committed tree. It can arise from a fixture, from an
    // installed package's entity, or from a class that is classified and not an
    // entity — and picking the first match would be the same silence.
    const twins = [
      (() => {
        @OrgScoped()
        class AmbiguousTwin {}
        return AmbiguousTwin;
      })(),
      (() => {
        @GlobalEntity()
        class AmbiguousTwin {}
        return AmbiguousTwin;
      })(),
    ];
    expect(twins[0]).not.toBe(twins[1]);

    @TransitivelyScoped('AmbiguousTwin', 'twinId')
    class ChildOfTwins {}

    expect(() => resolveTransitiveParent(metaFor(ChildOfTwins))).toThrow(
      UnresolvableTenantParentError,
    );
    expect(() => resolveTransitiveParent(metaFor(ChildOfTwins))).toThrow(/2/);
  });

  it('refuses a classification that is not transitive at all', () => {
    @OrgScoped()
    class NotTransitive {}

    expect(() => resolveTransitiveParent(metaFor(NotTransitive))).toThrow(
      UnresolvableTenantParentError,
    );
  });
});

describe('the reconciliation over the whole registry', () => {
  it('names every unresolvable chain, not just the first', () => {
    @TransitivelyScoped('FirstMissingParent', 'firstId')
    class FirstOrphan {}

    @TransitivelyScoped('SecondMissingParent', 'secondId')
    class SecondOrphan {}

    let message = '';
    try {
      assertTransitiveParentsResolve();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/FirstOrphan/);
    expect(message).toMatch(/SecondOrphan/);
    expect(message).toMatch(/FirstMissingParent/);
    expect(message).toMatch(/SecondMissingParent/);
    // Both fixtures are real registry rows, so the classes exist.
    expect(metaFor(FirstOrphan).scope).toBe('transitive');
    expect(metaFor(SecondOrphan).scope).toBe('transitive');
  });
});
