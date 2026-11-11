import { describe, expect, it } from 'vitest';
import { organizationWasConsumerAt } from './return-case-service.js';

/**
 * `specs/177-tax-id-scope/` T059 (FR-040; `contracts/convert-to-company.md` §6)
 * — a consumer's statutory withdrawal follows the order, not the
 * organization's current kind. A personal organization converted to a company
 * keeps consumer rights for the orders placed before the conversion; orders
 * placed after it are a company's.
 */
const convertedAt = new Date('2026-11-10T12:00:00.000Z');

describe('organizationWasConsumerAt', () => {
  it('answers true for a personal organization', () => {
    expect(organizationWasConsumerAt({ isPersonal: true, convertedToCompanyAt: null }, new Date())).toBe(true);
  });

  it('answers false for a company that was never personal', () => {
    expect(organizationWasConsumerAt({ isPersonal: false, convertedToCompanyAt: null }, new Date())).toBe(false);
  });

  it('answers true for an order placed before the conversion, false for one placed after', () => {
    const company = { isPersonal: false, convertedToCompanyAt: convertedAt };
    expect(organizationWasConsumerAt(company, new Date('2026-11-01T00:00:00.000Z'))).toBe(true);
    expect(organizationWasConsumerAt(company, new Date('2026-11-11T00:00:00.000Z'))).toBe(false);
    expect(organizationWasConsumerAt(company, convertedAt)).toBe(false);
  });

  it('answers false when nothing is known about the organization', () => {
    expect(organizationWasConsumerAt(null, new Date())).toBe(false);
  });
});
