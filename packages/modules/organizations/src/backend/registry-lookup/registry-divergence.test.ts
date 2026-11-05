import { describe, expect, it } from 'vitest';
import { computeRegistryDivergence, type RegistrySide } from './registry-divergence.js';

/**
 * Feature 173 (T050; FR-022) — research R-14: which differences between the
 * registry and the submission a moderator is shown. Synthetic values.
 */

const REGISTRY: RegistrySide = {
  name: 'PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  street: 'UL. TESTOWA 12/3',
  postalCode: '00-001',
  city: 'WARSZAWA',
  country: 'PL',
};

function submitted(overrides: Partial<{ name: string; street: string; postalCode: string; city: string; country: string }> = {}) {
  return {
    name: overrides.name ?? 'Przykładowa sp. z o.o.',
    taxId: '5260250995',
    registeredAddress: {
      street: overrides.street ?? 'Testowa 12/3',
      postalCode: overrides.postalCode ?? '00001',
      city: overrides.city ?? 'Warszawa',
      country: overrides.country ?? 'PL',
    },
  };
}

describe('computeRegistryDivergence', () => {
  it('nothing differs once case, diacritics, punctuation, prefixes, postal format and legal form are set aside', () => {
    expect(computeRegistryDivergence(REGISTRY, submitted())).toEqual([]);
  });

  it.each([
    ['case and diacritics', { city: 'warszawa' }],
    ['whitespace', { street: '  ul.   Testowa   12/3 ' }],
    ['punctuation', { name: 'Przykładowa, Sp. z o. o.' }],
    ['the al. prefix on one side only', { street: 'al. Testowa 12/3' }],
  ])('%s is not a divergence', (_label, overrides) => {
    expect(computeRegistryDivergence(REGISTRY, submitted(overrides))).toEqual([]);
  });

  it.each([
    ['SPÓŁKA AKCYJNA', 'S.A.'],
    ['SPÓŁKA KOMANDYTOWA', 'sp. k.'],
    ['SPÓŁKA JAWNA', 'Sp. j.'],
    ['SPÓŁKA KOMANDYTOWO-AKCYJNA', 'S.K.A.'],
    ['PROSTA SPÓŁKA AKCYJNA', 'P.S.A.'],
    ['SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ', 'spółka z o.o.'],
  ])('the legal form %s ≡ %s', (registryForm, submittedForm) => {
    expect(
      computeRegistryDivergence({ ...REGISTRY, name: `TESTOWA ${registryForm}` }, submitted({ name: `Testowa ${submittedForm}` })),
    ).toEqual([]);
  });

  it('a different legal form is a divergence', () => {
    expect(
      computeRegistryDivergence({ ...REGISTRY, name: 'TESTOWA SPÓŁKA AKCYJNA' }, submitted({ name: 'Testowa sp. z o.o.' })),
    ).toEqual([{ field: 'name', registry: 'TESTOWA SPÓŁKA AKCYJNA', submitted: 'Testowa sp. z o.o.' }]);
  });

  it('a real difference lists both values as written', () => {
    expect(computeRegistryDivergence(REGISTRY, submitted({ street: 'ul. Poprawiona 99', postalCode: '00-950' }))).toEqual([
      { field: 'street', registry: 'UL. TESTOWA 12/3', submitted: 'ul. Poprawiona 99' },
      { field: 'postalCode', registry: '00-001', submitted: '00-950' },
    ]);
  });

  it('a field the registry left empty is never a divergence', () => {
    expect(
      computeRegistryDivergence(
        { name: null, street: null, postalCode: '', city: null, country: 'PL' },
        submitted({ name: 'Anything', street: 'Anywhere 1', postalCode: '99-999', city: 'Elsewhere' }),
      ),
    ).toEqual([]);
  });

  it('the country compares in picker form (GR ≡ EL) and differs otherwise', () => {
    expect(computeRegistryDivergence({ ...REGISTRY, country: 'EL' }, submitted({ country: 'GR' })).map((d) => d.field)).not.toContain(
      'country',
    );
    expect(computeRegistryDivergence(REGISTRY, submitted({ country: 'DE' }))).toContainEqual({
      field: 'country',
      registry: 'PL',
      submitted: 'DE',
    });
  });
});
