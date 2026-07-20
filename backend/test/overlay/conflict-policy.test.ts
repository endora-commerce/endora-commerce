import { describe, it, expect } from 'vitest';
import { assertNoConflicts } from '../../src/overlay/conflict-policy.js';
import { OverrideConflictError } from '../../src/overlay/errors.js';
import type { OverlayContribution } from '../../src/overlay/types.js';

const contribution = (overlayPath: string): OverlayContribution => ({
  moduleId: 'price_lists',
  kind: 'service',
  relPath: 'services/pricing-service.ts',
  overlayPath,
  corePath: '/core/price_lists/services/pricing-service.ts',
  interfaceRelPath: 'services/pricing-service.interface.ts',
});

describe('conflict-policy — fail on two overlays → one unit (T008, FR-007)', () => {
  it('passes through when every unit has a single contributor', () => {
    const one = [contribution('/apps/acme/price_lists/services/pricing-service.ts')];
    expect(assertNoConflicts(one)).toBe(one);
  });

  it('throws OverrideConflictError naming both contenders (no silent last-wins)', () => {
    const two = [
      contribution('/apps/acme/price_lists/services/pricing-service.ts'),
      contribution('/apps/other/price_lists/services/pricing-service.ts'),
    ];
    try {
      assertNoConflicts(two);
      throw new Error('expected a conflict');
    } catch (err) {
      expect(err).toBeInstanceOf(OverrideConflictError);
      const e = err as OverrideConflictError;
      expect(e.targetUnitKey).toBe('price_lists:service:services/pricing-service.ts');
      expect(e.contenders).toHaveLength(2);
      expect(e.message).toContain('/apps/acme/');
      expect(e.message).toContain('/apps/other/');
    }
  });
});
