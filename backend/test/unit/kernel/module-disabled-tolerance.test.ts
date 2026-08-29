import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  ModuleDisabledError,
  rethrowIfModuleDisabled,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';

/**
 * The narrowing primitive for a tolerance that genuinely belongs at a call site
 * (issue #84 — the deferred half of feature 072's D-43).
 *
 * `lazyPort` resolves inside the forwarded call, so a switched-off owner
 * surfaces as {@link ModuleDisabledError} *at the call site*. A
 * `try { … } catch { return null }` around one converts fail-closed into
 * fail-open: the caller reports "no data" where the truthful answer is "this
 * capability is off", and an operator reads a working screen that is lying.
 *
 * Some tolerances are still correct — a per-item import failure recorded as an
 * issue, a compensating cleanup, a notification that must not undo the write it
 * announces. What is never correct is absorbing the presence answer along with
 * them, because that answer is about the whole operation rather than the item.
 * This helper is how such a `catch` says so in one line, and it is greppable,
 * which is what lets `check-port-catches.ts` tell a narrowed tolerance from a
 * bare one.
 */
describe('rethrowIfModuleDisabled', () => {
  it('re-throws the presence answer, unchanged', () => {
    const disabled = new ModuleDisabledError('price_lists');
    let thrown: unknown;
    try {
      rethrowIfModuleDisabled(disabled);
    } catch (err) {
      thrown = err;
    }
    // Identity, not a copy: the 503 envelope and its `Retry-After` ride on the
    // instance, and a re-wrapped error loses both.
    expect(thrown).toBe(disabled);
    expect((thrown as ModuleDisabledError).statusCode).toBe(503);
    expect((thrown as ModuleDisabledError).code).toBe(ERROR_CODES.MODULE_DISABLED);
  });

  it('returns for every other error, so the tolerance it guards still runs', () => {
    expect(() => rethrowIfModuleDisabled(new Error('a domain refusal'))).not.toThrow();
    expect(() => rethrowIfModuleDisabled('a thrown string')).not.toThrow();
    expect(() => rethrowIfModuleDisabled(undefined)).not.toThrow();
  });
});
