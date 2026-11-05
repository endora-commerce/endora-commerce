import { afterEach, describe, expect, it, vi } from 'vitest';
import { registryLookupResponseSchema } from '@endora-commerce/contracts';
import type {
  CompanyRegistryAnswer,
  CompanyRegistryClient,
  CompanyRegistryLookupInput,
  CompanyRegistryRecord,
  GusCredential,
  RegistryPlSources,
  RegistryProvider,
} from './company-registry-port.js';
import { REGISTRY_LOOKUP_REDIS_PREFIX } from './limits.js';
import { RegistryLookupService } from './registry-lookup-service.js';
import { RegistryLookupStore, budgetWindow, type RegistryLookupRedis } from './registry-lookup-store.js';

/**
 * Feature 173 (T013; FR-001 – FR-004, FR-003a, FR-006 – FR-010, FR-026a,
 * FR-026b) — the orchestration, with fake clients that count calls and a
 * structural fake Redis behind the real store.
 */

const NIP = '5260250995';
const KEY: GusCredential = { apiKey: 'secret-key', environment: 'test' };

function record(country = 'PL', vat: CompanyRegistryRecord['vatPayerStatus'] = 'unknown'): CompanyRegistryRecord {
  return {
    legalName: `${country} COMPANY`,
    address: { street: 'ul. Testowa 1', postalCode: '00-001', city: 'Warszawa', country },
    regon: country === 'PL' ? '123456785' : null,
    vatPayerStatus: vat,
    activityStatus: country === 'PL' ? 'active' : 'unknown',
  };
}

type Behaviour = 'found' | 'not_found' | 'unavailable' | 'hang' | 'throw';

class FakeClient implements CompanyRegistryClient {
  calls: CompanyRegistryLookupInput[] = [];
  behaviour: Behaviour = 'found';
  constructor(
    readonly provider: RegistryProvider,
    private readonly found: (input: CompanyRegistryLookupInput) => CompanyRegistryRecord,
  ) {}
  async lookup(input: CompanyRegistryLookupInput): Promise<CompanyRegistryAnswer> {
    this.calls.push(input);
    switch (this.behaviour) {
      case 'hang':
        return new Promise(() => {});
      case 'throw':
        throw new Error('boom');
      case 'found':
        return { provider: this.provider, outcome: 'found', record: this.found(input), errorKind: null };
      case 'not_found':
        return { provider: this.provider, outcome: 'not_found', record: null, errorKind: null };
      case 'unavailable':
        return { provider: this.provider, outcome: 'unavailable', record: null, errorKind: 'provider_503' };
    }
  }
}

function fakeRedis() {
  const values = new Map<string, string>();
  const state = { failing: false, incrs: [] as string[] };
  const guard = () => {
    if (state.failing) throw new Error('ECONNREFUSED');
  };
  const redis: RegistryLookupRedis = {
    async get(key) {
      guard();
      return values.get(key) ?? null;
    },
    async set(key, value) {
      guard();
      values.set(key, value);
      return 'OK';
    },
    async del(key) {
      guard();
      return values.delete(key) ? 1 : 0;
    },
    async incr(key) {
      guard();
      state.incrs.push(key);
      const next = Number(values.get(key) ?? '0') + 1;
      values.set(key, String(next));
      return next;
    },
    async expire() {
      guard();
      return 1;
    },
  };
  return { redis, values, state };
}

