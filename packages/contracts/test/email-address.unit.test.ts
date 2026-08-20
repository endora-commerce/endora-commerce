import { describe, expect, it } from 'vitest';
import { normalizeEmailAddress } from '../src/email-address.js';

/**
 * The one e-mail fold: the form an address is stored in and the form it is
 * compared in, which had been two different forms and made every mixed-case
 * registration unable to log in.
 *
 * The characterisation is short on purpose — the function is two steps — but
 * each one is here because something depends on it: the lowercase because the
 * account rows are folded, the trim because addresses also arrive from an
 * identity provider's claim rather than from a Zod-validated body, and the two
 * non-behaviours because a fold that quietly did more would merge accounts that
 * are genuinely separate.
 */
describe('normalizeEmailAddress', () => {
  it('folds case, which is what makes a registered address findable', () => {
    expect(normalizeEmailAddress('Jan.Kowalski@Example.PL')).toBe('jan.kowalski@example.pl');
  });

  it('trims, for the entrances a Zod `.email()` never sees', () => {
    expect(normalizeEmailAddress('  jan@example.pl \n')).toBe('jan@example.pl');
  });

  it('is idempotent — an address already on record folds to itself', () => {
    const once = normalizeEmailAddress('Jan@Example.PL');
    expect(normalizeEmailAddress(once)).toBe(once);
  });

  it('does not collapse provider aliasing: those are separate accounts', () => {
    // Gmail ignores dots and `+tags`; most providers do not. Folding them here
    // would silently merge two accounts on some domains and not others.
    expect(normalizeEmailAddress('jan.kowalski+shop@example.pl')).toBe(
      'jan.kowalski+shop@example.pl',
    );
  });

  it('does not validate — an address the schema rejects still folds', () => {
    // It is also applied to values already persisted, where rejecting is not an
    // option the caller has.
    expect(normalizeEmailAddress('NOT-AN-EMAIL')).toBe('not-an-email');
  });
});
