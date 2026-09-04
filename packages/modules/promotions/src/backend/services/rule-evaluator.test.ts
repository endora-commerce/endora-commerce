import { describe, expect, it } from 'vitest';
import type { PromotionRule } from '@endora-commerce/contracts';
import {
  evaluatePromotionRule,
  type PromotionRuleContext,
} from './promotion-rule-evaluator.js';

function ctx(overrides: Partial<PromotionRuleContext> = {}): PromotionRuleContext {
  return {
    cartTotal: 0,
    paymentMethodCode: null,
    deliveryMethodCode: null,
    deliveryCountry: null,
    deliveryPostalCode: null,
    organizationId: null,
    customerGroupId: null,
    categoryIds: [],
    attributeValues: {},
    ...overrides,
  };
}

describe('evaluatePromotionRule', () => {
  it('matches the `all` node unconditionally', () => {
    expect(evaluatePromotionRule({ kind: 'all' }, ctx())).toBe(true);
  });

  it('compares cartTotal with numeric operators', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'builtin', key: 'cartTotal' },
      op: 'gte',
      values: [500],
    };
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 500 }))).toBe(true);
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 499.99 }))).toBe(false);
  });

  it('supports between on cartTotal', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'builtin', key: 'cartTotal' },
      op: 'between',
      values: [100, 200],
    };
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 150 }))).toBe(true);
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 201 }))).toBe(false);
  });

  it('matches payment method via in/notIn', () => {
    const inRule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'builtin', key: 'paymentMethod' },
      op: 'in',
      values: ['bank_transfer', 'card'],
    };
    expect(evaluatePromotionRule(inRule, ctx({ paymentMethodCode: 'card' }))).toBe(true);
    expect(evaluatePromotionRule(inRule, ctx({ paymentMethodCode: 'pickup' }))).toBe(false);
  });

  it('matches postal code prefix via startsWith', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'builtin', key: 'deliveryPostalCode' },
      op: 'startsWith',
      values: ['00-'],
    };
    expect(evaluatePromotionRule(rule, ctx({ deliveryPostalCode: '00-950' }))).toBe(true);
    expect(evaluatePromotionRule(rule, ctx({ deliveryPostalCode: '31-000' }))).toBe(false);
  });

  it('matches category set membership', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'builtin', key: 'category' },
      op: 'in',
      values: ['cat-a', 'cat-b'],
    };
    expect(evaluatePromotionRule(rule, ctx({ categoryIds: ['cat-x', 'cat-b'] }))).toBe(true);
    expect(evaluatePromotionRule(rule, ctx({ categoryIds: ['cat-x'] }))).toBe(false);
  });

  it('evaluates AND / OR groups with nesting', () => {
    const rule: PromotionRule = {
      kind: 'group',
      op: 'AND',
      children: [
        { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [100] },
        {
          kind: 'group',
          op: 'OR',
          children: [
            { kind: 'condition', field: { kind: 'builtin', key: 'paymentMethod' }, op: 'eq', values: ['card'] },
            { kind: 'condition', field: { kind: 'builtin', key: 'customerGroup' }, op: 'eq', values: ['vip'] },
          ],
        },
      ],
    };
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 150, customerGroupId: 'vip' }))).toBe(true);
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 150, paymentMethodCode: 'pickup' }))).toBe(false);
    expect(evaluatePromotionRule(rule, ctx({ cartTotal: 50, customerGroupId: 'vip' }))).toBe(false);
  });

  it('matches attribute conditions against the aggregated value view', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'attribute', attributeKey: 'color' },
      op: 'in',
      values: ['red'],
    };
    expect(evaluatePromotionRule(rule, ctx({ attributeValues: { color: ['blue', 'red'] } }))).toBe(true);
    expect(evaluatePromotionRule(rule, ctx({ attributeValues: { color: ['blue'] } }))).toBe(false);
  });

  it('skips an attribute that lost its promo-eligibility flag (FR-039 parity)', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'attribute', attributeKey: 'color' },
      op: 'in',
      values: ['red'],
    };
    const skipped: string[] = [];
    const result = evaluatePromotionRule(
      rule,
      ctx({
        attributeValues: { color: ['red'] },
        isPromoEligibleAttribute: () => false,
        onSkip: (info) => skipped.push(info.attributeKey),
      }),
    );
    expect(result).toBe(false);
    expect(skipped).toEqual(['color']);
  });
});
