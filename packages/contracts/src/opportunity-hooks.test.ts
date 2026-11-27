import { describe, expect, it } from 'vitest';
import { OPPORTUNITY_HOOKABLE_ACTIONS } from './opportunity-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';

describe('OPPORTUNITY_HOOKABLE_ACTIONS (spec 193 FR-111, issue #2006)', () => {
  it('declares the Opportunity create and edit for both phases, on the object type the Commands record', () => {
    expect(Object.values(OPPORTUNITY_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'crm.opportunity.create', objectType: 'crm_opportunity', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'crm.opportunity.update', objectType: 'crm_opportunity', phases: ['beforeCommit', 'afterCommit'] },
    ]);
  });
});
