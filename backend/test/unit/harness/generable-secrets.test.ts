/**
 * The generable secrets this run holds are the harness's, never the machine's.
 *
 * `global-setup.ts` used to pin **two** of them behind `if (!process.env[…])`,
 * which is two defects in one line: the population was a hand-written copy of a
 * declaration that names five, and the guard let an ambient value through
 * whenever the developer's shell happened to carry one. `production-boot.test.ts`
 * is what the second cost — it failed only where `SESSION_COOKIE_SECRET` was
 * absent, which is every fresh clone and every job and no laptop, and the repair
 * turned out to be a product defect in the reference deployment rather than a
 * test defect at all.
 *
 * Both halves are asserted here, and the second is asserted **against the
 * presence**: this file does not check that a missing variable is missing, it
 * checks that the harness has taken the variable away from a process that could
 * have had one.
 */
import { describe, expect, it } from 'vitest';

import {
  derivedGenerableSecrets,
  PINNED_GENERABLE_SECRETS,
} from '../../generable-secrets.js';

describe('the population is derived from the declarations', () => {
  it('finds every `secret && generable` input the platform and the modules declare', async () => {
    const derived = await derivedGenerableSecrets();
    const names = derived.map((entry) => entry.name);

    // A floor rather than an equality: this test is about the derivation
    // reaching both declaration sources, not about how many such inputs ship
    // today. The four named below are the evidence that it reaches each of
    // them — two platform-owned, two module-owned.
    expect(names).toContain('SESSION_COOKIE_SECRET');
    expect(names).toContain('NEWSLETTER_TOKEN_SECRET');
    expect(names).toContain('ASSETS_LIBRARY_HMAC_KEY');
    expect(names).toContain('MFA_SECRET_ENCRYPTION_KEY');

    expect(derived.filter((e) => e.declaredBy === 'platform').length).toBeGreaterThan(0);
    expect(derived.filter((e) => e.declaredBy !== 'platform').length).toBeGreaterThan(0);
  });

  it('names no input the declarations have stopped producing', async () => {
    // The residue direction. A pinned entry whose declaration was deleted, or
    // whose `generable` flag was withdrawn, is an exception governing nothing —
    // and it would silently go on assigning a value the population no longer
    // holds.
    const names = new Set((await derivedGenerableSecrets()).map((entry) => entry.name));
    for (const pinned of Object.keys(PINNED_GENERABLE_SECRETS)) {
      expect(names, `${pinned} is pinned but nothing declares it generable any more`).toContain(
        pinned,
      );
    }
  });

  it('gives every exception a reason and a value its consumer can decode', () => {
    for (const [name, entry] of Object.entries(PINNED_GENERABLE_SECRETS)) {
      expect(entry.reason.length, `${name} must say why it is not withheld`).toBeGreaterThan(40);
      expect(entry.value.length, `${name} must have a value`).toBeGreaterThan(0);
    }
    // Both consumers decode 32 bytes — one from hex, one from base64 — so a
    // value of the wrong length is a cipher that throws in a hundred files.
    expect(Buffer.from(PINNED_GENERABLE_SECRETS['ASSETS_LIBRARY_HMAC_KEY']!.value, 'hex')).toHaveLength(
      32,
    );
    expect(
      Buffer.from(PINNED_GENERABLE_SECRETS['MFA_SECRET_ENCRYPTION_KEY']!.value, 'base64'),
    ).toHaveLength(32);
  });
});

describe('this process holds the harness environment, not the host one', () => {
  it('pins every exception to its declared value, ambient or not', async () => {
    for (const [name, entry] of Object.entries(PINNED_GENERABLE_SECRETS)) {
      expect(process.env[name], `${name} must be the harness's value`).toBe(entry.value);
    }
  });

  it('withholds every other declared generable secret', async () => {
    const derived = await derivedGenerableSecrets();
    const withheld = derived
      .map((entry) => entry.name)
      .filter((name) => !(name in PINNED_GENERABLE_SECRETS));

    // Nothing below is a tautology on a clean machine, which is exactly why it
    // is worth running there too: it fails the moment the seam stops deleting,
    // and it is the assertion a developer with `SESSION_COOKIE_SECRET` exported
    // sees fail in the same second the job would.
    expect(withheld.length, 'the derivation must produce something to withhold').toBeGreaterThan(0);
    for (const name of withheld) {
      expect(process.env[name], `${name} must not reach a test run from the machine`).toBeUndefined();
    }
  });
});
