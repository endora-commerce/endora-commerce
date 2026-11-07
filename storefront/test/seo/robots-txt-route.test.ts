import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeCrawlerFile } from '@endora-commerce/contracts/seo';

import type { CrawlerFiles, CrawlerFilesRead } from '../../lib/seo/crawler-policy';
import { GROWTH, LINEAR_BOUND, growthRatio } from './linear-time';
import {
  CRAWLER_FILES_CAPABILITY_HEADER,
  ROBOTS_TXT_RETRY_AFTER_SECONDS,
  robotsTxtResponse,
} from '../../lib/seo/robots-txt';

/**
 * `GET /robots.txt`
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §4).
 *
 * Two halves. The first runs the decision with the read of the backend
 * replaced, one case per answer the reader can give. The second runs the route
 * file itself with `fetch` replaced, because the mistakes that matter most are
 * in the wiring: a channel that never reaches the backend, a `?part=system`
 * that asks it anyway, a route Next may prerender.
 *
 * `__fixtures__/robots-before.txt` is the file as it was served before this
 * feature (see `robots-system-rules.test.ts`); "the fixture" below is that.
 */

const BEFORE = readFileSync(
  fileURLToPath(new URL('./__fixtures__/robots-before.txt', import.meta.url)),
  'utf8',
);

const ORIGIN_KEYS = ['NEXT_PUBLIC_SITE_URL', 'STOREFRONT_URL'] as const;
const ORIGINAL = ORIGIN_KEYS.map((key) => [key, process.env[key]] as const);

beforeEach(() => {
  process.env['NEXT_PUBLIC_SITE_URL'] = 'http://localhost:3000';
});

afterEach(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.resetModules();
});

const files = (overrides: Partial<CrawlerFiles> = {}): CrawlerFiles => ({
  index: true,
  follow: true,
  robotsTxtCustom: '',
  llmsTxtAdditional: '',
  shop: { name: '' },
  ...overrides,
});

const CUSTOM = 'User-agent: GPTBot\nDisallow: /\n';

function serve(
  read: CrawlerFilesRead,
  init: { path?: string; headers?: Record<string, string> } = {},
): { response: Promise<Response>; asked: (string | undefined)[] } {
  const asked: (string | undefined)[] = [];
  const response = robotsTxtResponse(
    new Request(`http://shop.test${init.path ?? '/robots.txt'}`, { headers: init.headers ?? {} }),
    {
      readCrawlerFiles: async (channelCode) => {
        asked.push(channelCode);
        return read;
      },
    },
  );
  return { response, asked };
}

