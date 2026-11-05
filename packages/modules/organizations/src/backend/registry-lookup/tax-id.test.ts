import { describe, expect, it } from 'vitest';
import { isValidNip, normalizeTaxId, sameNormalizedTaxId } from './tax-id.js';

/**
 * Feature 173, FR-002 / research R-17 — one normaliser for the lookup and the
 * ticket check, run before any registry is contacted.
 */

describe('isValidNip', () => {
  it.each([
    ['5260250995', true],
    ['1234563218', true],
    ['5260250996', false], // last digit off by one
    ['5260250994', false],
    ['1234567890', false],
    ['526025099', false], // nine digits
    ['52602509951', false], // eleven digits
    ['52602509a5', false],
  ])('%s ⇒ %s', (nip, valid) => {
    expect(isValidNip(nip)).toBe(valid);
  });

  it('refuses a number whose weighted sum is 10 mod 11', () => {
    // A 1 under each of the two weight-5 positions ⇒ 10.
    const digits = '0100001000';
    expect(digits.slice(0, 9).split('').reduce((s, d, i) => s + Number(d) * [6, 5, 7, 2, 3, 4, 5, 6, 7][i]!, 0) % 11).toBe(10);
    for (let last = 0; last <= 9; last += 1) expect(isValidNip(`010000100${last}`)).toBe(false);
  });
});

describe('normalizeTaxId', () => {
  it('accepts a bare Polish NIP with country PL', () => {
    expect(normalizeTaxId({ taxId: '5260250995', country: 'PL' })).toEqual({
      kind: 'ok',
      country: 'PL',
      taxId: '5260250995',
    });
  });

  it('strips spaces, dashes and dots, and a PL prefix', () => {
    for (const typed of ['PL 526-025-09-95', 'pl5260250995', '526.025.09.95', ' 526 025 09 95 ']) {
      expect(normalizeTaxId({ taxId: typed, country: 'PL' })).toEqual({
        kind: 'ok',
        country: 'PL',
        taxId: '5260250995',
      });
    }
  });

  it('lets an EU prefix override the chosen country', () => {
    expect(normalizeTaxId({ taxId: 'DE123456789', country: 'PL' })).toEqual({
      kind: 'ok',
      country: 'DE',
      taxId: '123456789',
    });
    expect(normalizeTaxId({ taxId: 'PL5260250995', country: 'DE' })).toEqual({
      kind: 'ok',
      country: 'PL',
      taxId: '5260250995',
    });
  });

  it('maps GR to EL, as a chosen country and as a prefix', () => {
    expect(normalizeTaxId({ taxId: '123456789', country: 'gr' })).toEqual({
      kind: 'ok',
      country: 'EL',
      taxId: '123456789',
    });
    expect(normalizeTaxId({ taxId: 'GR123456789', country: 'PL' })).toEqual({
      kind: 'ok',
      country: 'EL',
      taxId: '123456789',
    });
    expect(normalizeTaxId({ taxId: 'EL123456789', country: 'PL' })).toEqual({
      kind: 'ok',
      country: 'EL',
      taxId: '123456789',
    });
  });

  it('sends a bare ten-digit number with country DE to VIES, not to the NIP check', () => {
    expect(normalizeTaxId({ taxId: '1234567890', country: 'DE' })).toEqual({
      kind: 'ok',
      country: 'DE',
      taxId: '1234567890',
    });
  });

  it('keeps letters that are part of a VIES number (AT U-prefix, IE check letter)', () => {
    expect(normalizeTaxId({ taxId: 'ATU12345678', country: 'PL' })).toEqual({
      kind: 'ok',
      country: 'AT',
      taxId: 'U12345678',
    });
    expect(normalizeTaxId({ taxId: '1234567T', country: 'IE' })).toEqual({
      kind: 'ok',
      country: 'IE',
      taxId: '1234567T',
    });
  });

  it('answers unsupported_country for a non-EU country', () => {
    expect(normalizeTaxId({ taxId: '123456789', country: 'US' })).toEqual({
      kind: 'unsupported_country',
      country: 'US',
    });
    expect(normalizeTaxId({ taxId: '123456789', country: 'GB' })).toEqual({
      kind: 'unsupported_country',
      country: 'GB',
    });
  });

  it('answers invalid for a Polish number failing the checksum or the length', () => {
    expect(normalizeTaxId({ taxId: 'PL1234567890', country: 'PL' })).toEqual({ kind: 'invalid_tax_id', country: 'PL' });
    expect(normalizeTaxId({ taxId: '526025099', country: 'PL' })).toEqual({ kind: 'invalid_tax_id', country: 'PL' });
    expect(normalizeTaxId({ taxId: 'abc', country: 'PL' })).toEqual({ kind: 'invalid_tax_id', country: 'PL' });
  });

  it('answers invalid for a VIES number with characters VIES cannot hold', () => {
    expect(normalizeTaxId({ taxId: 'DE12/34', country: 'DE' })).toEqual({ kind: 'invalid_tax_id', country: 'DE' });
    expect(normalizeTaxId({ taxId: 'DE', country: 'DE' })).toEqual({ kind: 'invalid_tax_id', country: 'DE' });
    expect(normalizeTaxId({ taxId: 'DE1234567890123', country: 'DE' })).toEqual({
      kind: 'invalid_tax_id',
      country: 'DE',
    });
  });

  it('does not take two letters that are no supported country as a prefix', () => {
    expect(normalizeTaxId({ taxId: 'US123', country: 'DE' })).toEqual({ kind: 'ok', country: 'DE', taxId: 'US123' });
  });
});

describe('sameNormalizedTaxId', () => {
  it('matches a ticket against the submission after normalisation', () => {
    expect(sameNormalizedTaxId({ country: 'PL', taxId: '5260250995' }, { taxId: 'PL 526-025-09-95', country: 'pl' })).toBe(
      true,
    );
    expect(sameNormalizedTaxId({ country: 'EL', taxId: '123456789' }, { taxId: '123456789', country: 'GR' })).toBe(true);
  });

  it('refuses a different number, a different country and an invalid submission', () => {
    expect(sameNormalizedTaxId({ country: 'PL', taxId: '5260250995' }, { taxId: '1234563218', country: 'PL' })).toBe(
      false,
    );
    expect(sameNormalizedTaxId({ country: 'DE', taxId: '5260250995' }, { taxId: '5260250995', country: 'PL' })).toBe(
      false,
    );
    expect(sameNormalizedTaxId({ country: 'PL', taxId: '1234567890' }, { taxId: '1234567890', country: 'PL' })).toBe(
      false,
    );
  });
});
