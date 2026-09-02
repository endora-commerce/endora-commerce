import { describe, expect, it } from 'vitest';
import {
  defineModuleErrorCodes,
  ERROR_CODES,
  errorCodeRe,
  type ErrorCode,
  type ModuleErrorCode,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 090 — D-182's amendment of 2026-08-28: *"A module-declared code is
 * branded, not a bare string."*
 *
 * Two kinds of proof, and they need each other. The `it()` blocks below prove
 * the helper's runtime refusals; the `@ts-expect-error` lines prove the type,
 * and those are assertions the **type-check** enforces — a line marked
 * `@ts-expect-error` that stops being an error fails `pnpm --filter backend run
 * typecheck`, which is where this file's real teeth are.
 *
 * **What the brand buys is stated exactly, in both directions**, because D-182
 * is careful that it not be over-read. It bites on assignability, which is the
 * *raise* site: a bare `'ACME_TYPO'` is assignable to neither `ErrorCode` nor
 * `ModuleErrorCode`, so `new HttpError(400, 'ACME_TYPO', …)` does not compile.
 * It does not bite on comparability, which is the `===` at a *reading* site —
 * measured here rather than assumed, because `research.md` §7 records losing
 * that protection as the widening's cost and it would be easy to believe the
 * brand pays it back. It does not.
 */
const acmeErrorCodes = defineModuleErrorCodes([
  'ACME_SYNC_NOT_CONFIGURED',
  'ACME_SYNC_REJECTED',
]);

describe('defineModuleErrorCodes — the authoring shape (feature 090, D-182)', () => {
  it('returns each code as its own value, keyed by itself', () => {
    expect(acmeErrorCodes.ACME_SYNC_REJECTED).toBe('ACME_SYNC_REJECTED');
    expect(Object.keys(acmeErrorCodes)).toEqual([
      'ACME_SYNC_NOT_CONFIGURED',
      'ACME_SYNC_REJECTED',
    ]);
  });

  it('refuses a code that is not SCREAMING_SNAKE_CASE', () => {
    expect(() => defineModuleErrorCodes(['acmeSyncRejected'])).toThrow(
      /"acmeSyncRejected" is not a valid error code/,
    );
  });

  it('refuses the same code twice — the duplicate would collapse into one key silently', () => {
    expect(() => defineModuleErrorCodes(['ACME_SYNC_REJECTED', 'ACME_SYNC_REJECTED'])).toThrow(
      /"ACME_SYNC_REJECTED" is declared twice/,
    );
  });

  it('agrees with the grammar the manifest declaration and the bundle key use', () => {
    expect(errorCodeRe.test('ACME_SYNC_REJECTED')).toBe(true);
    expect(errorCodeRe.test('acmeSyncRejected')).toBe(false);
  });
});

describe('the brand at a raise site (type-level)', () => {
  it('accepts a platform code', () => {
    const error = new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    expect(error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('accepts a module-declared code', () => {
    const error = new HttpError(409, acmeErrorCodes.ACME_SYNC_REJECTED, 'Sync rejected.');
    expect(error.code).toBe('ACME_SYNC_REJECTED');
  });

  it('refuses a bare string that is neither', () => {
    // @ts-expect-error a code that came through neither ERROR_CODES nor
    // defineModuleErrorCodes is not an error code, however well it is spelled.
    const error = new HttpError(409, 'ACME_SYNC_REJECTED', 'Sync rejected.');
    // The runtime value is unaffected — this is a compile-time rule and the
    // platform never inspects the brand.
    expect(error.code).toBe('ACME_SYNC_REJECTED');
  });

  it('refuses a typo of a platform code, exactly as the closed enumeration did', () => {
    // @ts-expect-error 'PRDUCT_NOT_FOUND' is in no enumeration and carries no brand.
    const error = new HttpError(404, 'PRDUCT_NOT_FOUND', 'Product not found.');
    expect(error.code).toBe('PRDUCT_NOT_FOUND');
  });
});

describe('what the brand does not buy, measured', () => {
  it('does not restore the type error at a `===` comparison site', () => {
    // `plan.md` Q3's cost, re-measured against the branded answer to Q4. A
    // comparison is checked for *comparability*, not assignability, and an
    // intersection with `string` is comparable to any string literal — so this
    // line compiles and would silently never match. If a later change makes it
    // a type error, that is Q3 answered and this proof is what tells you.
    const code: ErrorCode | ModuleErrorCode = ERROR_CODES.PRODUCT_NOT_FOUND;
    expect(code === ('PRDUCT_NOT_FOUND' as string)).toBe(false);
  });

  it('says nothing about whether a declared code is translated or contested', () => {
    // Stated as a test so the claim is in the same file as the protection: the
    // helper brands, and the two things D-182 names as *not* following from it
    // — a declared code with no sentence, and two modules claiming one code —
    // are reachable through it in neither direction.
    expect(Object.keys(acmeErrorCodes)).not.toContain('errors.ACME_SYNC_REJECTED');
  });
});
