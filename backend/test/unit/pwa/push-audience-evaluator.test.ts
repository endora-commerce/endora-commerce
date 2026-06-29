import { describe, expect, it } from 'vitest';
import type { PushAudienceRule } from '@b2b/contracts';
import {
  evaluatePushAudienceRule,
  type PushAudienceContext,
} from '../../../src/modules/pwa/services/push-audience-evaluator.js';

const linked: PushAudienceContext = {
  salesChannelId: 'sc-1',
  organizationId: 'org-1',
  customerGroupId: 'grp-1',
  customerAccountId: 'cust-1',
};

const anonymous: PushAudienceContext = {
  salesChannelId: 'sc-1',
  organizationId: null,
  customerGroupId: null,
  customerAccountId: null,
};

describe('evaluatePushAudienceRule (Rule Builder targeting)', () => {
  it('matches everyone for { kind: "all" }', () => {
    expect(evaluatePushAudienceRule({ kind: 'all' }, linked)).toBe(true);
    expect(evaluatePushAudienceRule({ kind: 'all' }, anonymous)).toBe(true);
  });

  it('treats an empty value list as no constraint', () => {
    const rule: PushAudienceRule = { kind: 'criterion', type: 'organization', values: [] };
    expect(evaluatePushAudienceRule(rule, linked)).toBe(true);
    expect(evaluatePushAudienceRule(rule, anonymous)).toBe(true);
  });

  it('matches by organization', () => {
    const rule: PushAudienceRule = { kind: 'criterion', type: 'organization', values: ['org-1'] };
    expect(evaluatePushAudienceRule(rule, linked)).toBe(true);
    expect(
      evaluatePushAudienceRule(rule, { ...linked, organizationId: 'org-2' }),
    ).toBe(false);
  });

  it('matches by customer group', () => {
    const rule: PushAudienceRule = { kind: 'criterion', type: 'customerGroup', values: ['grp-1'] };
    expect(evaluatePushAudienceRule(rule, linked)).toBe(true);
    expect(evaluatePushAudienceRule(rule, { ...linked, customerGroupId: null })).toBe(false);
  });

  it('matches by explicit customer list', () => {
    const rule: PushAudienceRule = {
      kind: 'criterion',
      type: 'customer',
      values: ['cust-1', 'cust-9'],
    };
    expect(evaluatePushAudienceRule(rule, linked)).toBe(true);
    expect(evaluatePushAudienceRule(rule, { ...linked, customerAccountId: 'cust-2' })).toBe(false);
  });

  it('only matches anonymous subscribers on salesChannel/all criteria', () => {
    const scRule: PushAudienceRule = { kind: 'criterion', type: 'salesChannel', values: ['sc-1'] };
    const orgRule: PushAudienceRule = { kind: 'criterion', type: 'organization', values: ['org-1'] };
    expect(evaluatePushAudienceRule(scRule, anonymous)).toBe(true);
    expect(evaluatePushAudienceRule(orgRule, anonymous)).toBe(false);
  });

  it('evaluates AND groups (all children must match)', () => {
    const rule: PushAudienceRule = {
      kind: 'group',
      op: 'AND',
      children: [
        { kind: 'criterion', type: 'organization', values: ['org-1'] },
        { kind: 'criterion', type: 'customerGroup', values: ['grp-1'] },
      ],
    };
    expect(evaluatePushAudienceRule(rule, linked)).toBe(true);
    expect(evaluatePushAudienceRule(rule, { ...linked, customerGroupId: 'grp-2' })).toBe(false);
  });

  it('evaluates OR groups (any child matches)', () => {
    const rule: PushAudienceRule = {
      kind: 'group',
      op: 'OR',
      children: [
        { kind: 'criterion', type: 'organization', values: ['org-9'] },
        { kind: 'criterion', type: 'customer', values: ['cust-1'] },
      ],
    };
    expect(evaluatePushAudienceRule(rule, linked)).toBe(true);
    expect(
      evaluatePushAudienceRule(rule, { ...linked, customerAccountId: 'cust-2' }),
    ).toBe(false);
  });
});
