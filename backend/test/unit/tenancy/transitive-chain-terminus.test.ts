import { describe, it, expect } from 'vitest';
import {
  TransitivelyScoped,
  OrgScoped,
  GlobalEntity,
  RuleScoped,
  assertTransitiveParentsResolve,
  UnresolvableTenantParentError,
} from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 080, T054(a) (D-170) — a transitive tenancy chain must terminate at a
 * classification that carries a tenant key.
 *
 * T049 proved each child's *immediate* parent resolves. That leaves three
 * silences, all of them the same failure with a different number of steps: a
 * `global` terminus passes, a cycle passes, and a chain of transitives that
 * reaches no keyed classification passes. In every one of them the entity is
 * reachable with no tenant predicate at all — Principle XI (non-negotiable)
 * defeated by an assertion that says the chain is fine.
 *
 * **Every fixture enters at the decorator** (issue #130): the records under test
 * are the ones `@TransitivelyScoped`, `@GlobalEntity` and friends wrote into the
 * real classification registry. A test that handed a hand-built
 * `ClassificationMeta` to the walk would prove the walk reads its argument and
 * nothing about what a decorator records.
 *
 * **Each test asserts the *kind* of its own finding**, not merely that something
 * threw: the reconciliation reports every broken chain at once, so four signals
 * could otherwise go blind behind the fifth's red.
 *
 * This file poisons the module-level registry on purpose, so it makes no claim
 * about the real platform's chains. Those live in
 * `transitive-parent-chains.test.ts`.
 */

/** The refusal's message, or a failure saying it did not refuse. */
function refusalMessage(): string {
  try {
    assertTransitiveParentsResolve();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('assertTransitiveParentsResolve() accepted the registry and should not have');
}

/**
 * The one finding about `className`.
 *
 * The reconciliation reports every chain in the registry and this file adds a
 * broken one per test, so a bare `toThrow(/…/)` would match a *previous* test's
 * fixture. Selecting the finding first is what makes each assertion below a
 * claim about its own shape.
 */
function findingFor(className: string): string {
  const findings = refusalMessage()
    .split('\n  - ')
    .filter((line) => line.includes(`${className} (fk `));
  expect(findings).toHaveLength(1);
  const [finding] = findings;
  if (finding === undefined) throw new Error(`no finding names ${className}`);
  return finding;
}

describe('a chain that terminates where no tenant can be read is refused', () => {
  it('refuses a `global` terminus', () => {
    @GlobalEntity()
    class GlobalTerminus {}

    @TransitivelyScoped('GlobalTerminus', 'globalTerminusId')
    class ChildOfAGlobal {}
    void [GlobalTerminus, ChildOfAGlobal];

    expect(() => assertTransitiveParentsResolve()).toThrow(UnresolvableTenantParentError);
    const finding = findingFor('ChildOfAGlobal');
    expect(finding).toMatch(/GlobalTerminus/);
    expect(finding).toMatch(/carries no tenant key/);
    expect(finding).toMatch(/'global'/);
    // The kind, and only this kind.
    expect(finding).not.toMatch(/cannot evaluate a rule/);
    expect(finding).not.toMatch(/is a cycle/);
  });

  it('refuses a `rule` terminus, and says what retires the refusal', () => {
    @RuleScoped()
    class RuleTerminus {}

    @TransitivelyScoped('RuleTerminus', 'ruleTerminusId')
    class ChildOfARule {}
    void [RuleTerminus, ChildOfARule];

    const finding = findingFor('ChildOfARule');
    expect(finding).toMatch(/RuleTerminus/);
    expect(finding).toMatch(/cannot evaluate a rule/);
    // D-170 gives the refusal a retiring condition; it belongs where the author
    // who hits it reads it, not only in the ruling.
    expect(finding).toMatch(/retires/);
    expect(finding).toMatch(/OrgScoped/);
    expect(finding).not.toMatch(/is a cycle/);
  });

  it('refuses a two-node cycle', () => {
    @TransitivelyScoped('CycleB', 'cycleBId')
    class CycleA {}

    @TransitivelyScoped('CycleA', 'cycleAId')
    class CycleB {}
    void [CycleA, CycleB];

    // Both members are transitive, so both are in the population and both are
    // reported — each walking its own chain back to itself.
    const finding = findingFor('CycleA');
    expect(finding).toMatch(/is a cycle/);
    expect(finding).toMatch(/CycleA -> CycleB -> CycleA/);
    expect(findingFor('CycleB')).toMatch(/CycleB -> CycleA -> CycleB/);
    expect(finding).not.toMatch(/carries no tenant key/);
  });

  it('refuses a longer cycle', () => {
    @TransitivelyScoped('LongCycleY', 'longCycleYId')
    class LongCycleX {}

    @TransitivelyScoped('LongCycleZ', 'longCycleZId')
    class LongCycleY {}

    @TransitivelyScoped('LongCycleX', 'longCycleXId')
    class LongCycleZ {}
    void [LongCycleX, LongCycleY, LongCycleZ];

    // No depth limit: the cycle guard is what terminates the walk, so a cycle of
    // three is caught by the same mechanism as one of two.
    expect(findingFor('LongCycleX')).toMatch(/LongCycleX -> LongCycleY -> LongCycleZ -> LongCycleX/);
    expect(findingFor('LongCycleX')).toMatch(/is a cycle/);
  });

  it('refuses a chain of transitives that reaches no keyed classification', () => {
    @GlobalEntity()
    class DeepGlobalTerminus {}

    @TransitivelyScoped('DeepGlobalTerminus', 'deepGlobalTerminusId')
    class DeepMiddle {}

    @TransitivelyScoped('DeepMiddle', 'deepMiddleId')
    class DeepLeaf {}
    void [DeepGlobalTerminus, DeepMiddle, DeepLeaf];

    // The proof that the walk is a walk: `DeepLeaf`'s immediate parent resolves
    // and is perfectly well classified, so a one-hop check accepts it.
    const finding = findingFor('DeepLeaf');
    expect(finding).toMatch(/DeepLeaf -> DeepMiddle -> DeepGlobalTerminus/);
    expect(finding).toMatch(/carries no tenant key/);
  });

  it('names the child whose chain breaks at a hop beyond its own parent', () => {
    @TransitivelyScoped('AbsentDeepParent', 'absentDeepParentId')
    class BrokenMiddle {}

    @TransitivelyScoped('BrokenMiddle', 'brokenMiddleId')
    class ChildOfABrokenMiddle {}
    void [BrokenMiddle, ChildOfABrokenMiddle];

    const finding = findingFor('ChildOfABrokenMiddle');
    expect(finding).toMatch(/ChildOfABrokenMiddle -> BrokenMiddle/);
    expect(finding).toMatch(/AbsentDeepParent/);
  });
});

describe('an `org` terminus is accepted at any depth', () => {
  it('accepts a four-hop chain and reports nothing about it', () => {
    @OrgScoped()
    class DeepOrgRoot {}

    @TransitivelyScoped('DeepOrgRoot', 'deepOrgRootId')
    class DeepOrgThird {}

    @TransitivelyScoped('DeepOrgThird', 'deepOrgThirdId')
    class DeepOrgSecond {}

    @TransitivelyScoped('DeepOrgSecond', 'deepOrgSecondId')
    class DeepOrgFirst {}
    void [DeepOrgRoot, DeepOrgThird, DeepOrgSecond, DeepOrgFirst];

    // A legitimate deep chain is not wrong for being deep (D-170: no depth
    // limit). The registry is poisoned by the tests above, so the claim is that
    // none of these three appears among the findings.
    const message = refusalMessage();
    expect(message).not.toMatch(/DeepOrgFirst \(fk /);
    expect(message).not.toMatch(/DeepOrgSecond \(fk /);
    expect(message).not.toMatch(/DeepOrgThird \(fk /);
  });
});