function setup(options: { mode?: RegistryPlSources | (() => Promise<unknown>); credential?: GusCredential | null } = {}) {
  const gus = new FakeClient('gus_pl', () => record('PL'));
  const mf = new FakeClient('mf_pl', () => record('PL', 'active'));
  const vies = new FakeClient('vies', (input) => record(input.country, 'active'));
  const { redis, values, state } = fakeRedis();
  const store = new RegistryLookupStore(redis);
  let mode: RegistryPlSources | (() => Promise<unknown>) = options.mode ?? 'gus_mf';
  let credential: GusCredential | null = options.credential === undefined ? KEY : options.credential;
  const resolver = vi.fn(async () => credential);
  const service = new RegistryLookupService({
    clients: () => ({ gusPl: gus, mfPl: mf, vies }),
    store,
    readPlSources: async () => (typeof mode === 'function' ? mode() : mode),
    resolveGusCredential: resolver,
  });
  return {
    service,
    gus,
    mf,
    vies,
    values,
    state,
    resolver,
    setMode: (next: RegistryPlSources) => (mode = next),
    setCredential: (next: GusCredential | null) => (credential = next),
    budgetIncrs: (provider: string) => state.incrs.filter((k) => k.includes(`budget:${provider}:`)).length,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('routing and normalisation (FR-001, FR-002, FR-004)', () => {
  it('a valid Polish NIP ⇒ GUS and the White List, in parallel, under the default', async () => {
    const t = setup();
    const result = await t.service.lookup({ taxId: 'PL 526-025-09-95', country: 'PL' });
    expect(result).toMatchObject({
      status: 'found',
      normalizedTaxId: NIP,
      country: 'PL',
      source: 'gus',
      company: { vatStatus: 'active', regon: '123456785', registeredAddress: { country: 'PL' } },
    });
    expect(result.lookupId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(t.gus.calls).toEqual([{ taxId: NIP, country: 'PL', gusCredential: KEY }]);
    expect(t.mf.calls).toEqual([{ taxId: NIP, country: 'PL' }]);
    expect(t.vies.calls).toHaveLength(0);
    expect(registryLookupResponseSchema.safeParse({ data: result }).success).toBe(true);
  });

  it('an EU number ⇒ VIES alone, with the country it used in picker form', async () => {
    const t = setup();
    const result = await t.service.lookup({ taxId: 'EL123456789', country: 'PL' });
    expect(result).toMatchObject({ status: 'found', source: 'vies', country: 'GR', normalizedTaxId: '123456789' });
    expect(result.company?.registeredAddress.country).toBe('GR');
    expect(t.vies.calls).toEqual([{ taxId: '123456789', country: 'EL' }]);
    expect(t.gus.calls).toHaveLength(0);
    expect(t.mf.calls).toHaveLength(0);
  });

  it.each([
    [{ taxId: 'PL1234567890', country: 'PL' }, 'invalid_tax_id', 'PL'],
    [{ taxId: '123', country: 'US' }, 'unsupported_country', 'US'],
  ] as const)('%o ⇒ %s with zero calls and zero Redis', async (input, status, country) => {
    const t = setup();
    t.state.failing = true; // any Redis access would turn the answer into `unavailable`
    expect(await t.service.lookup(input)).toEqual({
      status,
      lookupId: null,
      normalizedTaxId: null,
      country,
      source: null,
      company: null,
      fetchedAt: null,
    });
    expect([...t.gus.calls, ...t.mf.calls, ...t.vies.calls]).toHaveLength(0);
    expect(t.resolver).not.toHaveBeenCalled();
  });
});

describe('cache, tickets and budgets (FR-006, FR-008, FR-009)', () => {
  it('a second lookup of the same ID contacts nothing and consumes no budget, but mints a new ticket', async () => {
    const t = setup();
    const first = await t.service.lookup({ taxId: NIP, country: 'PL' });
    const incrsAfterFirst = t.state.incrs.length;
    const second = await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(t.gus.calls).toHaveLength(1);
    expect(t.mf.calls).toHaveLength(1);
    expect(t.state.incrs.length).toBe(incrsAfterFirst);
    expect(second.lookupId).not.toBe(first.lookupId);
    const ticket = JSON.parse(t.values.get(`${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${second.lookupId}`)!);
    expect(ticket.fromCache).toBe(true);
  });

  it('mints a ticket for every consulted outcome', async () => {
    for (const behaviour of ['found', 'not_found', 'unavailable'] as const) {
      const t = setup({ mode: 'mf' });
      t.mf.behaviour = behaviour;
      const result = await t.service.lookup({ taxId: NIP, country: 'PL' });
      expect(result.status).toBe(behaviour);
      expect(result.lookupId).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(t.values.has(`${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${result.lookupId}`)).toBe(true);
    }
  });

  it('a spent budget ⇒ that leg budget_exhausted without calling its client', async () => {
    const t = setup({ mode: 'mf' });
    t.values.set(`${REGISTRY_LOOKUP_REDIS_PREFIX}budget:mf_pl:${budgetWindow('mf_pl', Date.now()).id}`, '60');
    const result = await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(result.status).toBe('unavailable');
    expect(t.mf.calls).toHaveLength(0);
    const ticket = JSON.parse(t.values.get(`${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${result.lookupId}`)!);
    expect(ticket.attempts).toContainEqual({ provider: 'mf_pl', outcome: 'unavailable', errorKind: 'budget_exhausted', durationMs: null });
  });

  it('a Redis failure ⇒ unavailable with no lookup id, and no registry is called', async () => {
    const t = setup();
    t.state.failing = true;
    expect(await t.service.lookup({ taxId: NIP, country: 'PL' })).toMatchObject({
      status: 'unavailable',
      lookupId: null,
      normalizedTaxId: NIP,
      company: null,
    });
    expect([...t.gus.calls, ...t.mf.calls]).toHaveLength(0);
  });

  it('never-resolving clients ⇒ unavailable within 8 s', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.gus.behaviour = 'hang';
    t.mf.behaviour = 'hang';
    let settled: Awaited<ReturnType<typeof t.service.lookup>> | null = null;
    void t.service.lookup({ taxId: NIP, country: 'PL' }).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(8000);
    expect(settled).toMatchObject({ status: 'unavailable' });
  });

  it('a client that throws is an unavailable leg, not a failed lookup', async () => {
    const t = setup({ mode: 'gus' });
    t.gus.behaviour = 'throw';
    expect((await t.service.lookup({ taxId: NIP, country: 'PL' })).status).toBe('unavailable');
  });

  it('never says whether the tax ID is registered here: the answer carries only the contract keys', async () => {
    const t = setup();
    const result = await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(Object.keys(result).sort()).toEqual(
      ['company', 'country', 'fetchedAt', 'lookupId', 'normalizedTaxId', 'source', 'status'].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
});

describe('Polish sources, per mode (FR-003, FR-003a, FR-026a, FR-026b)', () => {
  it('gus_mf ⇒ both clients once', async () => {
    const t = setup({ mode: 'gus_mf' });
    await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect([t.gus.calls.length, t.mf.calls.length, t.vies.calls.length]).toEqual([1, 1, 0]);
  });

  it('gus ⇒ the White List zero calls and its budget untouched; VAT status unknown', async () => {
    const t = setup({ mode: 'gus' });
    const result = await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(result).toMatchObject({ status: 'found', source: 'gus', company: { vatStatus: 'unknown' } });
    expect(t.mf.calls).toHaveLength(0);
    expect(t.budgetIncrs('mf_pl')).toBe(0);
    expect(t.budgetIncrs('gus_pl')).toBe(1);
  });

  it('mf ⇒ GUS zero calls, the credential resolver never asked, its budget untouched', async () => {
    const t = setup({ mode: 'mf' });
    const result = await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(result).toMatchObject({ status: 'found', source: 'mf', company: { vatStatus: 'active' } });
    expect(t.gus.calls).toHaveLength(0);
    expect(t.resolver).not.toHaveBeenCalled();
    expect(t.budgetIncrs('gus_pl')).toBe(0);
  });

  it('gus_mf with no credential ⇒ GUS skipped, the White List answers', async () => {
    const t = setup({ mode: 'gus_mf', credential: null });
    expect(await t.service.lookup({ taxId: NIP, country: 'PL' })).toMatchObject({ status: 'found', source: 'mf' });
    expect(t.gus.calls).toHaveLength(0);
    expect(t.budgetIncrs('gus_pl')).toBe(0);
  });

  it('gus with no credential ⇒ unavailable, zero calls', async () => {
    const t = setup({ mode: 'gus', credential: null });
    expect((await t.service.lookup({ taxId: NIP, country: 'PL' })).status).toBe('unavailable');
    expect([...t.gus.calls, ...t.mf.calls, ...t.vies.calls]).toHaveLength(0);
  });

  it('a credential resolver that throws reads as no credential', async () => {
    const t = setup({ mode: 'gus_mf' });
    t.resolver.mockRejectedValueOnce(new Error('credentials off'));
    expect(await t.service.lookup({ taxId: NIP, country: 'PL' })).toMatchObject({ status: 'found', source: 'mf' });
    expect(t.gus.calls).toHaveLength(0);
  });

  it.each(['gus_mf', 'gus', 'mf'] as const)('under %s a non-Polish number goes to VIES only', async (mode) => {
    const t = setup({ mode });
    expect((await t.service.lookup({ taxId: 'DE123456789', country: 'DE' })).source).toBe('vies');
    expect([t.gus.calls.length, t.mf.calls.length, t.vies.calls.length]).toEqual([0, 0, 1]);
    expect(t.resolver).not.toHaveBeenCalled();
  });

  it.each(['gus_mf', 'gus', 'mf'] as const)('under %s VIES is never asked about a Polish NIP', async (mode) => {
    const t = setup({ mode });
    t.gus.behaviour = 'unavailable';
    t.mf.behaviour = 'unavailable';
    await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(t.vies.calls).toHaveLength(0);
  });

  it('the mode reader fails closed: a throw or an unknown value is gus_mf', async () => {
    const throwing = setup({ mode: async () => Promise.reject(new Error('settings down')) });
    await throwing.service.lookup({ taxId: NIP, country: 'PL' });
    expect([throwing.gus.calls.length, throwing.mf.calls.length]).toEqual([1, 1]);
    const unknown = setup({ mode: async () => 'everything' });
    await unknown.service.lookup({ taxId: NIP, country: 'PL' });
    expect([unknown.gus.calls.length, unknown.mf.calls.length]).toEqual([1, 1]);
  });

  it('a cached gus_mf answer is not served after the mode changes to mf', async () => {
    const t = setup({ mode: 'gus_mf' });
    expect((await t.service.lookup({ taxId: NIP, country: 'PL' })).source).toBe('gus');
    t.setMode('mf');
    const after = await t.service.lookup({ taxId: NIP, country: 'PL' });
    expect(after.source).toBe('mf');
    expect(t.mf.calls).toHaveLength(2);
    expect(t.gus.calls).toHaveLength(1);
  });
});
