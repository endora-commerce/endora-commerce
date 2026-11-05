import { describe, expect, it } from 'vitest';
import { organizationCompanyTaxId } from './organizations.js';

/**
 * Issue #767 — a personal (B2C) Organization stores an internal 32-hex
 * placeholder as its `taxId`. Every reader that prints or hands out an
 * Organization's tax id asks this one function, so the placeholder never
 * reaches a document, an admin panel or a picker.
 */
describe('organizationCompanyTaxId', () => {
  it("returns a company Organization's tax id", () => {
    expect(organizationCompanyTaxId({ isPersonal: false, taxId: '5260250274' })).toBe('5260250274');
  });

  it("never returns a personal Organization's placeholder", () => {
    expect(organizationCompanyTaxId({ isPersonal: true, taxId: '79963f233e3843bd84e144a8fcdd37f8' })).toBeNull();
  });

  it('reads an absent flag as a company, as a session payload without `isPersonal` is', () => {
    expect(organizationCompanyTaxId({ taxId: '5260250274' })).toBe('5260250274');
  });

  it('answers null, not an empty string, for a company with no tax id', () => {
    expect(organizationCompanyTaxId({ isPersonal: false, taxId: '' })).toBeNull();
    expect(organizationCompanyTaxId({ isPersonal: false, taxId: '   ' })).toBeNull();
  });
});
