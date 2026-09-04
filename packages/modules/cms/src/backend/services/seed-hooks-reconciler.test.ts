import { describe, expect, it } from 'vitest';
import { SEEDED_HOOKS } from './seed-hooks.js';

/**
 * The reconciler's *idempotency* property is best exercised in a real-DB
 * integration test (which the migration test in
 * test/integration/cms/migration.test.ts already does — running the
 * migration twice does not duplicate seeded rows). The unit test here
 * pins the static list of 23 codes so a future code-list edit (add or
 * remove a Hook) shows up as a deliberate spec change, not a silent drift.
 */
describe('SEEDED_HOOKS', () => {
  it('contains exactly 23 codes', () => {
    expect(SEEDED_HOOKS).toHaveLength(23);
  });

  it('every code is unique', () => {
    const codes = SEEDED_HOOKS.map((h) => h.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every code is lowercase + dot-separated', () => {
    for (const h of SEEDED_HOOKS) {
      expect(h.code).toMatch(/^[a-z][a-z0-9.]*[a-z0-9]$/);
    }
  });

  it('contains the contract codes from spec.md FR-014', () => {
    const required = [
      'header.top',
      'homepage.top',
      'homepage.bottom',
      'footer.before',
      'footer.top',
      'footer.bottom',
      'footer.after',
      'footer.copyright',
      'category.top',
      'category.bottom',
      'product.top',
      'product.bottom',
      'product.buttons.after',
      'search.top',
      'search.bottom',
      'page.top',
      'page.bottom',
      'cms.page.top',
      'cms.page.bottom',
      'login.top',
      'login.bottom',
      'register.top',
      'register.bottom',
    ];
    const codes = new Set(SEEDED_HOOKS.map((h) => h.code));
    for (const c of required) {
      expect(codes.has(c), `missing seeded hook code: ${c}`).toBe(true);
    }
  });
});
