import { describe, expect, it } from 'vitest';
import type { ApplicationRule } from '@endora-commerce/contracts';
import {
  evaluateApplicationRule,
  type ResolutionContext,
} from '../../../src/modules/price_lists/services/application-rule-evaluator.js';

const SC = 'sc_pl_default';
const ORG = 'org_acme';
const CG = 'cg_vip';
const CAT_SCREWDRIVERS = 'cat_screwdrivers';
const CAT_DRILLS = 'cat_drills';

function ctx(overrides: Partial<ResolutionContext> = {}): ResolutionContext {
  return {
    organizationId: ORG,
    customerGroupId: CG,
    salesChannelId: SC,
    currencyCode: 'PLN',
    productCategoryIds: new Set([CAT_SCREWDRIVERS]),
    ...overrides,
  };
}

describe('evaluateApplicationRule (T017)', () => {
  it('treats `{ kind: "all" }` as always-true with empty explicitOn', () => {
    const r = evaluateApplicationRule({ kind: 'all' }, ctx());
    expect(r.matched).toBe(true);
    expect([...r.explicitOn]).toEqual([]);
  });

  it('matches single-criterion salesChannel rule and reports explicitOn', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'salesChannel', values: [SC] };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(true);
    expect([...r.explicitOn]).toEqual(['salesChannel']);
  });

  it('fails to match when salesChannel does not include the context', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'salesChannel', values: ['sc_de'] };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(false);
    expect([...r.explicitOn]).toEqual([]);
  });

  it('matches organization criterion when context organizationId is included', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'organization', values: [ORG] };
    expect(evaluateApplicationRule(rule, ctx()).matched).toBe(true);
  });

  it('fails organization match for guest (organizationId === null)', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'organization', values: [ORG] };
    const r = evaluateApplicationRule(rule, ctx({ organizationId: null }));
    expect(r.matched).toBe(false);
  });

  it('matches customerGroup criterion against the context', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'customerGroup', values: [CG] };
    expect(evaluateApplicationRule(rule, ctx()).matched).toBe(true);
  });

  it('matches category criterion when ANY of the product’s categories appears in values (FR-029, product-driven)', () => {
    const rule: ApplicationRule = {
      kind: 'criterion',
      type: 'category',
      values: [CAT_SCREWDRIVERS, CAT_DRILLS],
    };
    expect(evaluateApplicationRule(rule, ctx()).matched).toBe(true);
  });

  it('fails category criterion when none of the product’s categories appears in values', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'category', values: [CAT_DRILLS] };
    const r = evaluateApplicationRule(rule, ctx({ productCategoryIds: new Set([CAT_SCREWDRIVERS]) }));
    expect(r.matched).toBe(false);
  });

  it('matches currency criterion when context.currencyCode is in values', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'currency', values: ['PLN'] };
    expect(evaluateApplicationRule(rule, ctx()).matched).toBe(true);
  });

  it('treats empty-criterion values as always-true and adds nothing to explicitOn (FR-022)', () => {
    const rule: ApplicationRule = { kind: 'criterion', type: 'organization', values: [] };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(true);
    expect([...r.explicitOn]).toEqual([]);
  });

  it('AND group: all children must match; explicitOn is the union of all matched children', () => {
    const rule: ApplicationRule = {
      kind: 'group',
      op: 'AND',
      children: [
        { kind: 'criterion', type: 'customerGroup', values: [CG] },
        { kind: 'criterion', type: 'category', values: [CAT_SCREWDRIVERS] },
      ],
    };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(true);
    expect([...r.explicitOn].sort()).toEqual(['category', 'customerGroup']);
  });

  it('AND group fails as soon as any child fails; explicitOn is empty', () => {
    const rule: ApplicationRule = {
      kind: 'group',
      op: 'AND',
      children: [
        { kind: 'criterion', type: 'customerGroup', values: [CG] },
        { kind: 'criterion', type: 'category', values: [CAT_DRILLS] }, // fails
      ],
    };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(false);
    expect([...r.explicitOn]).toEqual([]);
  });

  it('OR group matches if any child matches; explicitOn includes only matching children', () => {
    const rule: ApplicationRule = {
      kind: 'group',
      op: 'OR',
      children: [
        { kind: 'criterion', type: 'organization', values: ['org_other'] }, // fails
        { kind: 'criterion', type: 'customerGroup', values: [CG] }, // matches
      ],
    };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(true);
    expect([...r.explicitOn]).toEqual(['customerGroup']);
  });

  it('OR group fails when no child matches', () => {
    const rule: ApplicationRule = {
      kind: 'group',
      op: 'OR',
      children: [
        { kind: 'criterion', type: 'salesChannel', values: ['sc_de'] },
        { kind: 'criterion', type: 'organization', values: ['org_other'] },
      ],
    };
    expect(evaluateApplicationRule(rule, ctx()).matched).toBe(false);
  });

  it('handles nested groups correctly (depth 3)', () => {
    const rule: ApplicationRule = {
      kind: 'group',
      op: 'AND',
      children: [
        { kind: 'criterion', type: 'salesChannel', values: [SC] },
        {
          kind: 'group',
          op: 'OR',
          children: [
            { kind: 'criterion', type: 'organization', values: [ORG] },
            {
              kind: 'group',
              op: 'AND',
              children: [
                { kind: 'criterion', type: 'customerGroup', values: [CG] },
                { kind: 'criterion', type: 'category', values: [CAT_SCREWDRIVERS] },
              ],
            },
          ],
        },
      ],
    };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(true);
    expect(r.explicitOn.has('organization')).toBe(true); // matches via the OR-left branch
  });

  it('currency criterion never appears in priority chain even when explicit (still goes into explicitOn for traceability)', () => {
    // Note: the priority chain in price-list-resolver only checks 4 of the 5 types.
    // The evaluator includes 'currency' in explicitOn for traceability.
    const rule: ApplicationRule = { kind: 'criterion', type: 'currency', values: ['PLN'] };
    const r = evaluateApplicationRule(rule, ctx());
    expect(r.matched).toBe(true);
    expect([...r.explicitOn]).toEqual(['currency']);
  });
});
