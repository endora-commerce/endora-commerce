import { describe, expect, it } from 'vitest';
import { addressFingerprint, takesOverDefault } from './address-fingerprint.js';

/**
 * `specs/173-b2c-address-book-merge/` T-U1 and T-U2 — the two pure rules the
 * release-1 retirement job moves a B2C personal-book row by.
 *
 * T-U1 is plan R-4: two rows are the same address when they are of the same
 * kind and these fields match after normalisation. A false merge loses an
 * address and a false non-merge shows one twice, so the rule is deliberately
 * narrow: diacritics are **not** folded.
 *
 * T-U2 is OD-2's default rule: the moved row becomes the default of its kind
 * only when the Organization book has none of that kind yet.
 */

const base = {
  kind: 'delivery' as const,
  recipientName: 'Jan Kowalski',
  street: 'ul. Testowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
  phone: '+48 600 100 200',
};

describe('addressFingerprint (T-U1)', () => {
  it('is equal for the same address', () => {
    expect(addressFingerprint(base)).toBe(addressFingerprint({ ...base }));
  });

  it('trims, collapses inner whitespace and case-folds the name, street and city', () => {
    expect(
      addressFingerprint({
        ...base,
        recipientName: '  jan   KOWALSKI ',
        street: 'UL.  testowa\t1',
        city: ' warszawa ',
      }),
    ).toBe(addressFingerprint(base));
  });

  it('normalises to NFC, so a decomposed letter equals its composed form', () => {
    const composed = { ...base, city: 'Łódź' };
    // `Łódź` with each accent as a combining mark after its letter (o + U+0301, z + U+0301).
    const decomposed = { ...base, city: '\u0141o\u0301dz\u0301' };
    expect(addressFingerprint(decomposed)).toBe(addressFingerprint(composed));
  });

  it('does not fold diacritics', () => {
    expect(addressFingerprint({ ...base, city: 'Lodz' })).not.toBe(
      addressFingerprint({ ...base, city: 'Łódź' }),
    );
  });

  it('removes whitespace from the postal code and upper-cases it', () => {
    expect(addressFingerprint({ ...base, postalCode: ' sw1a  1aa ' })).toBe(
      addressFingerprint({ ...base, postalCode: 'SW1A1AA' }),
    );
  });

  it('upper-cases the country', () => {
    expect(addressFingerprint({ ...base, country: 'pl' })).toBe(addressFingerprint(base));
  });

  it('keeps only digits and a leading + of the phone', () => {
    expect(addressFingerprint({ ...base, phone: '+48 (600) 100-200' })).toBe(
      addressFingerprint({ ...base, phone: '+48600100200' }),
    );
    expect(addressFingerprint({ ...base, phone: '48600100200' })).not.toBe(
      addressFingerprint({ ...base, phone: '+48600100200' }),
    );
  });

  it('treats an absent phone as equal to an absent phone, and to nothing else', () => {
    expect(addressFingerprint({ ...base, phone: null })).toBe(
      addressFingerprint({ ...base, phone: undefined }),
    );
    expect(addressFingerprint({ ...base, phone: '' })).toBe(addressFingerprint({ ...base, phone: null }));
    expect(addressFingerprint({ ...base, phone: null })).not.toBe(addressFingerprint(base));
  });

  it('is different for a different kind', () => {
    expect(addressFingerprint({ ...base, kind: 'billing' })).not.toBe(addressFingerprint(base));
  });

  it.each(['recipientName', 'street', 'city', 'postalCode', 'country'] as const)(
    'is different when %s differs',
    (field) => {
      expect(addressFingerprint({ ...base, [field]: `${base[field]}X` })).not.toBe(
        addressFingerprint(base),
      );
    },
  );

  it('cannot be forged by moving text between two fields', () => {
    expect(addressFingerprint({ ...base, street: 'ul. Testowa', city: '1 Warszawa' })).not.toBe(
      addressFingerprint({ ...base, street: 'ul. Testowa 1', city: 'Warszawa' }),
    );
  });
});

describe('takesOverDefault (T-U2)', () => {
  it('makes a personal default the default when the book has none of that kind', () => {
    expect(takesOverDefault({ kind: 'delivery', isDefault: true }, new Set())).toBe(true);
    expect(takesOverDefault({ kind: 'delivery', isDefault: true }, new Set(['billing']))).toBe(true);
  });

  it('keeps the Organization default when the book already has one of that kind', () => {
    expect(takesOverDefault({ kind: 'delivery', isDefault: true }, new Set(['delivery']))).toBe(false);
  });

  it('never makes a row that was not a personal default the default', () => {
    expect(takesOverDefault({ kind: 'billing', isDefault: false }, new Set())).toBe(false);
  });
});
