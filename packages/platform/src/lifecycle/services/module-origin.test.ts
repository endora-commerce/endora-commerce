import { describe, expect, it } from 'vitest';
import { deploymentShippedEntries, moduleOriginOf, type ModuleIdClaimOrigin } from './module-origin.js';

/**
 * `specs/189-command-middleware/` T040 (FR-004, `contracts/module-origin.md`
 * §6): the discovery that found a module and the trust tier it gets are two
 * answers, mapped one way by one function.
 */

describe('moduleOriginOf (189 T040, module-origin.md §6)', () => {
  it.each<[ModuleIdClaimOrigin, boolean, string]>([
    ['core', false, 'core'],
    ['core', true, 'core'],
    ['overlay', false, 'deployment'],
    ['overlay', true, 'deployment'],
    ['package', true, 'core'],
    ['package', false, 'package'],
  ])('maps discovery %s (first-party %s) to %s', (discovery, firstParty, tier) => {
    expect(moduleOriginOf(discovery, firstParty)).toBe(tier);
  });

  it('keeps an installed first-party package out of the shipped entries while its tier is core', () => {
    const entries = [{ id: 'organizations', origin: 'package' as ModuleIdClaimOrigin }];
    expect(deploymentShippedEntries(entries)).toEqual([]);
    expect(moduleOriginOf(entries[0]!.origin, true)).toBe('core');
  });
});
