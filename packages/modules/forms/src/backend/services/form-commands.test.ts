import { describe, expect, it } from 'vitest';
import { keyFromName } from './form-commands.js';

/**
 * `specs/170-forms-module/` research R-4 — the key a form is given from its name: lower-case
 * ASCII, `_` between words, starting with a letter, at most 64 characters. Built on the shared
 * fold (`slugify`, issue #244), so a letter NFD cannot decompose is mapped rather than dropped.
 */
describe('keyFromName', () => {
  it.each([
    ['Contact the shop', 'contact_the_shop'],
    ['Zapytanie ofertowe – Łódź', 'zapytanie_ofertowe_lodz'],
    ['Große Anfrage', 'grosse_anfrage'],
    ['Søknad Æble', 'soknad_aeble'],
    ['2026 survey', 'form_2026_survey'],
    ['  --  ', 'form'],
  ])('%j → %j', (name, key) => {
    expect(keyFromName(name)).toBe(key);
  });

  it('keeps at most 64 characters and never ends on a separator', () => {
    const key = keyFromName(`${'a'.repeat(63)} b c`);
    expect(key).toBe('a'.repeat(63));
    expect(keyFromName('x'.repeat(80))).toHaveLength(64);
  });
});
