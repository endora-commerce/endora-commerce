import { describe, expect, it } from 'vitest';
import { PROMOTION_HOOKABLE_ACTIONS, promotionUsageLimitScopes } from './promotion-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';

describe('PROMOTION_HOOKABLE_ACTIONS (issue #1844)', () => {
  it('declares the promotion and coupon writes for both phases', () => {
    expect(Object.values(PROMOTION_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'promotion.create', objectType: 'promotion', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'promotion.update', objectType: 'promotion', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'coupon.create_single', objectType: 'promotion', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'coupon.generate_batch', objectType: 'promotion', phases: ['beforeCommit', 'afterCommit'] },
    ]);
  });
});

describe('promotionUsageLimitScopes', () => {
  it('names the scopes a limit is set on, in a fixed order, and never the limits', () => {
    expect(
      promotionUsageLimitScopes({ usageLimitGlobal: null, usageLimitPerOrganization: null, usageLimitPerCustomer: null }),
    ).toEqual([]);
    expect(
      promotionUsageLimitScopes({ usageLimitGlobal: 100, usageLimitPerOrganization: undefined, usageLimitPerCustomer: 3 }),
    ).toEqual(['global', 'per_customer']);
    expect(
      promotionUsageLimitScopes({ usageLimitGlobal: 1, usageLimitPerOrganization: 2, usageLimitPerCustomer: 3 }),
    ).toEqual(['global', 'per_organization', 'per_customer']);
  });
});
