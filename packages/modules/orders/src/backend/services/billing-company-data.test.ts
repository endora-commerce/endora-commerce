import { describe, expect, it } from 'vitest';
import { billingCompanyData } from './order-service.js';

/**
 * Issue #759 — a personal (B2C) Organization is not a company: neither its
 * placeholder tax id nor the person's name may become an order's company data.
 */
const personal = {
  isPersonal: true,
  name: 'Jan Kowalski',
  legalName: null,
  taxId: '79963f233e3843bd84e144a8fcdd37f8',
};
const company = { isPersonal: false, name: 'Acme', legalName: 'Acme Sp. z o.o.', taxId: '5260250274' };

describe('billingCompanyData (#759)', () => {
  it('gives a personal Organization without typed data no company name and no tax id', () => {
    expect(billingCompanyData(personal, {})).toEqual({});
    expect(billingCompanyData(personal, { billingCompanyName: '  ', billingTaxId: '' })).toEqual({});
  });

  it('keeps what a personal buyer typed', () => {
    expect(
      billingCompanyData(personal, { billingCompanyName: ' Kowalski Usługi ', billingTaxId: '7740001454' }),
    ).toEqual({ companyName: 'Kowalski Usługi', taxId: '7740001454' });
  });

  it("defaults a company Organization to its legal name, then its name, and its tax id", () => {
    expect(billingCompanyData(company, {})).toEqual({ companyName: 'Acme Sp. z o.o.', taxId: '5260250274' });
    expect(billingCompanyData({ ...company, legalName: null }, {})).toEqual({
      companyName: 'Acme',
      taxId: '5260250274',
    });
  });

  it("lets a company Organization's buyer override either default", () => {
    expect(billingCompanyData(company, { billingCompanyName: 'Acme Oddział', billingTaxId: '1132853869' })).toEqual({
      companyName: 'Acme Oddział',
      taxId: '1132853869',
    });
  });
});
