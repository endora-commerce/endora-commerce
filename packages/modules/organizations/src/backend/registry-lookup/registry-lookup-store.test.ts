import { describe, expect, it } from 'vitest';
import type { RegistryLookupAnswer } from './company-registry-port.js';
import {
  ANSWER_TTL_SECONDS,
  REGISTRY_BUDGETS,
  REGISTRY_LOOKUP_REDIS_PREFIX,
  TICKET_TTL_SECONDS,
} from './limits.js';
import {
  RegistryLookupStore,
  RegistryLookupStoreError,
  budgetWindow,
  type RegistryLookupRedis,
} from './registry-lookup-store.js';

/**
 * Feature 173 (T012; FR-006, FR-008, FR-009, FR-026b) — the Redis answer cache,
 * the lookup tickets and the per-registry budgets (research R-7, R-8), against
 * a structural fake.
 */

interface FakeRedis extends RegistryLookupRedis {
  values: Map<string, string>;
  ttls: Map<string, number>;
  failing: boolean;
}

function fakeRedis(): FakeRedis {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const redis: FakeRedis = {
    values,
    ttls,
    failing: false,
    async get(key) {
      if (redis.failing) throw new Error('ECONNREFUSED');
      return values.get(key) ?? null;
    },
    async set(key, value, _mode, seconds) {
      if (redis.failing) throw new Error('ECONNREFUSED');
      values.set(key, value);
      ttls.set(key, seconds);
      return 'OK';
    },
    async del(key) {
      if (redis.failing) throw new Error('ECONNREFUSED');
      return values.delete(key) ? 1 : 0;
    },
    async incr(key) {
      if (redis.failing) throw new Error('ECONNREFUSED');
      const next = Number(values.get(key) ?? '0') + 1;
      values.set(key, String(next));
      return next;
    },
    async expire(key, seconds) {
      if (redis.failing) throw new Error('ECONNREFUSED');
      ttls.set(key, seconds);
      return 1;
    },
  };
  return redis;
}

