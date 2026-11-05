import { describe, expect, it } from 'vitest';
import { parseViesAddress, parseWhiteListAddress } from './address-parsers.js';

/**
 * Feature 173, FR-005 / research R-6 — a one-line registry address split
 * best-effort; an empty field beats an invented one. Synthetic addresses.
 */

describe('parseWhiteListAddress', () => {
  it('splits "<street>, <NN-NNN> <CITY>" keeping the case as written', () => {
    expect(parseWhiteListAddress('UL. TESTOWA 1/2, 00-001 WARSZAWA')).toEqual({
      street: 'UL. TESTOWA 1/2',
      postalCode: '00-001',
      city: 'WARSZAWA',
    });
  });

  it('splits at the last comma when the street part holds one', () => {
    expect(parseWhiteListAddress('UL. TESTOWA 1, LOK. 2, 11-222 NOWE MIASTO')).toEqual({
      street: 'UL. TESTOWA 1, LOK. 2',
      postalCode: '11-222',
      city: 'NOWE MIASTO',
    });
  });

  it('keeps the whole string as the street when there is no comma', () => {
    expect(parseWhiteListAddress('TESTOWO 5 00-001 TESTOWO')).toEqual({
      street: 'TESTOWO 5 00-001 TESTOWO',
      postalCode: null,
      city: null,
    });
  });

  it('keeps the whole string as the street when the right part has no postal code', () => {
    expect(parseWhiteListAddress('UL. TESTOWA 1, WARSZAWA')).toEqual({
      street: 'UL. TESTOWA 1, WARSZAWA',
      postalCode: null,
      city: null,
    });
  });

  it('answers all-empty for an empty or missing address', () => {
    expect(parseWhiteListAddress('')).toEqual({ street: null, postalCode: null, city: null });
    expect(parseWhiteListAddress('   ')).toEqual({ street: null, postalCode: null, city: null });
    expect(parseWhiteListAddress(null)).toEqual({ street: null, postalCode: null, city: null });
  });
});

describe('parseViesAddress', () => {
  it('splits a multi-line address: last line postal code and city, the rest the street', () => {
    expect(parseViesAddress('UL. TESTOWA 1\n00-001 WARSZAWA')).toEqual({
      street: 'UL. TESTOWA 1',
      postalCode: '00-001',
      city: 'WARSZAWA',
    });
    expect(parseViesAddress('Teststrasse 5\r\nHinterhaus\n12345 Berlin\n')).toEqual({
      street: 'Teststrasse 5, Hinterhaus',
      postalCode: '12345',
      city: 'Berlin',
    });
  });

  it('keeps a single line as the street', () => {
    expect(parseViesAddress('1 Test Street Dublin 2')).toEqual({
      street: '1 Test Street Dublin 2',
      postalCode: null,
      city: null,
    });
  });

  it('keeps every line in the street when the last line has no postal code', () => {
    expect(parseViesAddress('1 Test Street\nDublin')).toEqual({
      street: '1 Test Street, Dublin',
      postalCode: null,
      city: null,
    });
  });

  it('answers all-empty for "---" and empty', () => {
    expect(parseViesAddress('---')).toEqual({ street: null, postalCode: null, city: null });
    expect(parseViesAddress('')).toEqual({ street: null, postalCode: null, city: null });
    expect(parseViesAddress(null)).toEqual({ street: null, postalCode: null, city: null });
  });
});
