import { describe, expect, it } from 'vitest';
import type { PlannedRow } from './price-book-rules.js';
import { baseRowChanges, createdHeaderValues, headerValueChange } from './price-book-value-changes.js';

/**
 * Issue #470 (D-288; owner ruling O-3), Stage 2 — the pure steps of a price
 * book's price-change history: which header values a Command changed, and
 * which rows a base-price write added, changed or removed.
 */

const P = '00000000-0000-4000-8000-000000000005';
const VR = '00000000-0000-4000-8000-0000000005a1';
const ORG_A = '00000000-0000-4000-8000-00000000a0a1';
const ORG_B = '00000000-0000-4000-8000-00000000a0b1';

const row = (over: Partial<PlannedRow> = {}): PlannedRow => ({
  variantId: null,
  productId: P,
  categoryId: null,
  attributeKey: null,
  attributeValue: null,
  minQuantity: 1,
  maxQuantity: null,
  priceType: 'fixed',
  amount: '10.0000',
  percent: null,
  ...over,
});

describe('headerValueChange', () => {
  const was = { name: 'Contract', priority: 10, audienceKind: 'organizations' as const, memberIds: [ORG_A] };

  it('holds only the header values that changed, on both sides, the audience as its kind and sorted members', () => {
    expect(headerValueChange(was, { name: 'Contract 2' })).toEqual({
      before: { name: 'Contract' },
      after: { name: 'Contract 2' },
    });
    expect(headerValueChange(was, { priority: 20, audienceKind: 'organizations', memberIds: [ORG_B, ORG_A] })).toEqual({
      before: { priority: 10, audience: { kind: 'organizations', memberIds: [ORG_A] } },
      after: { priority: 20, audience: { kind: 'organizations', memberIds: [ORG_A, ORG_B].sort() } },
    });
  });

  // #470 stage 3, ruling 7 (amends stage 2): a kind change is an audience change
  // even when the member set stays the same, so a reader can tell whom the ids name.
  it('records the audience when only its kind changes', () => {
    const never = { name: 'x', priority: 0, audienceKind: 'customer_groups' as const, memberIds: [] };
    expect(headerValueChange(never, { audienceKind: 'organizations', memberIds: [] })).toEqual({
      before: { audience: { kind: 'customer_groups', memberIds: [] } },
      after: { audience: { kind: 'organizations', memberIds: [] } },
    });
  });

  it('is null when no value moved: the same name, priority, kind and member set in another order', () => {
    expect(headerValueChange(was, {})).toBeNull();
    expect(headerValueChange(was, { name: 'Contract', priority: 10, audienceKind: 'organizations', memberIds: [ORG_A] })).toBeNull();
    const two = { name: 'x', priority: 0, audienceKind: 'organizations' as const, memberIds: [ORG_B, ORG_A] };
    expect(headerValueChange(two, { audienceKind: 'organizations', memberIds: [ORG_A, ORG_B] })).toBeNull();
  });
});

describe('createdHeaderValues', () => {
  it('is the whole header of a created book, the audience with its kind and sorted members, with a duplicate’s multiplier', () => {
    expect(createdHeaderValues({ name: 'New', priority: 5, audienceKind: 'organizations', memberIds: [ORG_B, ORG_A] })).toEqual({
      name: 'New',
      priority: 5,
      audience: { kind: 'organizations', memberIds: [ORG_A, ORG_B].sort() },
    });
    expect(
      createdHeaderValues({ name: 'Copy', priority: 0, audienceKind: 'everyone', memberIds: [], amountMultiplier: '1.1' }),
    ).toEqual({
      name: 'Copy',
      priority: 0,
      audience: { kind: 'everyone', memberIds: [] },
      amountMultiplier: '1.1',
    });
  });
});

describe('baseRowChanges', () => {
  it('pairs a removed and an inserted row of the same coordinate as one change, keeping sub-cent amounts', () => {
    const plan = baseRowChanges(
      [row({ minQuantity: 1, maxQuantity: 9, amount: '0.0125' }), row({ minQuantity: 10, amount: '0.0100' })],
      [row({ minQuantity: 1, maxQuantity: 9, amount: '0.0130' }), row({ minQuantity: 20, amount: '0.0090' })],
    );
    expect(plan.changed).toEqual([
      { before: expect.objectContaining({ minQuantity: 1, amount: '0.0125' }), after: expect.objectContaining({ minQuantity: 1, amount: '0.0130' }) },
    ]);
    expect(plan.removed).toEqual([expect.objectContaining({ minQuantity: 10, amount: '0.0100' })]);
    expect(plan.added).toEqual([expect.objectContaining({ minQuantity: 20, amount: '0.0090' })]);
  });

  it('tells a variant row from the product row at the same window, and a moved end from a change', () => {
    const plan = baseRowChanges(
      [row({ variantId: VR, priceType: 'percent', amount: null, percent: '10.00' }), row({ maxQuantity: 9 })],
      [row({ variantId: VR, priceType: 'amount', amount: '-2.0000', percent: null }), row({ maxQuantity: null })],
    );
    expect(plan.changed).toEqual([
      {
        before: expect.objectContaining({ variantId: VR, priceType: 'percent', percent: '10.00' }),
        after: expect.objectContaining({ variantId: VR, priceType: 'amount', amount: '-2.0000' }),
      },
    ]);
    expect(plan.removed).toEqual([expect.objectContaining({ variantId: null, maxQuantity: 9 })]);
    expect(plan.added).toEqual([expect.objectContaining({ variantId: null, maxQuantity: null })]);
  });

  it('is empty when nothing was removed or inserted', () => {
    expect(baseRowChanges([], [])).toEqual({ added: [], changed: [], removed: [] });
  });
});