function answer(overrides: Partial<RegistryLookupAnswer> = {}): RegistryLookupAnswer {
  return {
    status: 'found',
    country: 'PL',
    taxId: '5260250995',
    plSources: 'gus_mf',
    record: {
      legalName: 'PRZYKŁADOWA SPÓŁKA',
      address: { street: 'ul. Testowa 1', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
      regon: '123456785',
      vatPayerStatus: 'active',
      activityStatus: 'active',
    },
    dataSource: 'gus_pl',
    vatStatusSource: 'mf_pl',
    attempts: [
      { provider: 'gus_pl', outcome: 'found', errorKind: null, durationMs: 40 },
      { provider: 'mf_pl', outcome: 'found', errorKind: null, durationMs: 30 },
    ],
    fetchedAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('the answer cache', () => {
  it.each([
    ['found', ANSWER_TTL_SECONDS.found],
    ['not_found', ANSWER_TTL_SECONDS.not_found],
    ['unavailable', ANSWER_TTL_SECONDS.unavailable],
  ] as const)('%s is kept for its own TTL', async (status, ttl) => {
    const redis = fakeRedis();
    const store = new RegistryLookupStore(redis);
    await store.writeAnswer(answer({ status, record: status === 'found' ? answer().record : null }));
    const key = `${REGISTRY_LOOKUP_REDIS_PREFIX}answer:PL:gus_mf:5260250995`;
    expect(redis.ttls.get(key)).toBe(ttl);
    expect((await store.readAnswer('PL', 'gus_mf', '5260250995'))?.status).toBe(status);
  });

  it('pins the TTLs research R-8 set', () => {
    expect(ANSWER_TTL_SECONDS).toEqual({ found: 6 * 3600, not_found: 30 * 60, unavailable: 60 });
  });

  it('keys a Polish answer by its mode, so another mode reads nothing (FR-026b)', async () => {
    const store = new RegistryLookupStore(fakeRedis());
    await store.writeAnswer(answer());
    expect(await store.readAnswer('PL', 'gus_mf', '5260250995')).not.toBeNull();
    expect(await store.readAnswer('PL', 'mf', '5260250995')).toBeNull();
    expect(await store.readAnswer('PL', 'gus', '5260250995')).toBeNull();
  });

  it('keys every other country by `vies`', async () => {
    const redis = fakeRedis();
    const store = new RegistryLookupStore(redis);
    await store.writeAnswer(answer({ country: 'DE', taxId: '123456789', plSources: null }));
    expect(redis.values.has(`${REGISTRY_LOOKUP_REDIS_PREFIX}answer:DE:vies:123456789`)).toBe(true);
    expect(await store.readAnswer('DE', null, '123456789')).not.toBeNull();
  });

  it('reads an unparseable or wrongly shaped entry as absent', async () => {
    const redis = fakeRedis();
    const store = new RegistryLookupStore(redis);
    redis.values.set(`${REGISTRY_LOOKUP_REDIS_PREFIX}answer:PL:gus_mf:5260250995`, '{not json');
    expect(await store.readAnswer('PL', 'gus_mf', '5260250995')).toBeNull();
    redis.values.set(`${REGISTRY_LOOKUP_REDIS_PREFIX}answer:PL:gus_mf:5260250995`, JSON.stringify({ status: 'maybe' }));
    expect(await store.readAnswer('PL', 'gus_mf', '5260250995')).toBeNull();
  });
});

describe('tickets', () => {
  it('mints a 43-character base64url id kept for two hours, holding the answer', async () => {
    const redis = fakeRedis();
    const store = new RegistryLookupStore(redis, { now: () => Date.parse('2026-11-05T10:05:00.000Z') });
    const ticket = await store.mintTicket(answer(), true);
    expect(ticket.lookupId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ticket).toMatchObject({ version: 1, fromCache: true, issuedAt: '2026-11-05T10:05:00.000Z', taxId: '5260250995' });
    expect(redis.ttls.get(`${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${ticket.lookupId}`)).toBe(TICKET_TTL_SECONDS);
    expect(TICKET_TTL_SECONDS).toBe(2 * 3600);
    expect(await store.readTicket(ticket.lookupId)).toEqual(ticket);
  });

  it('mints a different id every time', async () => {
    const store = new RegistryLookupStore(fakeRedis());
    const a = await store.mintTicket(answer(), false);
    const b = await store.mintTicket(answer(), false);
    expect(a.lookupId).not.toBe(b.lookupId);
  });

  it('reads invalid JSON, a wrong shape and an unknown id as absent', async () => {
    const redis = fakeRedis();
    const store = new RegistryLookupStore(redis);
    const id = 'A'.repeat(43);
    expect(await store.readTicket(id)).toBeNull();
    redis.values.set(`${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${id}`, '{');
    expect(await store.readTicket(id)).toBeNull();
    redis.values.set(`${REGISTRY_LOOKUP_REDIS_PREFIX}ticket:${id}`, JSON.stringify({ ...answer(), version: 2 }));
    expect(await store.readTicket(id)).toBeNull();
  });

  it('refuses to read an id that is not a lookup id, without asking Redis', async () => {
    const redis = fakeRedis();
    redis.failing = true;
    expect(await new RegistryLookupStore(redis).readTicket('../../etc')).toBeNull();
  });

  it('deletes a ticket', async () => {
    const store = new RegistryLookupStore(fakeRedis());
    const ticket = await store.mintTicket(answer(), false);
    await store.deleteTicket(ticket.lookupId);
    expect(await store.readTicket(ticket.lookupId)).toBeNull();
  });
});

describe('budgets (research R-7 layer 4)', () => {
  it('pins the budgets and windows', () => {
    expect(REGISTRY_BUDGETS).toEqual({
      gus_pl: { limit: 300, window: 'utc_hour' },
      vies: { limit: 300, window: 'utc_hour' },
      mf_pl: { limit: 60, window: 'warsaw_day' },
    });
  });

  it('counts per UTC hour for GUS and VIES, expiring an hour after the window', () => {
    expect(budgetWindow('gus_pl', Date.parse('2026-11-05T23:59:59.000Z'))).toEqual({ id: '2026110523', ttlSeconds: 3601 });
    expect(budgetWindow('vies', Date.parse('2026-11-05T10:00:00.000Z'))).toEqual({ id: '2026110510', ttlSeconds: 7200 });
  });

  it('counts per Europe/Warsaw day for the White List, DST days included', () => {
    // 2026-11-05 is CET (UTC+1): 23:30Z is already the 6th in Warsaw.
    expect(budgetWindow('mf_pl', Date.parse('2026-11-05T23:30:00.000Z')).id).toBe('20261106');
    expect(budgetWindow('mf_pl', Date.parse('2026-11-05T22:59:59.000Z')).id).toBe('20261105');
    // 2026-10-25 is 25 hours long in Warsaw (CEST → CET).
    const start = budgetWindow('mf_pl', Date.parse('2026-10-24T22:00:00.000Z'));
    expect(start).toEqual({ id: '20261025', ttlSeconds: 26 * 3600 });
    expect(budgetWindow('mf_pl', Date.parse('2026-10-25T22:30:00.000Z')).id).toBe('20261025');
    expect(budgetWindow('mf_pl', Date.parse('2026-10-25T23:30:00.000Z')).id).toBe('20261026');
    // 2026-03-29 is 23 hours long (CET → CEST).
    expect(budgetWindow('mf_pl', Date.parse('2026-03-28T23:00:00.000Z'))).toEqual({ id: '20260329', ttlSeconds: 24 * 3600 });
  });

  it('admits up to the budget and refuses beyond it, with the window TTL set once', async () => {
    const redis = fakeRedis();
    const now = Date.parse('2026-11-05T10:00:00.000Z');
    const store = new RegistryLookupStore(redis, { now: () => now, budgets: { gus_pl: { limit: 2, window: 'utc_hour' } } });
    expect(await store.consumeBudget('gus_pl')).toBe(true);
    expect(await store.consumeBudget('gus_pl')).toBe(true);
    expect(await store.consumeBudget('gus_pl')).toBe(false);
    const key = `${REGISTRY_LOOKUP_REDIS_PREFIX}budget:gus_pl:2026110510`;
    expect(redis.values.get(key)).toBe('3');
    expect(redis.ttls.get(key)).toBe(7200);
  });

  it('keeps one budget per registry', async () => {
    const store = new RegistryLookupStore(fakeRedis(), {
      budgets: { gus_pl: { limit: 1, window: 'utc_hour' }, mf_pl: { limit: 1, window: 'warsaw_day' } },
    });
    expect(await store.consumeBudget('gus_pl')).toBe(true);
    expect(await store.consumeBudget('mf_pl')).toBe(true);
    expect(await store.consumeBudget('gus_pl')).toBe(false);
  });
});

describe('Redis failures surface as one typed error (R-7 layer 7: fail closed)', () => {
  it.each([
    ['readAnswer', (s: RegistryLookupStore) => s.readAnswer('PL', 'gus_mf', '5260250995')],
    ['writeAnswer', (s: RegistryLookupStore) => s.writeAnswer(answer())],
    ['mintTicket', (s: RegistryLookupStore) => s.mintTicket(answer(), false)],
    ['readTicket', (s: RegistryLookupStore) => s.readTicket('A'.repeat(43))],
    ['deleteTicket', (s: RegistryLookupStore) => s.deleteTicket('A'.repeat(43))],
    ['consumeBudget', (s: RegistryLookupStore) => s.consumeBudget('vies')],
  ] as const)('%s', async (_name, call) => {
    const redis = fakeRedis();
    redis.failing = true;
    await expect(call(new RegistryLookupStore(redis))).rejects.toBeInstanceOf(RegistryLookupStoreError);
  });
});
