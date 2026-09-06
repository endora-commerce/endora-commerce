import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  errorCodes,
  isFresh,
  isUnreachableFailure,
  isUnreachableStatus,
  ttlFor,
  verdictFor,
  REACHABLE_TTL_MS,
  UNREACHABLE_TTL_MS,
} from '../lib/api/backend-reachability';
import {
  SERVICE_UNAVAILABLE_PATH,
  gateDecision,
  safeRetryTarget,
} from '../lib/service-unavailable';
import { resolveLocaleWithoutConfig } from '../lib/i18n/locale';
import { CATALOGUE_LOCALES } from '../lib/i18n/messages';

/**
 * The storefront's answer to an unreachable backend.
 *
 * Everything here is either a pure decision or a server render, per the
 * storefront's SSR-only convention: the gate's *effect* is a `NextResponse`
 * built in the edge runtime and is measured against a booted build instead
 * (see the merge request), while the decisions that gate makes are exported as
 * functions and asserted here.
 *
 * The classifier's fixtures are **real error shapes** rather than
 * `{ code: 'ECONNREFUSED' }`: Node reports a refused connection as a
 * `TypeError` whose `cause` carries the code, and a multi-address host as an
 * `AggregateError` whose `errors` each carry one. A walker written against the
 * flat shape passes a flat fixture and sees neither.
 */

describe('classifying a transport failure', () => {
  it('reads the code out of a fetch failure the way Node reports one', () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), {
        code: 'ECONNREFUSED',
      }),
    });
    expect(errorCodes(refused)).toContain('ECONNREFUSED');
    expect(isUnreachableFailure(refused)).toBe(true);
  });

  it('reads a multi-address host, where the codes are inside an AggregateError', () => {
    const aggregate = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:3001'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), { code: 'ECONNREFUSED' }),
      ],
      'All connection attempts failed',
    );
    const failure = new TypeError('fetch failed', { cause: aggregate });
    expect(isUnreachableFailure(failure)).toBe(true);
  });

  it('reads DNS and routing failures as unreachable', () => {
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET']) {
      const failure = new TypeError('fetch failed', {
        cause: Object.assign(new Error(code), { code }),
      });
      expect(isUnreachableFailure(failure), code).toBe(true);
    }
  });

  it('reads a connect timeout as unreachable and a slow answer as not', () => {
    const connect = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    });
    const slow = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Headers Timeout Error'), {
        code: 'UND_ERR_HEADERS_TIMEOUT',
      }),
    });
    expect(isUnreachableFailure(connect)).toBe(true);
    // The discrimination this whole feature turns on: a backend that is merely
    // slow must not take the shop to 503.
    expect(isUnreachableFailure(slow)).toBe(false);
  });

  it('reads an application defect as nothing of its own', () => {
    // The shapes constraint 2 is about. None of them may look like an outage,
    // because a `503` here is a defect nobody investigates.
    expect(isUnreachableFailure(new TypeError('x.map is not a function'))).toBe(false);
    expect(isUnreachableFailure(new Error('Invalid input: expected string'))).toBe(false);
    expect(isUnreachableFailure(new TypeError("Cannot read properties of null"))).toBe(false);
    expect(isUnreachableFailure(null)).toBe(false);
    expect(isUnreachableFailure(undefined)).toBe(false);
    expect(isUnreachableFailure('ECONNREFUSED')).toBe(false);
  });

  it('survives a cyclic cause chain rather than hanging on it', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(() => errorCodes(a)).not.toThrow();
    expect(isUnreachableFailure(a)).toBe(false);
  });
});

