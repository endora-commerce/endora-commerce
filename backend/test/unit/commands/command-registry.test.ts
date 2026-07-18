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
});
