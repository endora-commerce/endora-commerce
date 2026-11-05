import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GusBirClient } from './gus-bir-client.js';
import { GUS_ENDPOINTS } from './gus-bir-soap.js';
import type { GusCredential } from '../registry-lookup/company-registry-port.js';

/**
 * Feature 173 (T009; FR-003, FR-005, FR-007, FR-011) — the GUS BIR1.1 client,
 * row by row through `contracts/gus-bir11-client.md` §4, its session handling
 * (research R-9) and its timeouts, against synthetic fixtures in captured
 * framing. No socket is opened.
 */

/**
 * Synthetic GUS BIR1.1 bodies, `gus-fixture-*.txt` beside this test (a sibling
 * test is what keeps them out of the published package, D-218). The MTOM
 * framing, namespaces, action URIs, the escaped inner document with its `&#xD;`
 * and the self-closing empty leaves are copied from what the T001 spike captured
 * from the GUS **test** environment; every data value is invented.
 */
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(here, `gus-fixture-${name}`), 'utf8');
const MTOM =
  'multipart/related; type="application/xop+xml";start="<http://tempuri.org/0>";boundary="uuid:00000000-0000-4000-8000-000000000173+id=1";start-info="application/soap+xml"';
const SID = 'fixturesid0000000001';
const KEY = 'secret-gus-key-0123456789';
const CREDENTIAL: GusCredential = { apiKey: KEY, environment: 'test' };

type Op = 'login' | 'search' | 'KomunikatKod' | 'StatusSesji';
type Answer = string | Response | Error | 'hang' | { delayMs: number; body: string };

interface Call {
  op: Op;
  url: string;
  sid: string | null;
  contentType: string | null;
  body: string;
}

function opOf(body: string): Op {
  if (body.includes('/Zaloguj</wsa:Action>')) return 'login';
  if (body.includes('/DaneSzukajPodmioty</wsa:Action>')) return 'search';
  return body.includes('StatusSesji') ? 'StatusSesji' : 'KomunikatKod';
}

/** A fake GUS: each operation answers from its own queue; the last entry repeats. */
function fakeGus(script: Partial<Record<Op, Answer[]>>) {
  const calls: Call[] = [];
  const queues = new Map<Op, Answer[]>(Object.entries(script) as Array<[Op, Answer[]]>);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    const op = opOf(body);
    const headers = new Headers(init?.headers);
    calls.push({ op, url: String(input), sid: headers.get('sid'), contentType: headers.get('content-type'), body });
    const queue = queues.get(op) ?? [];
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    if (answer === undefined) throw new Error(`no scripted answer for ${op}`);
    const signal = init?.signal;
    return await new Promise<Response>((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort);
      if (answer === 'hang') return;
      if (answer instanceof Error) return reject(answer);
      if (answer instanceof Response) return resolve(answer);
      if (typeof answer === 'object') {
        setTimeout(() => resolve(new Response(answer.body, { status: 200, headers: { 'content-type': MTOM } })), answer.delayMs);
        return;
      }
      resolve(new Response(answer, { status: 200, headers: { 'content-type': MTOM } }));
    });
  }) as typeof globalThis.fetch;
  return { fetchImpl, calls, count: (op: Op) => calls.filter((c) => c.op === op).length };
}

function recordingLogger() {
  const entries: unknown[] = [];
  return {
    entries,
    logger: {
      warn: (obj: object, msg: string) => entries.push({ level: 'warn', obj, msg }),
      info: (obj: object, msg: string) => entries.push({ level: 'info', obj, msg }),
    },
  };
}

