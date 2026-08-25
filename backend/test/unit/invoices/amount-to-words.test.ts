import { describe, expect, it } from 'vitest';
import { amountToWords } from '../../../../packages/modules/invoices/src/backend/services/amount-to-words.js';

describe('amountToWords — Polish', () => {
  it('spells the reference invoice total (6648.15 PLN)', () => {
    // Faktura FV 26/2026: "sześć tysięcy sześćset czterdzieści osiem złotych 15/100"
    expect(amountToWords(6648.15, 'PLN', 'pl')).toBe(
      'sześć tysięcy sześćset czterdzieści osiem złotych 15/100',
    );
  });

  it('handles zero', () => {
    expect(amountToWords(0, 'PLN', 'pl')).toBe('zero złotych 00/100');
  });

  it('uses the singular currency form for 1', () => {
    expect(amountToWords(1, 'PLN', 'pl')).toBe('jeden złoty 00/100');
  });

  it('uses the paucal form for 2-4', () => {
    expect(amountToWords(2, 'PLN', 'pl')).toBe('dwa złote 00/100');
    expect(amountToWords(23, 'PLN', 'pl')).toBe('dwadzieścia trzy złote 00/100');
  });

  it('drops the leading "jeden" for an even thousand', () => {
    expect(amountToWords(1000, 'PLN', 'pl')).toBe('tysiąc złotych 00/100');
  });

  it('pads grosze to two digits', () => {
    expect(amountToWords(10.5, 'PLN', 'pl')).toBe('dziesięć złotych 50/100');
    expect(amountToWords(10.05, 'PLN', 'pl')).toBe('dziesięć złotych 05/100');
  });
});

describe('amountToWords — English', () => {
  it('spells a large amount', () => {
    expect(amountToWords(6648.15, 'PLN', 'en')).toBe(
      'six thousand six hundred forty-eight zlotys 15/100',
    );
  });

  it('uses singular for 1', () => {
    expect(amountToWords(1, 'USD', 'en')).toBe('one dollar 00/100');
  });

  it('hyphenates compound tens', () => {
    expect(amountToWords(42, 'USD', 'en')).toBe('forty-two dollars 00/100');
  });
});
