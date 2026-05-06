// T004 — Verify the dictionaries module exports the documented shape so
// downstream tasks can hang their implementations on a stable handle.

import { describe, it, expect } from 'vitest';
import { dictionariesModule } from '../../../src/modules/dictionaries/plugin.js';

describe('dictionariesModule (skeleton)', () => {
  it('returns { plugin, handle } and the handle exposes the documented members', () => {
    const fakeEm = (() => ({})) as never;
    const mod = dictionariesModule({ emFactory: fakeEm });

    expect(typeof mod.plugin).toBe('function');
    expect(mod.handle).toBeDefined();
    expect('validator' in mod.handle).toBe(true);
    expect(typeof mod.handle.reconcile).toBe('function');
  });

  it('reconcile is a no-op in the skeleton phase', async () => {
    const fakeEm = (() => ({})) as never;
    const mod = dictionariesModule({ emFactory: fakeEm });
    await expect(mod.handle.reconcile()).resolves.toBeUndefined();
  });
});