function lookup(client: GusBirClient, credential: GusCredential = CREDENTIAL, taxId = '5260250995') {
  return client.lookup({ taxId, country: 'PL', gusCredential: credential });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GusBirClient — outcomes (contracts/gus-bir11-client.md §4)', () => {
  it('found: logs in, searches with the sid header, composes the address (research R-4)', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-legal.txt')] });
    const answer = await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }));
    expect(answer).toEqual({
      provider: 'gus_pl',
      outcome: 'found',
      errorKind: null,
      record: {
        legalName: 'PRZYKŁADOWA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ "TEST" & WSPÓLNICY',
        address: { street: 'ul. Testowa 12/3A', postalCode: '00-001', city: 'Warszawa', country: 'PL' },
        regon: '123456785',
        vatPayerStatus: 'unknown',
        activityStatus: 'active',
      },
    });
    expect(gus.calls.map((c) => c.op)).toEqual(['login', 'search']);
    expect(gus.calls.every((c) => c.url === GUS_ENDPOINTS.test)).toBe(true);
    expect(gus.calls.every((c) => c.contentType === 'application/soap+xml; charset=utf-8')).toBe(true);
    expect(gus.calls[0]!.sid).toBeNull();
    expect(gus.calls[1]!.sid).toBe(SID);
    expect(gus.calls[1]!.body).toContain('<dat:Nip>5260250995</dat:Nip>');
  });

  it('a unit with an end date ⇒ found, activity ceased, no unit number', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-ceased.txt')] });
    const answer = await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }));
    expect(answer.record).toMatchObject({ activityStatus: 'ceased', address: { street: 'ul. Testowa 12' } });
  });

  it('a village with no street ⇒ street from the locality, city from the post town', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-village.txt')] });
    const answer = await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }), CREDENTIAL, '1234563218');
    expect(answer.record?.address).toEqual({
      street: 'Testowo Małe 7',
      postalCode: '05-555',
      city: 'Testowo Duże',
      country: 'PL',
    });
  });

  it('several units ⇒ a main unit over a local one, then one not ceased; a bare postal code is formatted', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-several.txt')] });
    const answer = await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }));
    expect(answer.record).toMatchObject({
      legalName: 'NOWA SPÓŁKA TESTOWA',
      regon: '222222222',
      activityStatus: 'active',
      address: { postalCode: '00-002' },
    });
  });

  it('ErrorCode 4 inside <dane> ⇒ not_found (T001)', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-not-found.txt')] });
    expect(await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).toEqual({
      provider: 'gus_pl',
      outcome: 'not_found',
      record: null,
      errorKind: null,
    });
  });

  it('an empty result with KomunikatKod 4 ⇒ not_found', async () => {
    const gus = fakeGus({
      login: [fixture('login-ok.txt')],
      search: [fixture('search-empty.txt')],
      KomunikatKod: [fixture('getvalue-4.txt')],
    });
    expect((await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).outcome).toBe('not_found');
  });

  it('any other code ⇒ unavailable / gus_code_<n>', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-error-code-2.txt')] });
    expect(await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).toMatchObject({
      outcome: 'unavailable',
      errorKind: 'gus_code_2',
    });
  });

  it('an empty login result ⇒ unavailable / gus_invalid_key, warned once per key per hour', async () => {
    let now = 1_000_000;
    const gus = fakeGus({ login: [fixture('login-empty.txt')] });
    const { entries, logger } = recordingLogger();
    const client = new GusBirClient({ fetchImpl: gus.fetchImpl, logger, now: () => now });
    expect(await lookup(client)).toMatchObject({ outcome: 'unavailable', errorKind: 'gus_invalid_key' });
    await lookup(client);
    expect(entries.filter((e) => (e as { level: string }).level === 'warn')).toHaveLength(1);
    now += 61 * 60 * 1000;
    await lookup(client);
    expect(entries.filter((e) => (e as { level: string }).level === 'warn')).toHaveLength(2);
    expect(gus.count('search')).toBe(0);
  });

  it('HTTP 5xx ⇒ unavailable / provider_<status>; a network error ⇒ network_error', async () => {
    const failing = fakeGus({ login: [new Response('down', { status: 503 })] });
    expect(await lookup(new GusBirClient({ fetchImpl: failing.fetchImpl }))).toMatchObject({
      outcome: 'unavailable',
      errorKind: 'provider_503',
    });
    const broken = fakeGus({ login: [new TypeError('fetch failed')] });
    expect(await lookup(new GusBirClient({ fetchImpl: broken.fetchImpl }))).toMatchObject({
      outcome: 'unavailable',
      errorKind: 'network_error',
    });
  });

  it('an unreadable body — a DTD, an oversized body, no envelope ⇒ unavailable / invalid_response', async () => {
    for (const body of [fixture('search-dtd.txt'), fixture('search-found-legal.txt') + ' '.repeat(256 * 1024), '<html/>']) {
      const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [body] });
      expect(await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).toMatchObject({
        outcome: 'unavailable',
        errorKind: 'invalid_response',
      });
    }
  });

  it('no credential ⇒ unavailable / not_configured, nothing called', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')] });
    const answer = await new GusBirClient({ fetchImpl: gus.fetchImpl }).lookup({ taxId: '5260250995', country: 'PL' });
    expect(answer).toMatchObject({ outcome: 'unavailable', errorKind: 'not_configured' });
    expect(gus.calls).toHaveLength(0);
  });

  it('the production environment selects the production endpoint', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-legal.txt')] });
    await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }), { apiKey: KEY, environment: 'production' });
    expect(gus.calls.every((c) => c.url === GUS_ENDPOINTS.production)).toBe(true);
  });
});

