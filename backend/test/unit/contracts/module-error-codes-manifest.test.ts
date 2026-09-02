import { describe, expect, it } from 'vitest';
import { defineModuleManifest, type ModuleManifest } from '@endora-commerce/contracts';

/**
 * Feature 090 — `contracts/error-code-declaration.md` §2, the first of three
 * refusal layers.
 *
 * `defineModuleManifest` sees **one** manifest, on the author's own machine, at
 * import time, with no instance and no database. Everything it can decide from
 * that, it decides here; everything it cannot, it leaves to the layer that can.
 * The four refusals are: a malformed code, the same code twice, a malformed
 * refusal token, and the same token twice under one code.
 *
 * Every proof below hands `defineModuleManifest` a whole manifest object — the
 * top of the analysis, which is where a red proof has to enter (`AGENTS.md`,
 * issue #130). None of them reaches past it into `assertErrorCodeRules`, because
 * a fixture that enters below the classifier cannot catch a classifier that
 * stopped running.
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

describe('defineModuleManifest — errorCodes declaration (feature 090)', () => {
  describe('what it accepts', () => {
    it('accepts a manifest declaring no error codes at all', () => {
      expect(manifest({ id: 'fixture_errors' }).errorCodes).toBeUndefined();
    });

    it('accepts a declaration of codes without tokens', () => {
      const m = manifest({
        id: 'fixture_errors',
        errorCodes: [{ code: 'ACME_SYNC_NOT_CONFIGURED' }, { code: 'ACME_SYNC_REJECTED' }],
      });
      expect(m.errorCodes).toEqual([
        { code: 'ACME_SYNC_NOT_CONFIGURED' },
        { code: 'ACME_SYNC_REJECTED' },
      ]);
    });

    it('accepts refusal tokens under a code', () => {
      const m = manifest({
        id: 'fixture_errors',
        errorCodes: [{ code: 'ACME_SYNC_REJECTED', tokens: ['expired', 'quota', 'unknown_sku'] }],
      });
      expect(m.errorCodes?.[0]?.tokens).toEqual(['expired', 'quota', 'unknown_sku']);
    });

    it('accepts a code that is a member of the platform enumeration', () => {
      // Deliberately not refused (§2, last paragraph): after feature 090's
      // migration every core module's declarations are members of ERROR_CODES,
      // so the rule would refuse the platform's own manifests, and there is no
      // origin field to condition it on.
      expect(() =>
        manifest({ id: 'fixture_errors', errorCodes: [{ code: 'PRODUCT_NOT_FOUND' }] }),
      ).not.toThrow();
    });

    it('accepts two different modules declaring the same code — it cannot see the second', () => {
      // The collision rule is composition's (§3). A partial refusal here would
      // be a green that means "not looking".
      const first = manifest({ id: 'fixture_one', errorCodes: [{ code: 'SYNC_FAILED' }] });
      const second = manifest({ id: 'fixture_two', errorCodes: [{ code: 'SYNC_FAILED' }] });
      expect(first.errorCodes).toEqual(second.errorCodes);
    });
  });

  describe('what it refuses — one proof per shape', () => {
    it('refuses a code that is not SCREAMING_SNAKE_CASE, naming the module and the code', () => {
      expect(() =>
        manifest({ id: 'fixture_errors', errorCodes: [{ code: 'acmeSyncRejected' }] }),
      ).toThrow(/manifest "fixture_errors" declares error code "acmeSyncRejected"/);
    });

    it('refuses a code starting with a digit', () => {
      expect(() =>
        manifest({ id: 'fixture_errors', errorCodes: [{ code: '1_ACME' }] }),
      ).toThrow(/declares error code "1_ACME"/);
    });

    it('refuses the same code declared twice in one manifest', () => {
      expect(() =>
        manifest({
          id: 'fixture_errors',
          errorCodes: [{ code: 'ACME_SYNC_REJECTED' }, { code: 'ACME_SYNC_REJECTED' }],
        }),
      ).toThrow(/declares error code "ACME_SYNC_REJECTED" twice/);
    });

    it('refuses a refusal token that does not match the token grammar', () => {
      expect(() =>
        manifest({
          id: 'fixture_errors',
          errorCodes: [{ code: 'ACME_SYNC_REJECTED', tokens: ['Expired'] }],
        }),
      ).toThrow(/declares refusal token "Expired" under "ACME_SYNC_REJECTED"/);
    });

    it('refuses the same token twice under one code', () => {
      expect(() =>
        manifest({
          id: 'fixture_errors',
          errorCodes: [{ code: 'ACME_SYNC_REJECTED', tokens: ['expired', 'expired'] }],
        }),
      ).toThrow(/declares refusal token "expired" twice under "ACME_SYNC_REJECTED"/);
    });

    it('allows the same token under two different codes — the scope is one code', () => {
      expect(() =>
        manifest({
          id: 'fixture_errors',
          errorCodes: [
            { code: 'ACME_SYNC_REJECTED', tokens: ['expired'] },
            { code: 'ACME_PUSH_REJECTED', tokens: ['expired'] },
          ],
        }),
      ).not.toThrow();
    });
  });
});
