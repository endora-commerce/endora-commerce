import { describe, expect, it } from 'vitest';
import type { RuleCriterionType } from '@b2b/contracts';
import {
  pickPriorityChain,
  tieBreak,
  type PriceListCandidate,
} from '../../../src/modules/price_lists/services/price-list-resolver.js';

function makeCandidate(
  id: string,
  explicitOn: RuleCriterionType[],
  modifiedAt: Date,
  name: string = id,
  isSystem = false,
): PriceListCandidate<string> {
  return {
    list: id,
    evaluation: { matched: true, explicitOn: new Set(explicitOn) },
    modifiedAt,
    name,
    isSystem,
  };
}

const T0 = new Date('2026-01-01T00:00:00Z');
const T1 = new Date('2026-02-01T00:00:00Z');
const T2 = new Date('2026-03-01T00:00:00Z');

describe('pickPriorityChain (T062)', () => {
  it('returns null on empty input', () => {
    expect(pickPriorityChain([])).toBeNull();
  });

  it('Organization explicit beats Customer Group, Category, Sales Channel, and "other"', () => {
    const candidates = [
      makeCandidate('L_org', ['organization'], T0),
      makeCandidate('L_cg', ['customerGroup'], T2),
      makeCandidate('L_cat', ['category'], T2),
      makeCandidate('L_sc', ['salesChannel'], T2),
      makeCandidate('L_other', [], T2, 'L_other', true),
    ];
    expect(pickPriorityChain(candidates)?.list).toBe('L_org');
  });

  it('falls through to Customer Group when no list is Organization-explicit', () => {
    const candidates = [
      makeCandidate('L_cg', ['customerGroup'], T0),
      makeCandidate('L_cat', ['category'], T2),
      makeCandidate('L_other', [], T2, 'L_other', true),
    ];
    expect(pickPriorityChain(candidates)?.list).toBe('L_cg');
  });

  it('falls through to Category, then Sales Channel, then any other', () => {
    expect(
      pickPriorityChain([
        makeCandidate('L_cat', ['category'], T0),
        makeCandidate('L_sc', ['salesChannel'], T2),
        makeCandidate('L_other', [], T2),
      ])?.list,
    ).toBe('L_cat');
    expect(
      pickPriorityChain([
        makeCandidate('L_sc', ['salesChannel'], T0),
        makeCandidate('L_other', [], T2),
      ])?.list,
    ).toBe('L_sc');
    expect(
      pickPriorityChain([
        makeCandidate('Default', [], T0, 'Default', true),
        makeCandidate('L_other', [], T1, 'L_other'),
      ])?.list,
    ).toBe('L_other'); // tie-break by modifiedAt (later wins)
  });

  it('tie-break: most recent modifiedAt wins at every step', () => {
    const candidates = [
      makeCandidate('A_old', ['organization'], T0, 'A'),
      makeCandidate('B_new', ['organization'], T2, 'B'),
    ];
    expect(pickPriorityChain(candidates)?.list).toBe('B_new');
  });

  it('tie-break: lexicographic name when modifiedAt ties', () => {
    const candidates = [
      makeCandidate('Bravo', ['organization'], T1, 'Bravo'),
      makeCandidate('Alpha', ['organization'], T1, 'Alpha'),
    ];
    expect(pickPriorityChain(candidates)?.list).toBe('Alpha');
  });

  it('Currency-explicit alone does not earn a priority boost (currency is not in the chain)', () => {
    const candidates = [
      makeCandidate('L_currency_only', ['currency'], T0, 'X'),
      makeCandidate('L_other', [], T2, 'Other'),
    ];
    // Both fall to step 5 ("any other matching list"); modifiedAt tie-break
    // picks `L_other` because it was modified later.
    expect(pickPriorityChain(candidates)?.list).toBe('L_other');
  });

  it('determinism: same input always produces the same picked list', () => {
    const candidates = [
      makeCandidate('A', ['organization'], T1, 'A'),
      makeCandidate('B', ['organization'], T1, 'B'),
      makeCandidate('C', ['organization'], T1, 'C'),
    ];
    for (let i = 0; i < 1000; i++) {
      expect(pickPriorityChain(candidates)?.list).toBe('A');
    }
  });
});

describe('tieBreak (T062)', () => {
  it('most recent modifiedAt first', () => {
    expect(
      tieBreak([
        makeCandidate('old', [], T0),
        makeCandidate('new', [], T2),
      ]).list,
    ).toBe('new');
  });

  it('lexicographic name when modifiedAt ties', () => {
    expect(
      tieBreak([
        makeCandidate('B', [], T1, 'B'),
        makeCandidate('A', [], T1, 'A'),
      ]).list,
    ).toBe('A');
  });
});
