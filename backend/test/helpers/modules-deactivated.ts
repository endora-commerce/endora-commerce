import { expect } from 'vitest';
import { effectiveState } from '../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../src/kernel/lifecycle/registry-cache.js';

/**
 * Run `body` with **several** modules deactivated at once, on the operator axis.
 *
 * `withModuleOff` (`off-state.ts`) does not nest: each call seeds the whole
 * deactivated set, so an inner call replaces the outer one's module rather than
 * adding to it, and the outer module is silently back on for the body. A test
 * about two owners being absent together says so in one call, and — like
 * `withModuleOff` — the flip is asserted to have taken, for every module,
 * before the body observes anything.
 *
 * A file of its own rather than a third export of `off-state.ts`: that file's
 * exports are the vocabulary `check:off-state-coverage` reconciles a module's
 * off-state **proof** against, and this is not one. It drives state for a test
 * whose subject is another module's behaviour while two neighbours are off.
 */
export async function withModulesDeactivated<T>(
  moduleIds: readonly string[],
  body: () => Promise<T> | T,
): Promise<T> {
  const baseline = registryCache.enabledIds();
  for (const moduleId of moduleIds) {
    if (!baseline.includes(moduleId)) {
      throw new Error(`[modules-deactivated] "${moduleId}" is not enabled before the test runs.`);
    }
    if (registryCache.activationDeclaration(moduleId)?.settingCode === null) {
      throw new Error(`[modules-deactivated] "${moduleId}" declares itself non-deactivatable.`);
    }
  }
  registryCache.__setEnabledForTesting(baseline, { deactivated: [...moduleIds] });
  try {
    for (const moduleId of moduleIds) {
      expect(
        effectiveState.isPresent(moduleId),
        `[modules-deactivated] "${moduleId}" is still present after the flip`,
      ).toBe(false);
    }
    return await body();
  } finally {
    registryCache.__setEnabledForTesting(baseline);
  }
}
