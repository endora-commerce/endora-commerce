import { describe, expect, it } from 'vitest';
import {
  isRegisteredCommand,
  isReversibleCommand,
  registeredCommandActions,
} from '../../../src/commands/command-registry.js';

describe('command registry (feature 054, FR-009)', () => {
  it('recognizes registered actions', () => {
    expect(isRegisteredCommand('product.bulk_update')).toBe(true);
    expect(isRegisteredCommand('definitely.not.registered')).toBe(false);
  });

  it('reports reversibility only for reversible registered actions', () => {
    expect(isReversibleCommand('product.bulk_update')).toBe(true);
    expect(isReversibleCommand('product.bulk_update.undo')).toBe(false);
    expect(isReversibleCommand('definitely.not.registered')).toBe(false);
  });

  it('exposes the action list for the coverage check + undo affordances', () => {
    const actions = registeredCommandActions();
    expect(actions).toContain('product.bulk_update');
  });

  /**
   * Issue #125 — the method-configuration writes MR !545 audited by hand.
   *
   * They were covered in the lighter of the two sanctioned forms
   * (`recordAuditFromContext`), which leaves the write outside `CommandBus.run`:
   * no uniform envelope and no place for an undo to attach. The registry is the
   * ledger that says an action runs through the bus, so an entry here is the
   * half of the conversion a static reader can check.
   */
  it('knows the payment- and delivery-method configuration actions (issue #125)', () => {
    for (const action of [
      'payment_method.create',
      'payment_method.update',
      'payment_method.delete',
      'delivery_method.create',
      'delivery_method.update',
      'delivery_method.delete',
      'stripe_payment_method.update',
      'autopay_payment_method.update',
      'payu_payment_method.update',
      'tpay_payment_method.update',
    ]) {
      expect(isRegisteredCommand(action)).toBe(true);
      // None of them carries a stored revert state, so none may advertise undo.
      expect(isReversibleCommand(action)).toBe(false);
    }
  });
});
