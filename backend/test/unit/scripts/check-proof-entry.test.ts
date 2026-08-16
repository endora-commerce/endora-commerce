import { describe, expect, it } from 'vitest';

import {
  lowEntryDrift,
  lowEntryShapes,
  proofKey,
  type ProvenCheck,
} from '../../helpers/check-proof-entry.js';

/**
 * The rule that says where a red proof enters, driven red itself.
 *
 * `check-inventory.test.ts` uses these two functions to decide whether a proof
 * may enter below the top of its check. A helper that decides that question and
 * has no failing case of its own is the shape issue #130 is about — a guard
 * nobody watched go red — so each branch is demonstrated here on a synthetic
 * inventory the repository does not contain.
 */

const top = (count: number) => ({ enters: 'top' as const, prove: () => count });
const below = (count: number) => ({ enters: 'below' as const, prove: () => count });

describe('lowEntryShapes', () => {
  it('names nothing when every proof enters at the top', () => {
    const checks: ProvenCheck[] = [
      { script: 'scripts/a.ts', red: { alpha: top(1), beta: top(2) } },
    ];
    expect(lowEntryShapes(checks)).toEqual([]);
  });

  it('names the shape, not only the script, when one proof enters low', () => {
    const checks: ProvenCheck[] = [
      { script: 'scripts/a.ts', red: { alpha: top(1), beta: below(1) } },
    ];
    expect(lowEntryShapes(checks)).toEqual(['scripts/a.ts:beta']);
  });
});

describe('lowEntryDrift', () => {
  it('reports a proof that enters low with nothing in the ledger', () => {
    const checks: ProvenCheck[] = [{ script: 'scripts/a.ts', red: { alpha: below(1) } }];
    expect(lowEntryDrift(checks, {})).toEqual({
      unledgered: ['scripts/a.ts:alpha'],
      stale: [],
    });
  });

  it('reports a ledger entry that no longer describes a low proof', () => {
    const checks: ProvenCheck[] = [{ script: 'scripts/a.ts', red: { alpha: top(1) } }];
    expect(lowEntryDrift(checks, { 'scripts/a.ts:alpha': 'raised in MR !x' })).toEqual({
      unledgered: [],
      stale: ['scripts/a.ts:alpha'],
    });
  });

  it('is silent when the ledger and the proofs agree', () => {
    const checks: ProvenCheck[] = [
      { script: 'scripts/a.ts', red: { alpha: below(1), beta: top(1) } },
    ];
    const drift = lowEntryDrift(checks, { [proofKey('scripts/a.ts', 'alpha')]: 'why' });
    expect(drift).toEqual({ unledgered: [], stale: [] });
  });
});
