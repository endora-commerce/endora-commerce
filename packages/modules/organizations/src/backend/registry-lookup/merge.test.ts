import { describe, expect, it } from 'vitest';
import type { CompanyRegistryRecord } from './company-registry-port.js';
import { mergePolishLegs, mergeViesLeg, type RegistryLeg } from './merge.js';

/**
 * Feature 173 (T011; FR-003) — research R-3's tables, one `describe` per
 * Polish-sources mode, every row.
 */

const GUS_RECORD: CompanyRegistryRecord = {
  legalName: 'PRZYKŁADOWA SPÓŁKA Z O.O.',
  address: { street: 'ul. Testowa 12/3', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
  regon: '123456785',
  vatPayerStatus: 'unknown',
  activityStatus: 'active',
};
const MF_RECORD: CompanyRegistryRecord = {
  legalName: 'PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  address: { street: 'UL. TESTOWA 12/3', postalCode: '00-001', city: 'WARSZAWA', country: 'PL' },
  regon: '123456785',
  vatPayerStatus: 'exempt',
  activityStatus: 'unknown',
};

const gus = {
  found: { provider: 'gus_pl', outcome: 'found', record: GUS_RECORD, errorKind: null, durationMs: 40 },
  notFound: { provider: 'gus_pl', outcome: 'not_found', record: null, errorKind: null, durationMs: 40 },
  unavailable: { provider: 'gus_pl', outcome: 'unavailable', record: null, errorKind: 'network_timeout', durationMs: 4000 },
  notConfigured: { provider: 'gus_pl', outcome: 'skipped', record: null, errorKind: 'not_configured', durationMs: null },
  overBudget: { provider: 'gus_pl', outcome: 'unavailable', record: null, errorKind: 'budget_exhausted', durationMs: null },
} satisfies Record<string, RegistryLeg>;
const mf = {
  found: { provider: 'mf_pl', outcome: 'found', record: MF_RECORD, errorKind: null, durationMs: 30 },
  notFound: { provider: 'mf_pl', outcome: 'not_found', record: null, errorKind: null, durationMs: 30 },
  unavailable: { provider: 'mf_pl', outcome: 'unavailable', record: null, errorKind: 'provider_503', durationMs: 30 },
  overBudget: { provider: 'mf_pl', outcome: 'unavailable', record: null, errorKind: 'budget_exhausted', durationMs: null },
} satisfies Record<string, RegistryLeg>;

const attempt = (leg: RegistryLeg) => ({
  provider: leg.provider,
  outcome: leg.outcome,
  errorKind: leg.errorKind,
  durationMs: leg.durationMs,
});
const excluded = (provider: 'gus_pl' | 'mf_pl') => ({
  provider,
  outcome: 'skipped',
  errorKind: 'excluded_by_setting',
  durationMs: null,
});

describe('gus_mf (default) — GUS and the White List in parallel', () => {
  it('GUS found + WL found ⇒ found, GUS data, WL VAT status', () => {
    expect(mergePolishLegs('gus_mf', { gus: gus.found, mf: mf.found })).toEqual({
      status: 'found',
      record: { ...GUS_RECORD, vatPayerStatus: 'exempt' },
      dataSource: 'gus_pl',
      vatStatusSource: 'mf_pl',
      attempts: [attempt(gus.found), attempt(mf.found)],
    });
  });

  it('GUS found + WL not found ⇒ found, VAT status not_registered', () => {
    expect(mergePolishLegs('gus_mf', { gus: gus.found, mf: mf.notFound })).toMatchObject({
      status: 'found',
      record: { ...GUS_RECORD, vatPayerStatus: 'not_registered' },
      dataSource: 'gus_pl',
      vatStatusSource: 'mf_pl',
    });
  });

  it.each([mf.unavailable, mf.overBudget])('GUS found + WL %# unavailable ⇒ found, VAT status unknown', (wl) => {
    expect(mergePolishLegs('gus_mf', { gus: gus.found, mf: wl })).toMatchObject({
      status: 'found',
      record: { ...GUS_RECORD, vatPayerStatus: 'unknown' },
      dataSource: 'gus_pl',
      vatStatusSource: null,
    });
  });

  it.each([gus.notFound, gus.unavailable, gus.notConfigured, gus.overBudget])(
    'GUS %# not usable + WL found ⇒ found from the White List',
    (g) => {
      expect(mergePolishLegs('gus_mf', { gus: g, mf: mf.found })).toEqual({
        status: 'found',
        record: MF_RECORD,
        dataSource: 'mf_pl',
        vatStatusSource: 'mf_pl',
        attempts: [attempt(g), attempt(mf.found)],
      });
    },
  );

  it('GUS not found + WL not found ⇒ not_found', () => {
    expect(mergePolishLegs('gus_mf', { gus: gus.notFound, mf: mf.notFound })).toMatchObject({
      status: 'not_found',
      record: null,
      dataSource: null,
      vatStatusSource: null,
    });
  });

  it.each([gus.unavailable, gus.notConfigured, gus.overBudget])(
    'GUS %# unavailable + WL not found ⇒ not_found (the only registry consulted said so)',
    (g) => {
      expect(mergePolishLegs('gus_mf', { gus: g, mf: mf.notFound }).status).toBe('not_found');
    },
  );

  it('GUS not found + WL unavailable ⇒ not_found (GUS is authoritative for existence)', () => {
    expect(mergePolishLegs('gus_mf', { gus: gus.notFound, mf: mf.unavailable }).status).toBe('not_found');
  });

  it.each([
    [gus.unavailable, mf.unavailable],
    [gus.notConfigured, mf.overBudget],
    [gus.overBudget, mf.unavailable],
  ])('GUS %# + WL unavailable ⇒ unavailable', (g, wl) => {
    expect(mergePolishLegs('gus_mf', { gus: g, mf: wl })).toMatchObject({ status: 'unavailable', record: null });
  });
});

describe('gus — GUS only, the White List never asked', () => {
  it('GUS found ⇒ found, VAT status unknown, no VAT source; WL recorded as excluded', () => {
    expect(mergePolishLegs('gus', { gus: gus.found, mf: null })).toEqual({
      status: 'found',
      record: { ...GUS_RECORD, vatPayerStatus: 'unknown' },
      dataSource: 'gus_pl',
      vatStatusSource: null,
      attempts: [attempt(gus.found), excluded('mf_pl')],
    });
  });

  it('GUS not found ⇒ not_found', () => {
    expect(mergePolishLegs('gus', { gus: gus.notFound, mf: null }).status).toBe('not_found');
  });

  it.each([gus.unavailable, gus.notConfigured, gus.overBudget])(
    'GUS %# unavailable / not configured / over budget ⇒ unavailable, never a White List answer',
    (g) => {
      const merged = mergePolishLegs('gus', { gus: g, mf: null });
      expect(merged).toMatchObject({ status: 'unavailable', record: null, dataSource: null });
      expect(merged.attempts).toEqual([attempt(g), excluded('mf_pl')]);
    },
  );
});

describe('mf — the White List only', () => {
  it('WL found ⇒ found from the White List; GUS recorded as excluded', () => {
    expect(mergePolishLegs('mf', { gus: null, mf: mf.found })).toEqual({
      status: 'found',
      record: MF_RECORD,
      dataSource: 'mf_pl',
      vatStatusSource: 'mf_pl',
      attempts: [excluded('gus_pl'), attempt(mf.found)],
    });
  });

  it('WL not found ⇒ not_found', () => {
    expect(mergePolishLegs('mf', { gus: null, mf: mf.notFound }).status).toBe('not_found');
  });

  it.each([mf.unavailable, mf.overBudget])('WL %# unavailable / over budget ⇒ unavailable', (wl) => {
    expect(mergePolishLegs('mf', { gus: null, mf: wl }).status).toBe('unavailable');
  });
});

describe('VIES — every other EU number', () => {
  const record: CompanyRegistryRecord = {
    legalName: null,
    address: { street: null, postalCode: null, city: null, country: 'DE' },
    regon: null,
    vatPayerStatus: 'active',
    activityStatus: 'unknown',
  };

  it('found ⇒ found with VIES as data and VAT source', () => {
    const leg: RegistryLeg = { provider: 'vies', outcome: 'found', record, errorKind: null, durationMs: 80 };
    expect(mergeViesLeg(leg)).toEqual({
      status: 'found',
      record,
      dataSource: 'vies',
      vatStatusSource: 'vies',
      attempts: [attempt(leg)],
    });
  });

  it('not found and unavailable pass through', () => {
    expect(
      mergeViesLeg({ provider: 'vies', outcome: 'not_found', record: null, errorKind: null, durationMs: 1 }).status,
    ).toBe('not_found');
    expect(
      mergeViesLeg({ provider: 'vies', outcome: 'unavailable', record: null, errorKind: 'x', durationMs: 1 }).status,
    ).toBe('unavailable');
  });
});