describe('GusBirClient — session (research R-9)', () => {
  it('reuses the session within 50 minutes and logs in again after', async () => {
    let now = 0;
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-legal.txt')] });
    const client = new GusBirClient({ fetchImpl: gus.fetchImpl, now: () => now });
    await lookup(client);
    now += 49 * 60 * 1000;
    await lookup(client);
    expect(gus.count('login')).toBe(1);
    now += 50 * 60 * 1000;
    await lookup(client);
    expect(gus.count('login')).toBe(2);
    expect(gus.count('search')).toBe(3);
  });

  it('two concurrent lookups share one login (single-flight)', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-legal.txt')] });
    const client = new GusBirClient({ fetchImpl: gus.fetchImpl });
    const [a, b] = await Promise.all([lookup(client), lookup(client)]);
    expect(a.outcome).toBe('found');
    expect(b.outcome).toBe('found');
    expect(gus.count('login')).toBe(1);
  });

  it('logs in again when the key or the environment changes', async () => {
    const gus = fakeGus({ login: [fixture('login-ok.txt')], search: [fixture('search-found-legal.txt')] });
    const client = new GusBirClient({ fetchImpl: gus.fetchImpl });
    await lookup(client);
    await lookup(client, { apiKey: `${KEY}-rotated`, environment: 'test' });
    await lookup(client, { apiKey: `${KEY}-rotated`, environment: 'production' });
    expect(gus.count('login')).toBe(3);
  });

  it('a stale sid (empty result, empty KomunikatKod, StatusSesji 0 — T001) ⇒ re-login once and retry', async () => {
    const gus = fakeGus({
      login: [fixture('login-ok.txt')],
      search: [fixture('search-empty.txt'), fixture('search-found-legal.txt')],
      KomunikatKod: [fixture('getvalue-empty.txt')],
      StatusSesji: [fixture('getvalue-0.txt')],
    });
    const answer = await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }));
    expect(answer.outcome).toBe('found');
    expect(gus.calls.map((c) => c.op)).toEqual(['login', 'search', 'KomunikatKod', 'StatusSesji', 'login', 'search']);
  });

  it('KomunikatKod 7 is also the session signal', async () => {
    const gus = fakeGus({
      login: [fixture('login-ok.txt')],
      search: [fixture('search-empty.txt'), fixture('search-found-legal.txt')],
      KomunikatKod: [fixture('getvalue-7.txt')],
    });
    expect((await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).outcome).toBe('found');
    expect(gus.count('login')).toBe(2);
  });

  it('a session still stale after the retry ⇒ unavailable / gus_session, one retry only', async () => {
    const gus = fakeGus({
      login: [fixture('login-ok.txt')],
      search: [fixture('search-empty.txt')],
      KomunikatKod: [fixture('getvalue-empty.txt')],
      StatusSesji: [fixture('getvalue-0.txt')],
    });
    expect(await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).toMatchObject({
      outcome: 'unavailable',
      errorKind: 'gus_session',
    });
    expect(gus.count('login')).toBe(2);
    expect(gus.count('search')).toBe(2);
  });

  it('an empty result on a live session with no code ⇒ unavailable, no re-login', async () => {
    const gus = fakeGus({
      login: [fixture('login-ok.txt')],
      search: [fixture('search-empty.txt')],
      KomunikatKod: [fixture('getvalue-empty.txt')],
      StatusSesji: [fixture('getvalue-1.txt')],
    });
    expect(await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl }))).toMatchObject({
      outcome: 'unavailable',
      errorKind: 'gus_empty_result',
    });
    expect(gus.count('login')).toBe(1);
  });
});

describe('GusBirClient — timeouts (FR-007)', () => {
  it('a request that never answers ⇒ unavailable / network_timeout after the per-request limit', async () => {
    vi.useFakeTimers();
    const gus = fakeGus({ login: ['hang'] });
    const pending = lookup(new GusBirClient({ fetchImpl: gus.fetchImpl, requestTimeoutMs: 4000, totalTimeoutMs: 6000 }));
    let settled: unknown = null;
    void pending.then((a) => (settled = a));
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ outcome: 'unavailable', errorKind: 'network_timeout' });
  });

  it('login and search together over the total limit ⇒ network_timeout at the total limit', async () => {
    vi.useFakeTimers();
    const gus = fakeGus({
      login: [{ delayMs: 3500, body: fixture('login-ok.txt') }],
      search: [{ delayMs: 3500, body: fixture('search-found-legal.txt') }],
    });
    const pending = lookup(new GusBirClient({ fetchImpl: gus.fetchImpl, requestTimeoutMs: 4000, totalTimeoutMs: 6000 }));
    let settled: unknown = null;
    void pending.then((a) => (settled = a));
    await vi.advanceTimersByTimeAsync(5999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ outcome: 'unavailable', errorKind: 'network_timeout' });
  });
});

describe('GusBirClient — the key and the sid never leave (FR-011)', () => {
  it('nothing the logger received and nothing returned contains them', async () => {
    const { entries, logger } = recordingLogger();
    const scripts: Array<Partial<Record<Op, Answer[]>>> = [
      { login: [fixture('login-ok.txt')], search: [fixture('search-found-legal.txt')] },
      { login: [fixture('login-empty.txt')] },
      {
        login: [fixture('login-ok.txt')],
        search: [fixture('search-empty.txt')],
        KomunikatKod: [fixture('getvalue-empty.txt')],
        StatusSesji: [fixture('getvalue-0.txt')],
      },
      { login: [fixture('login-ok.txt')], search: [new TypeError(`boom ${SID} ${KEY}`)] },
      { login: [fixture('login-ok.txt')], search: [fixture('search-dtd.txt')] },
    ];
    const returned: unknown[] = [];
    for (const script of scripts) {
      const gus = fakeGus(script);
      returned.push(await lookup(new GusBirClient({ fetchImpl: gus.fetchImpl, logger })));
    }
    const everything = JSON.stringify({ entries, returned });
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain(SID);
  });
});