function expectServedHeaders(response: Response): void {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  expect(response.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
  expect(CRAWLER_FILES_CAPABILITY_HEADER).toBe('X-Endora-Crawler-Files');
}

describe('robots.txt — what is served', () => {
  it('is the fixture when the channel has no custom instructions', async () => {
    const { response } = serve({ kind: 'value', value: files() });
    const served = await response;
    expectServedHeaders(served);
    expect(await served.text()).toBe(BEFORE);
  });

  it('is the fixture when the custom instructions are only whitespace', async () => {
    const { response } = serve({ kind: 'value', value: files({ robotsTxtCustom: ' \r\n\t\n' }) });
    expect(await (await response).text()).toBe(BEFORE);
  });

  it('is the system rules, a blank line, then the custom instructions', async () => {
    const { response } = serve({ kind: 'value', value: files({ robotsTxtCustom: CUSTOM }) });
    const served = await response;
    expectServedHeaders(served);
    const body = await served.text();
    expect(body).toBe(`${BEFORE}\n${CUSTOM}`);
    expect(body).toBe(composeCrawlerFile(BEFORE, CUSTOM));
    // The system rules are whole and first: nothing an operator writes can
    // reach into them.
    expect(body.startsWith(BEFORE)).toBe(true);
  });

  it('serves every line break as a line feed, however the text was stored', async () => {
    const { response } = serve({
      kind: 'value',
      value: files({ robotsTxtCustom: 'User-agent: GPTBot\r\nDisallow: /\r\n' }),
    });
    const body = await (await response).text();
    expect(body).toBe(`${BEFORE}\n${CUSTOM}`);
    expect(body).not.toContain('\r');
  });

  it('is the fixture when seo is off or the backend has no such feature (FR-030, FR-031)', async () => {
    const { response } = serve({ kind: 'none' });
    const served = await response;
    expectServedHeaders(served);
    expect(await served.text()).toBe(BEFORE);
  });

  it('is never changed by the default robots policy (FR-015)', async () => {
    const bodies = await Promise.all(
      [
        { index: true, follow: true },
        { index: false, follow: true },
        { index: true, follow: false },
        { index: false, follow: false },
      ].map(async (policy) =>
        (await serve({ kind: 'value', value: files({ ...policy, robotsTxtCustom: CUSTOM }) }).response).text(),
      ),
    );
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toBe(`${BEFORE}\n${CUSTOM}`);
    // …and a noindex channel's file is not closed by this storefront.
    const noindex = await (
      await serve({ kind: 'value', value: files({ index: false, follow: false }) }).response
    ).text();
    expect(noindex).toBe(BEFORE);
    expect(noindex.split('\n')).not.toContain('Disallow: /');
  });

  it('is served when the channel’s default robots, or its llms.txt content, could not be read', async () => {
    // The backend names what it could not read instead of failing the whole
    // answer (`contracts/crawler-policy.md` §2.2). This file reads neither of
    // the things it can name, so a default robots row nobody can interpret
    // does not cost the channel its robots.txt.
    for (const unreadable of [['policy'], ['llmsTxtAdditional'], ['policy', 'llmsTxtAdditional']]) {
      const served = await serve({
        kind: 'value',
        value: files({ index: false, follow: false, robotsTxtCustom: CUSTOM, unreadable }),
      }).response;
      expectServedHeaders(served);
      expect(await served.text()).toBe(`${BEFORE}\n${CUSTOM}`);
    }
  });

  it('serves the text as plain text whatever it looks like', async () => {
    const hostile = '<!doctype html><script>alert(1)</script>\r\nSet-Cookie: a=b\r\n\r\n{"a":1}';
    const { response } = serve({ kind: 'value', value: files({ robotsTxtCustom: hostile }) });
    const served = await response;
    expectServedHeaders(served);
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    // The text is in the body, and nowhere else.
    expect(served.headers.get('set-cookie')).toBeNull();
    expect([...served.headers.keys()].sort()).toEqual([
      'cache-control',
      'content-type',
      'vary',
      'x-content-type-options',
      'x-endora-crawler-files',
    ]);
    expect(await served.text()).toBe(
      `${BEFORE}\n<!doctype html><script>alert(1)</script>\nSet-Cookie: a=b\n\n{"a":1}\n`,
    );
  });
});

/**
 * A store closed to anonymous visitors (`specs/154-sales-channel-access/`):
 * nothing on it is public, so there is nothing a crawler may fetch. The file
 * is still served — a crawler that cannot read it assumes it may fetch
 * everything — and it closes the whole site.
 */
describe('robots.txt — on a store closed to anonymous visitors', () => {
  const CLOSED = 'User-Agent: *\nDisallow: /\n';

  it('disallows everything, and names no sitemap', async () => {
    const served = await serve({ kind: 'value', value: files({ anonymousAccess: false }) }).response;
    expectServedHeaders(served);
    const body = await served.text();
    expect(body).toBe(CLOSED);
    expect(body).not.toMatch(/^sitemap\s*:/im);
    expect(body).not.toMatch(/^allow\s*:/im);
  });

  it('serves none of the operator’s custom instructions — the closed-store rule wins', async () => {
    // A group written for one crawler would replace `Disallow: /` for that
    // crawler and open the store to it.
    const served = await serve({
      kind: 'value',
      value: files({ anonymousAccess: false, robotsTxtCustom: 'User-agent: GPTBot\nAllow: /\n' }),
    }).response;
    expect(await served.text()).toBe(CLOSED);
  });

  it('is the same whatever the default robots policy says, or whether it could be read', async () => {
    for (const value of [
      files({ anonymousAccess: false, index: false, follow: false }),
      files({ anonymousAccess: false, index: false, follow: false, unreadable: ['policy'] }),
      files({ anonymousAccess: false, unreadable: ['llmsTxtAdditional'] }),
    ]) {
      expect(await (await serve({ kind: 'value', value }).response).text()).toBe(CLOSED);
    }
  });

  it('is unchanged on an open store, and when the backend does not say', async () => {
    for (const anonymousAccess of [true, undefined]) {
      const served = await serve({
        kind: 'value',
        value: files({ robotsTxtCustom: CUSTOM, ...(anonymousAccess === undefined ? {} : { anonymousAccess }) }),
      }).response;
      expect(await served.text()).toBe(`${BEFORE}\n${CUSTOM}`);
    }
  });
});

describe('robots.txt — when the instructions cannot be read (FR-022)', () => {
  it('answers a temporary failure when nothing was ever known — never a file that omits them', async () => {
    const { response } = serve({ kind: 'unknown' });
    const served = await response;
    expect(served.status).toBe(503);
    expect(served.headers.get('retry-after')).toBe('120');
    expect(ROBOTS_TXT_RETRY_AFTER_SECONDS).toBe(120);
    expect(served.headers.get('cache-control')).toBe('no-store');
    expect(served.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    // Still this storefront's handler: the Admin UI's preview tells an outage
    // from a storefront that predates the feature by this header.
    expect(served.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
    const body = await served.text();
    // Not a robots.txt: no rule a lenient parser could act on.
    expect(body).not.toMatch(/^(user-agent|allow|disallow|sitemap)\s*:/im);
    expect(body).not.toBe(BEFORE);
  });

  it('serves the last version it knew — the reader hands it over as a value', async () => {
    // "Last known" is the reader's to remember (`crawler-policy.test.ts`); what
    // is held here is that a value is served as one whatever its age.
    const { response } = serve({ kind: 'value', value: files({ robotsTxtCustom: CUSTOM }) });
    const served = await response;
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(`${BEFORE}\n${CUSTOM}`);
  });
});

describe('robots.txt — `?part=system`', () => {
  it('is the fixture, and never asks the backend', async () => {
    for (const read of [
      { kind: 'value', value: files({ robotsTxtCustom: CUSTOM }) },
      { kind: 'none' },
      { kind: 'unknown' },
    ] satisfies CrawlerFilesRead[]) {
      const { response, asked } = serve(read, { path: '/robots.txt?part=system' });
      const served = await response;
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(served.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
      expect(await served.text()).toBe(BEFORE);
      expect(asked).toEqual([]);
    }
  });

  it('may be kept by no cache', async () => {
    // It is the file **without** the operator's instructions, at an address
    // that differs from the real one only by a query string. A cache set up to
    // ignore query strings would store it as `/robots.txt` and serve every
    // crawler a file that omits what the operator wrote. Only the Admin UI's
    // preview asks for it, and it asks each time.
    const served = await serve({ kind: 'none' }, { path: '/robots.txt?part=system' }).response;
    expect(served.headers.get('cache-control')).toBe('no-store');
    // The file itself is still cacheable, for a minute.
    expect((await serve({ kind: 'none' }).response).headers.get('cache-control')).toBe(
      'public, max-age=60',
    );
  });

  it('is not what any other query string means', async () => {
    for (const path of ['/robots.txt?part=', '/robots.txt?part=custom', '/robots.txt?system', '/robots.txt?PART=system']) {
      const { response, asked } = serve(
        { kind: 'value', value: files({ robotsTxtCustom: CUSTOM }) },
        { path },
      );
      expect(await (await response).text(), path).toBe(`${BEFORE}\n${CUSTOM}`);
      expect(asked).toHaveLength(1);
    }
  });
});

/**
 * The handler keeps the file it composed for a channel's configuration and
 * hands it out again for as long as that configuration is the one the reader
 * holds. It cannot be seen from outside except as time, so what is held here
 * is that keeping it never serves the wrong file.
 */
describe('robots.txt — the composed file is kept, and never the wrong one', () => {
  const serveValue = async (value: CrawlerFiles): Promise<string> =>
    (await serve({ kind: 'value', value }).response).text();

  it('serves the same file for the same configuration, asked for repeatedly', async () => {
    const value = files({ robotsTxtCustom: CUSTOM });
    const first = await serveValue(value);
    expect(await serveValue(value)).toBe(first);
    expect(await serveValue(value)).toBe(`${BEFORE}\n${CUSTOM}`);
  });

  it('serves the new text as soon as the reader holds a new configuration', async () => {
    const before = files({ robotsTxtCustom: 'Disallow: /old\n' });
    expect(await serveValue(before)).toBe(`${BEFORE}\nDisallow: /old\n`);
    // A refresh replaces the reader's value with a new object.
    expect(await serveValue(files({ robotsTxtCustom: 'Disallow: /new\n' }))).toBe(
      `${BEFORE}\nDisallow: /new\n`,
    );
    expect(await serveValue(files())).toBe(BEFORE);
    // And the earlier one is still its own.
    expect(await serveValue(before)).toBe(`${BEFORE}\nDisallow: /old\n`);
  });

  it('never serves one configuration’s file for another that has the same text', async () => {
    const a = files({ robotsTxtCustom: CUSTOM });
    const b = files({ robotsTxtCustom: CUSTOM, index: false });
    expect(await serveValue(a)).toBe(await serveValue(b));
  });

  it('follows the system rules when they change under a kept file', async () => {
    const value = files({ robotsTxtCustom: CUSTOM });
    expect(await serveValue(value)).toBe(`${BEFORE}\n${CUSTOM}`);
    process.env['NEXT_PUBLIC_SITE_URL'] = 'https://shop.example.com';
    expect(await serveValue(value)).toBe(
      `${BEFORE.replace('http://localhost:3000', 'https://shop.example.com')}\n${CUSTOM}`,
    );
  });

  it('answers a text made to be slow to trim as fast as any other', async () => {
    // 64 KiB of line breaks before one character: seconds, with a trailing
    // line-break pattern that backtracks. See `composeCrawlerFile`'s tests.
    // Compared across sizes, not against a clock (issue #612). Each call gets a
    // value of its own: the composed file is kept per value.
    const value = (length: number) => files({ robotsTxtCustom: `${'\n'.repeat(length - 1)}x` });
    expect((await serveValue(value(65_536))).endsWith('\nx\n')).toBe(true);
    const ratio = await growthRatio(serveValue, value, 65_536);
    expect(ratio, `${GROWTH}× the text took ${ratio.toFixed(2)}× the time per character`).toBeLessThan(
      LINEAR_BOUND,
    );
  });
});

describe('robots.txt — sales-channel isolation (FR-020)', () => {
  it('asks for the request’s channel, and for none when the request names none', async () => {
    const named = serve({ kind: 'none' }, { headers: { 'x-sales-channel': 'pl_retail' } });
    await named.response;
    expect(named.asked).toEqual(['pl_retail']);

    const unnamed = serve({ kind: 'none' });
    await unnamed.response;
    expect(unnamed.asked).toEqual([undefined]);
  });

  it('tells a shared cache that the answer depends on the channel', async () => {
    for (const read of [{ kind: 'none' }, { kind: 'unknown' }] satisfies CrawlerFilesRead[]) {
      const served = await serve(read).response;
      expect(served.headers.get('vary')).toBe('X-Sales-Channel');
    }
  });
});

/**
 * The route file, as Next loads it — `fetch` is the only thing replaced.
 */
describe('app/robots.txt/route.ts', () => {
  interface Backend {
    calls: { url: string; channel: string | null }[];
    answer: (channel: string | null) => Response | Promise<Response>;
  }

  function backend(answer: Backend['answer']): Backend {
    const state: Backend = { calls: [], answer };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const channel = new Headers(init?.headers).get('x-sales-channel');
      state.calls.push({ url: String(input), channel });
      return state.answer(channel);
    });
    return state;
  }

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const filesAnswer = (robotsTxtCustom: string): Response =>
    json({ data: files({ robotsTxtCustom }) });

  /** A fresh copy of the route, and with it a reader that knows nothing. */
  const route = () => import('../../app/robots.txt/route');
  const get = async (path = '/robots.txt', headers: Record<string, string> = {}) =>
    (await route()).GET(new Request(`http://shop.test${path}`, { headers }));

  it('is rendered per request: Next must not prerender it or cache it by address', async () => {
    const loaded = await route();
    expect(loaded.dynamic).toBe('force-dynamic');
    // Only what Next accepts from a route file, so the build does not refuse it.
    expect(Object.keys(loaded).sort()).toEqual(['GET', 'dynamic']);
  });

  it('has no `app/robots.ts` beside it, which would be served instead of it', () => {
    // Measured on a build holding both: Next reports nothing, prerenders the
    // metadata file as before and never reaches this route — the storefront
    // goes on serving its build-time rules with no custom instructions, and
    // nothing says so. A storefront taking this route deletes that file.
    // Next reads a metadata file with any of its page extensions.
    for (const shadow of ['robots.ts', 'robots.tsx', 'robots.js', 'robots.jsx']) {
      expect(
        existsSync(fileURLToPath(new URL(`../../app/${shadow}`, import.meta.url))),
        `app/${shadow} must not exist`,
      ).toBe(false);
    }
    expect(existsSync(fileURLToPath(new URL('../../public/robots.txt', import.meta.url)))).toBe(
      false,
    );
  });

  it('reads the backend’s crawler-files route for the request’s channel and appends its text', async () => {
    const api = backend(() => filesAnswer(CUSTOM));
    const served = await get('/robots.txt', { 'x-sales-channel': 'pl_retail' });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(`${BEFORE}\n${CUSTOM}`);
    expect(api.calls).toEqual([
      { url: 'http://api.test/api/v1/storefront/seo/crawler-files', channel: 'pl_retail' },
    ]);
  });

  it('never serves one channel’s instructions for another, in one process', async () => {
    const api = backend((channel) =>
      channel === 'a' ? filesAnswer('Disallow: /only-a\n') : filesAnswer(''),
    );
    const { GET } = await route();
    const serveFor = async (channel?: string) =>
      (
        await GET(
          new Request('http://shop.test/robots.txt', {
            headers: channel !== undefined ? { 'x-sales-channel': channel } : {},
          }),
        )
      ).text();

    expect(await serveFor('a')).toBe(`${BEFORE}\nDisallow: /only-a\n`);
    // Inside A's freshness window: A's cached answer is not an answer to B,
    // nor to a request naming no channel.
    expect(await serveFor('b')).toBe(BEFORE);
    expect(await serveFor()).toBe(BEFORE);
    expect(await serveFor('a')).toBe(`${BEFORE}\nDisallow: /only-a\n`);
    expect(api.calls.map((call) => call.channel)).toEqual(['a', 'b', null]);
  });

  it('answers the system rules for `?part=system` with the backend down, and asks nothing', async () => {
    const api = backend(() => {
      throw new TypeError('fetch failed');
    });
    const served = await get('/robots.txt?part=system');
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(BEFORE);
    expect(api.calls).toEqual([]);
  });

  it('answers 503 from a process that knows nothing when the backend cannot be read', async () => {
    backend(() => {
      throw new TypeError('fetch failed');
    });
    const served = await get();
    expect(served.status).toBe(503);
    expect(served.headers.get('retry-after')).toBe('120');
    expect(served.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps serving the last version it read when the backend then fails', async () => {
    const api = backend(() => filesAnswer(CUSTOM));
    const { GET } = await route();
    const request = () => new Request('http://shop.test/robots.txt');
    expect(await (await GET(request())).text()).toBe(`${BEFORE}\n${CUSTOM}`);

    api.answer = () => json({ error: { code: 'INTERNAL' } }, 500);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const later = await GET(request());
      expect(later.status).toBe(200);
      expect(await later.text()).toBe(`${BEFORE}\n${CUSTOM}`);
      expect(api.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves the system rules alone once the backend says seo is off — the text is withdrawn', async () => {
    const api = backend(() => filesAnswer(CUSTOM));
    const { GET } = await route();
    const request = () => new Request('http://shop.test/robots.txt');
    expect(await (await GET(request())).text()).toBe(`${BEFORE}\n${CUSTOM}`);

    api.answer = () => json({ error: { code: 'MODULE_DISABLED' } }, 503);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const off = await GET(request());
      expect(off.status).toBe(200);
      expect(await off.text()).toBe(BEFORE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves the system rules alone against a backend that has no such route', async () => {
    backend(() => json({ error: { code: 'NOT_FOUND' } }, 404));
    const served = await get();
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(BEFORE);
  });
});