describe('classifying an answered status', () => {
  it('reads the gateway trio as the origin saying the backend is not behind it', () => {
    expect(isUnreachableStatus(502)).toBe(true);
    expect(isUnreachableStatus(503)).toBe(true);
    expect(isUnreachableStatus(504)).toBe(true);
  });

  it('reads an application 500 as reachable', () => {
    // Something answered. One endpoint failing is not the shop being down, and
    // treating it as one would 503 every route over a single broken handler.
    expect(isUnreachableStatus(500)).toBe(false);
    for (const status of [200, 204, 304, 400, 401, 404]) {
      expect(isUnreachableStatus(status), String(status)).toBe(false);
    }
  });

  it('turns either outcome into one verdict', () => {
    expect(verdictFor({ status: 200 })).toBe('reachable');
    expect(verdictFor({ status: 503 })).toBe('unreachable');
    expect(verdictFor({ error: new Error('boom') })).toBe('reachable');
    expect(
      verdictFor({
        error: new TypeError('fetch failed', {
          cause: Object.assign(new Error('r'), { code: 'ECONNREFUSED' }),
        }),
      }),
    ).toBe('unreachable');
  });
});

describe('how long a verdict is reused', () => {
  it('holds a reachable verdict longer than an unreachable one', () => {
    // A backend that has come back should be served again promptly; a backend
    // that is up does not need re-asking every request.
    expect(ttlFor('unreachable')).toBeLessThan(ttlFor('reachable'));
    expect(ttlFor('reachable')).toBe(REACHABLE_TTL_MS);
    expect(ttlFor('unreachable')).toBe(UNREACHABLE_TTL_MS);
  });

  it('expires each verdict on its own window', () => {
    expect(isFresh(null, 1_000)).toBe(false);
    expect(isFresh({ verdict: 'reachable', at: 0 }, REACHABLE_TTL_MS - 1)).toBe(true);
    expect(isFresh({ verdict: 'reachable', at: 0 }, REACHABLE_TTL_MS)).toBe(false);
    expect(isFresh({ verdict: 'unreachable', at: 0 }, UNREACHABLE_TTL_MS - 1)).toBe(true);
    expect(isFresh({ verdict: 'unreachable', at: 0 }, UNREACHABLE_TTL_MS)).toBe(false);
  });
});

describe('what the gate does with a request', () => {
  it('asks about an ordinary document request', () => {
    expect(gateDecision({ pathname: '/', prefetch: false })).toBe('ask');
    expect(gateDecision({ pathname: '/p/some-product', prefetch: false })).toBe('ask');
    expect(gateDecision({ pathname: '/cart', prefetch: false })).toBe('ask');
  });

  it('answers the notice at 503 without asking, whoever addressed it', () => {
    // Measured answering `200` while this returned "skip the gate", which is a
    // document saying the shop is down above a status line saying it is up.
    expect(gateDecision({ pathname: SERVICE_UNAVAILABLE_PATH, prefetch: false })).toBe(
      'unavailable',
    );
    expect(gateDecision({ pathname: SERVICE_UNAVAILABLE_PATH, prefetch: true })).toBe(
      'unavailable',
    );
  });

  it('passes a prefetch through, whose answer the router would cache', () => {
    expect(gateDecision({ pathname: '/catalog', prefetch: true })).toBe('pass');
  });
});

describe('the retry target', () => {
  it('keeps the address the buyer asked for, query included', () => {
    expect(safeRetryTarget('/c/fasteners?page=2')).toBe('/c/fasteners?page=2');
    expect(safeRetryTarget('/')).toBe('/');
  });

  it('refuses anything that could leave this origin', () => {
    expect(safeRetryTarget('//evil.example/x')).toBe('/');
    expect(safeRetryTarget('https://evil.example')).toBe('/');
    expect(safeRetryTarget('javascript:alert(1)')).toBe('/');
    expect(safeRetryTarget('/\\evil.example')).toBe('/');
    expect(safeRetryTarget(null)).toBe('/');
    expect(safeRetryTarget(undefined)).toBe('/');
  });
});

