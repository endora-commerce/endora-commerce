import { describe, expect, it } from 'vitest';
import type { MfSearchResult } from '../integrations/ministerstwo-finansow-client.js';
import type { ViesCheckResult } from '../integrations/vies-client.js';
import { MfRegistryAdapter, ViesRegistryAdapter } from './registry-adapters.js';

/**
 * Feature 173 (T010; FR-004, FR-005) — the White List and VIES clients as
 * `CompanyRegistryClient`s, over the one call each shares with `validate()`.
 * Synthetic data.
 */

const SUBJECT = {
  name: 'PRZYKŁADOWA SPÓŁKA AKCYJNA',
  nip: '5260250995',
  statusVat: 'Czynny',
  regon: '123456785',
  workingAddress: 'UL. TESTOWA 1/2, 00-001 WARSZAWA',
  residenceAddress: null,
};

function mf(result: MfSearchResult) {
  const calls: string[] = [];
  return {
    calls,
    adapter: new MfRegistryAdapter({
      search: async (nip: string) => {
        calls.push(nip);
        return result;
      },
    }),
  };
}

function vies(result: ViesCheckResult) {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    adapter: new ViesRegistryAdapter({
      check: async (country: string, number: string) => {
        calls.push([country, number]);
        return result;
      },
    }),
  };
}

describe('MfRegistryAdapter', () => {
  it('found: name, parsed address, REGON, VAT status Czynny ⇒ active; activity unknown', async () => {
    const { adapter, calls } = mf({ status: 'found', subject: SUBJECT });
    expect(await adapter.lookup({ taxId: '5260250995', country: 'PL' })).toEqual({
      provider: 'mf_pl',
      outcome: 'found',
      errorKind: null,
      record: {
        legalName: SUBJECT.name,
        address: { street: 'UL. TESTOWA 1/2', postalCode: '00-001', city: 'WARSZAWA', country: 'PL' },
        regon: '123456785',
        vatPayerStatus: 'active',
        activityStatus: 'unknown',
      },
    });
    expect(calls).toEqual(['5260250995']);
  });

  it.each([
    ['Zwolniony', 'exempt'],
    ['Niezarejestrowany', 'not_registered'],
    ['czynny', 'active'],
    [null, 'unknown'],
    ['Something new', 'unknown'],
  ] as const)('statusVat %s ⇒ %s', async (statusVat, expected) => {
    const { adapter } = mf({ status: 'found', subject: { ...SUBJECT, statusVat } });
    expect((await adapter.lookup({ taxId: '5260250995', country: 'PL' })).record?.vatPayerStatus).toBe(expected);
  });

  it('uses the residence address when there is no working one, and empties for none', async () => {
    const residence = mf({
      status: 'found',
      subject: { ...SUBJECT, workingAddress: null, residenceAddress: 'TESTOWO 5' },
    });
    expect((await residence.adapter.lookup({ taxId: '5260250995', country: 'PL' })).record?.address).toEqual({
      street: 'TESTOWO 5',
      postalCode: null,
      city: null,
      country: 'PL',
    });
    const none = mf({ status: 'found', subject: { ...SUBJECT, workingAddress: null, regon: null, name: null } });
    expect((await none.adapter.lookup({ taxId: '5260250995', country: 'PL' })).record).toMatchObject({
      legalName: null,
      regon: null,
      address: { street: null, postalCode: null, city: null, country: 'PL' },
    });
  });

  it('not found, invalid and unavailable', async () => {
    expect(await mf({ status: 'not_found' }).adapter.lookup({ taxId: '5260250995', country: 'PL' })).toEqual({
      provider: 'mf_pl',
      outcome: 'not_found',
      record: null,
      errorKind: null,
    });
    expect(
      await mf({ status: 'invalid', errorKind: 'http_400' }).adapter.lookup({ taxId: '5260250995', country: 'PL' }),
    ).toEqual({ provider: 'mf_pl', outcome: 'not_found', record: null, errorKind: 'http_400' });
    expect(
      await mf({ status: 'unavailable', errorKind: 'rate_limited' }).adapter.lookup({ taxId: '5260250995', country: 'PL' }),
    ).toEqual({ provider: 'mf_pl', outcome: 'unavailable', record: null, errorKind: 'rate_limited' });
  });
});

describe('ViesRegistryAdapter', () => {
  it('valid ⇒ found, VAT active, the multi-line address split', async () => {
    const { adapter, calls } = vies({
      status: 'valid',
      name: 'PRZYKŁADOWA SPÓŁKA AKCYJNA',
      address: 'UL. TESTOWA 1\n00-001 WARSZAWA',
    });
    expect(await adapter.lookup({ taxId: '5260250995', country: 'PL' })).toEqual({
      provider: 'vies',
      outcome: 'found',
      errorKind: null,
      record: {
        legalName: 'PRZYKŁADOWA SPÓŁKA AKCYJNA',
        address: { street: 'UL. TESTOWA 1', postalCode: '00-001', city: 'WARSZAWA', country: 'PL' },
        regon: null,
        vatPayerStatus: 'active',
        activityStatus: 'unknown',
      },
    });
    expect(calls).toEqual([['PL', '5260250995']]);
  });

  it('valid with "---" (Germany) ⇒ found with no name and no address', async () => {
    const { adapter } = vies({ status: 'valid', name: '---', address: '---' });
    expect((await adapter.lookup({ taxId: '123456789', country: 'DE' })).record).toEqual({
      legalName: null,
      address: { street: null, postalCode: null, city: null, country: 'DE' },
      regon: null,
      vatPayerStatus: 'active',
      activityStatus: 'unknown',
    });
  });

  it('passes the registry spelling of Greece through', async () => {
    const { adapter, calls } = vies({ status: 'invalid' });
    expect((await adapter.lookup({ taxId: '123456789', country: 'EL' })).outcome).toBe('not_found');
    expect(calls).toEqual([['EL', '123456789']]);
  });

  it('refused and unavailable ⇒ unavailable with the kind', async () => {
    expect(
      await vies({ status: 'refused', errorKind: 'http_400' }).adapter.lookup({ taxId: '1', country: 'DE' }),
    ).toEqual({ provider: 'vies', outcome: 'unavailable', record: null, errorKind: 'http_400' });
    expect(
      await vies({ status: 'unavailable', errorKind: 'network_timeout' }).adapter.lookup({ taxId: '1', country: 'DE' }),
    ).toEqual({ provider: 'vies', outcome: 'unavailable', record: null, errorKind: 'network_timeout' });
  });
});
