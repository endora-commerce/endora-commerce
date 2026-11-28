import { describe, expect, it } from 'vitest';
import { CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS } from './customer-account-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';
import * as barrel from './index.js';

describe('CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS (specs/193-admin-form-extensions/ FR-110, T001)', () => {
  it('declares the three customer-account writes and the membership move, for both phases', () => {
    const both = ['beforeCommit', 'afterCommit'];
    expect(Object.values(CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'customer_account.create', objectType: 'customer_account', phases: both },
      { action: 'customer_account.update_profile', objectType: 'customer_account', phases: both },
      { action: 'customer.custom_fields.update', objectType: 'customer_account', phases: both },
      { action: 'customer_account.organization.change', objectType: 'customer_account', phases: both },
    ]);
  });

  it('names its refs create, updateProfile, customFieldsUpdate and changeOrganization', () => {
    expect(Object.keys(CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS)).toEqual(['create', 'updateProfile', 'customFieldsUpdate', 'changeOrganization']);
  });

  it('is exported from the package barrel', () => {
    expect(barrel.CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS).toBe(CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS);
  });
});