describe('the language the outage answers in', () => {
  it('ships both languages the catalogue carries', () => {
    expect(CATALOGUE_LOCALES).toContain('en-US');
    expect(CATALOGUE_LOCALES).toContain('pl-PL');
  });

  it('matches a language-only tag against a regional catalogue entry', () => {
    const pick = (acceptLanguage: string | null): string =>
      resolveLocaleWithoutConfig({
        acceptLanguage,
        available: CATALOGUE_LOCALES,
        fallback: 'en-US',
      });
    expect(pick('pl')).toBe('pl-PL');
    expect(pick('pl-PL')).toBe('pl-PL');
    expect(pick('pl-PL,pl;q=0.9,en-US;q=0.8')).toBe('pl-PL');
    expect(pick('en-GB,en;q=0.9')).toBe('en-US');
    expect(pick('de-DE')).toBe('en-US');
    expect(pick(null)).toBe('en-US');
  });

  it('answers even when the catalogue does not carry the fallback', () => {
    expect(
      resolveLocaleWithoutConfig({ acceptLanguage: null, available: ['pl-PL'], fallback: 'en-US' }),
    ).toBe('pl-PL');
    expect(
      resolveLocaleWithoutConfig({ acceptLanguage: 'pl', available: [], fallback: 'en-US' }),
    ).toBe('en-US');
  });
});

const requestHeaders = new Map<string, string>();

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null }),
}));

async function renderNotice(headerValues: Record<string, string>): Promise<string> {
  requestHeaders.clear();
  for (const [name, value] of Object.entries(headerValues)) {
    requestHeaders.set(name.toLowerCase(), value);
  }
  const { default: ServiceUnavailablePage } = await import('../app/service-unavailable/page');
  return renderToString((await ServiceUnavailablePage()) as React.ReactElement);
}

describe('the notice itself', () => {
  beforeEach(() => {
    requestHeaders.clear();
  });

  it('answers in Polish when the buyer asks in Polish', async () => {
    const html = await renderNotice({ 'accept-language': 'pl-PL,pl;q=0.9' });
    expect(html).toContain('Serwis jest chwilowo niedostępny.');
    expect(html).toContain('Spróbuj ponownie');
    expect(html).toContain('Nic nie zginęło.');
  });

  it('answers in English otherwise', async () => {
    const html = await renderNotice({ 'accept-language': 'en-GB' });
    expect(html).toContain('The shop is temporarily unavailable.');
    expect(html).toContain('Try again');
  });

  it('carries exactly one h1', async () => {
    const html = await renderNotice({});
    expect(html.match(/<h1/g) ?? []).toHaveLength(1);
  });

  it('retries the page the buyer asked for, not the home page', async () => {
    const html = await renderNotice({ 'x-backend-unreachable-retry': '/c/fasteners?page=2' });
    expect(html).toContain('href="/c/fasteners?page=2"');
  });

  it('falls back to the home page when the asked-for address cannot be trusted', async () => {
    const html = await renderNotice({ 'x-backend-unreachable-retry': '//evil.example' });
    expect(html).not.toContain('evil.example');
    expect(html).toContain('href="/"');
  });

  it('carries the state as a word and not only as a colour', async () => {
    // WCAG 2.2 AA, 1.4.1. The amber pill is a second signal; the word is the
    // first one, and it is what a reader with no colour perception gets.
    const html = await renderNotice({ 'accept-language': 'en-US' });
    expect(html).toContain('Temporary outage');
  });

  it('hides its decorative icons from assistive technology', async () => {
    const html = await renderNotice({});
    for (const svg of html.match(/<svg[^>]*>/g) ?? []) {
      expect(svg, svg).toContain('aria-hidden="true"');
    }
    expect(html.match(/<svg[^>]*>/g) ?? []).not.toHaveLength(0);
  });

  it('does not auto-refresh, which would fail SC 2.2.1', async () => {
    // A `<meta http-equiv="refresh">` moves a reader out from under themselves
    // on a timer they cannot extend or turn off. The retry is the buyer's.
    const html = await renderNotice({});
    expect(html.toLowerCase()).not.toContain('http-equiv="refresh"');
  });

  it('renders with no request header at all', async () => {
    // The notice is directly addressable, and a request that reached it without
    // the gate carries neither the locale hint nor the retry target.
    const html = await renderNotice({});
    expect(html).toContain('The shop is temporarily unavailable.');
    expect(html).toContain('href="/"');
  });
});
