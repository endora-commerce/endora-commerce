import { describe, expect, it } from 'vitest';
import { PRODUCT_HOOKABLE_ACTIONS } from './product-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';

describe('PRODUCT_HOOKABLE_ACTIONS (specs/193-admin-form-extensions/ FR-112)', () => {
  it('declares the four Product writes for both phases', () => {
    const both = ['beforeCommit', 'afterCommit'];
    expect(Object.values(PRODUCT_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'product.create', objectType: 'product', phases: both },
      { action: 'product.update', objectType: 'product', phases: both },
      { action: 'product.scoped_values.save', objectType: 'product', phases: both },
      { action: 'product.scoped_values.import', objectType: 'product', phases: both },
    ]);
  });

  it('does not declare the reversible bulk edit or its undo (FR-113)', () => {
    const actions = Object.values(PRODUCT_HOOKABLE_ACTIONS).map((ref) => ref.action);
    expect(actions).not.toContain('product.bulk_update');
    expect(actions).not.toContain('product.bulk_update.undo');
  });
});
