import { describe, expect, it } from 'vitest';
import { ORGANIZATION_HOOKABLE_ACTIONS } from './organization-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';

describe('ORGANIZATION_HOOKABLE_ACTIONS (176 T021, FR-024)', () => {
  it('declares the four Organization writes for both phases', () => {
    expect(Object.values(ORGANIZATION_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'organization.create', objectType: 'organization', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'organization.register', objectType: 'organization', phases: ['beforeCommit', 'afterCommit'] },
      { action: 'organization.admin_patch', objectType: 'organization', phases: ['beforeCommit', 'afterCommit'] },
      {
        action: 'organization.set_custom_field_values',
        objectType: 'organization',
        phases: ['beforeCommit', 'afterCommit'],
      },
    ]);
  });
});
