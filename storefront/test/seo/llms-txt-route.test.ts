import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeCrawlerFile } from '@endora-commerce/contracts/seo';

import {
  READ_TIMEOUT_MS,
  STALE_REFRESH_BUDGET_MS,
  type CrawlerFiles,
  type CrawlerFilesRead,
} from '../../lib/seo/crawler-policy';
// The shared linear-time protocol (issue #953): a test-only module of
// `@endora-commerce/contracts`, reached through its source path and never published.
import { GROWTH, LINEAR_BOUND, growthRatio } from '../../../packages/contracts/src/linear-time.cases.js';
import { CRAWLER_FILES_CAPABILITY_HEADER } from '../../lib/seo/crawler-file-response';
import { llmsTxtResponse, type UnservedPages } from '../../lib/seo/llms-txt';
import { renderLlmsTxtBase } from '../../lib/seo/llms-txt-base';
import { RESERVED_TOP_LEVEL_SEGMENTS } from '../../app/reserved-segments';

/**
 * `GET /llms.txt`
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §5;
 * FR-024 – FR-030).
 *
 * The same two halves as `robots-txt-route.test.ts`, for the same reason: the
 * decision with its reads replaced, then the route file as Next loads it with
 * only `fetch` replaced.
 *
 * What is different from `robots.txt` is what this file is mostly about. That
 * file is always served; this one is an invitation, and is **withdrawn**:
 * on a channel that asks not to be indexed, with `seo` off, and whenever it
 * cannot be established that the channel may be indexed.
 */

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
  shop: { name: 'Endora Demo' },
  ...overrides,
});

const ADDITIONAL = '## About\n\nWe sell bolts.\n';
const ALL_SERVED: UnservedPages = { paths: [], certain: true };
const base = (shopName = 'Endora Demo', unservedPaths: readonly string[] = []): string =>
  renderLlmsTxtBase({ shopName, unservedPaths });

interface Served {
  response: Promise<Response>;
  asked: (string | undefined)[];
  pagesAsked: (string | undefined)[];
}

function serve(
  read: CrawlerFilesRead,
  init: {
    path?: string;
    headers?: Record<string, string>;
    pages?: UnservedPages | (() => Promise<UnservedPages>);
  } = {},
): Served {
  const asked: (string | undefined)[] = [];
  const pagesAsked: (string | undefined)[] = [];
  const response = llmsTxtResponse(
    new Request(`http://shop.test${init.path ?? '/llms.txt'}`, { headers: init.headers ?? {} }),
    {
      readCrawlerFiles: async (channelCode) => {
        asked.push(channelCode);
        return read;
      },
      readUnservedPages: async (channelCode) => {
        pagesAsked.push(channelCode);
        return typeof init.pages === 'function' ? init.pages() : (init.pages ?? ALL_SERVED);
      },
    },
  );
  return { response, asked, pagesAsked };
}

const HEADER_NAMES = [
  'cache-control',
  'content-type',
  'vary',
  'x-content-type-options',
  'x-endora-crawler-files',
];

function expectServedHeaders(response: Response): void {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('public, max-age=60');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe('X-Sales-Channel');
  expect(response.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
  expect([...response.headers.keys()].sort()).toEqual(HEADER_NAMES);
}

function expectNotFound(response: Response): void {
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  // A withdrawn file must be seen withdrawn, and come back, without a cache's say.
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('vary')).toBe('X-Sales-Channel');
  // Still this storefront's handler: it is how the Admin UI's preview tells
  // "no llms.txt for this channel" from a storefront that has no such route.
  expect(response.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
}

function expectUnavailable(response: Response): void {
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('120');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  expect(response.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
}

describe('llms.txt — what is served', () => {
  it('is the generated base alone when the channel has no additional content (FR-024)', async () => {
    const served = await serve({ kind: 'value', value: files() }).response;
    expectServedHeaders(served);
    const body = await served.text();
    expect(body).toBe(base());
    expect(body.split('\n')[0]).toBe('# Endora Demo');
  });

  it('is the base alone when the content is only whitespace', async () => {
    const served = await serve({ kind: 'value', value: files({ llmsTxtAdditional: ' \r\n\t\n' }) })
      .response;
    expect(await served.text()).toBe(base());
  });

  it('is the base, a blank line, then the additional content, as written (FR-026)', async () => {
    const served = await serve({ kind: 'value', value: files({ llmsTxtAdditional: ADDITIONAL }) })
      .response;
    expectServedHeaders(served);
    const body = await served.text();
    expect(body).toBe(`${base()}\n${ADDITIONAL}`);
    // The one composition rule, shared with robots.txt and the Admin preview.
    expect(body).toBe(composeCrawlerFile(base(), ADDITIONAL));
    expect(body.startsWith(base())).toBe(true);
  });

  it('serves every line break as a line feed and drops one leading byte order mark', async () => {
    const served = await serve({
      kind: 'value',
      value: files({ llmsTxtAdditional: '﻿## About\r\n\r\nWe sell bolts.\r\n' }),
    }).response;
    const body = await served.text();
    expect(body).toBe(`${base()}\n${ADDITIONAL}`);
    expect(body).not.toContain('\r');
    expect(body).not.toContain('﻿');
  });

  it('never carries the robots.txt instructions', async () => {
    const served = await serve({
      kind: 'value',
      value: files({ robotsTxtCustom: 'User-agent: GPTBot\nDisallow: /\n' }),
    }).response;
    const body = await served.text();
    expect(body).toBe(base());
    expect(body).not.toContain('GPTBot');
  });

  it('names the shop by its host when it has no name', async () => {
    const served = await serve({ kind: 'value', value: files({ shop: { name: '' } }) }).response;
    expect((await served.text()).split('\n')[0]).toBe('# localhost:3000');
  });

  it('serves the content as plain text whatever it looks like', async () => {
    const hostile = '<!doctype html><script>alert(1)</script>\r\nSet-Cookie: a=b\r\n\r\n{"a":1}';
    const served = await serve({ kind: 'value', value: files({ llmsTxtAdditional: hostile }) })
      .response;
    expectServedHeaders(served);
    expect(served.headers.get('set-cookie')).toBeNull();
    expect(await served.text()).toBe(
      `${base()}\n<!doctype html><script>alert(1)</script>\nSet-Cookie: a=b\n\n{"a":1}\n`,
    );
  });

  it('is not changed by link-following being forbidden: only indexing withdraws it', async () => {
    const served = await serve({
      kind: 'value',
      value: files({ index: true, follow: false, llmsTxtAdditional: ADDITIONAL }),
    }).response;
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(`${base()}\n${ADDITIONAL}`);
  });
});

describe('llms.txt — when it is not served', () => {
  it.each([
    ['NOINDEX, FOLLOW', { index: false, follow: true }],
    ['NOINDEX, NOFOLLOW', { index: false, follow: false }],
  ])('answers not found on a channel set to %s, whatever the content holds (FR-027)', async (_token, policy) => {
    for (const llmsTxtAdditional of ['', ADDITIONAL, 'x'.repeat(65_536)]) {
      const served = await serve({ kind: 'value', value: files({ ...policy, llmsTxtAdditional }) })
        .response;
      expectNotFound(served);
      const body = await served.text();
      expect(body).not.toContain('About');
      expect(body).not.toContain('Endora Demo');
      expect(body.length).toBeLessThan(200);
    }
  });

  it('answers not found when seo is off or the backend has no such feature (FR-030)', async () => {
    const served = await serve({ kind: 'none' }).response;
    expectNotFound(served);
    // Nothing of the base either: with the module off there is no such file.
    expect(await served.text()).not.toContain('#');
  });

  it('does not ask which pages are served for a file it will not serve', async () => {
    for (const read of [
      { kind: 'none' },
      { kind: 'unknown' },
      { kind: 'value', value: files({ index: false }) },
    ] satisfies CrawlerFilesRead[]) {
      const { response, pagesAsked } = serve(read);
      await response;
      expect(pagesAsked).toEqual([]);
    }
  });
});

/**
 * A store closed to anonymous visitors (`specs/154-sales-channel-access/`):
 * nothing on it is public, so the file names the store and says so — no page,
 * no sitemap, none of the operator's content — and it is served whatever the
 * default robots says, because it invites nobody anywhere.
 */
describe('llms.txt — on a store closed to anonymous visitors', () => {
  const CLOSED = '# Endora Demo\n\n> The content of this store is available to signed-in customers only.\n';

  it('names the store and says its content is for signed-in customers only', async () => {
    const { response, pagesAsked } = serve({
      kind: 'value',
      value: files({ anonymousAccess: false, llmsTxtAdditional: ADDITIONAL }),
    });
    const served = await response;
    expectServedHeaders(served);
    const body = await served.text();
    expect(body).toBe(CLOSED);
    // No link of any kind, and nothing the operator wrote.
    expect(body).not.toContain('](');
    expect(body).not.toContain('About');
    // Nothing on it depends on which pages are served.
    expect(pagesAsked).toEqual([]);
  });

  it('names the store by its host when it has no name', async () => {
    const served = await serve({
      kind: 'value',
      value: files({ anonymousAccess: false, shop: { name: '' } }),
    }).response;
    expect((await served.text()).split('\n')[0]).toBe('# localhost:3000');
  });

  it('is served whatever the default robots says, or whether it could be read', async () => {
    for (const value of [
      files({ anonymousAccess: false, index: false, follow: false }),
      files({ anonymousAccess: false, index: false, follow: false, unreadable: ['policy'] }),
      files({ anonymousAccess: false, unreadable: ['llmsTxtAdditional'] }),
    ]) {
      const served = await serve({ kind: 'value', value }).response;
      expectServedHeaders(served);
      expect(await served.text()).toBe(CLOSED);
    }
  });

  it('is the closed file at `?part=base` too, and kept by no cache there', async () => {
    const served = await serve(
      { kind: 'value', value: files({ anonymousAccess: false, llmsTxtAdditional: ADDITIONAL }) },
      { path: '/llms.txt?part=base' },
    ).response;
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toBe('no-store');
    expect(await served.text()).toBe(CLOSED);
  });

  it('is unchanged on an open store, and when the backend does not say', async () => {
    for (const anonymousAccess of [true, undefined]) {
      const served = await serve({
        kind: 'value',
        value: files({
          llmsTxtAdditional: ADDITIONAL,
          ...(anonymousAccess === undefined ? {} : { anonymousAccess }),
        }),
      }).response;
      expect(await served.text()).toBe(`${base()}\n${ADDITIONAL}`);
    }
  });
});

describe('llms.txt — when the configuration cannot be read (FR-029, FR-022)', () => {
  it('answers a temporary failure when nothing was ever known — never a file that omits the content', async () => {
    const served = await serve({ kind: 'unknown' }).response;
    expectUnavailable(served);
    const body = await served.text();
    // Not an llms.txt: no heading and no link a reader could act on.
    expect(body).not.toMatch(/^#|\]\(/m);
  });

  it('serves the last version it knew — the reader hands it over as a value', async () => {
    const served = await serve({ kind: 'value', value: files({ llmsTxtAdditional: ADDITIONAL }) })
      .response;
    expect(served.status).toBe(200);
  });

  /**
   * The backend names what it could not read instead of failing the whole
   * answer (`contracts/crawler-policy.md` §2.2), so that `robots.txt` survives
   * an unreadable default robots. This file needs both things it can name.
   */
  it('answers a temporary failure when the channel’s default robots is not known', async () => {
    // The two booleans say "do not index" then, but that is the safe reading
    // of an unknown, not a decision anybody made: "ask again later", not
    // "there is no such file".
    for (const policy of [
      { index: false, follow: false },
      { index: true, follow: true },
    ]) {
      const served = await serve({
        kind: 'value',
        value: files({ ...policy, llmsTxtAdditional: ADDITIONAL, unreadable: ['policy'] }),
      }).response;
      expectUnavailable(served);
      expect(await served.text()).not.toContain('About');
    }
  });

  it('answers a temporary failure when the additional content is not known — never the base alone', async () => {
    const served = await serve({
      kind: 'value',
      value: files({ unreadable: ['llmsTxtAdditional'] }),
    }).response;
    expectUnavailable(served);
    expect(await served.text()).not.toContain('Endora Demo');
  });

  it('is not disturbed by a name it does not know in that list', async () => {
    const served = await serve({
      kind: 'value',
      value: files({ llmsTxtAdditional: ADDITIONAL, unreadable: ['somethingLater'] }),
    }).response;
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(`${base()}\n${ADDITIONAL}`);
  });
});

describe('llms.txt — `?part=base`', () => {
  it('is the generated base alone, without the additional content', async () => {
    const served = await serve(
      { kind: 'value', value: files({ llmsTxtAdditional: ADDITIONAL }) },
      { path: '/llms.txt?part=base' },
    ).response;
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('vary')).toBe('X-Sales-Channel');
    expect(served.headers.get(CRAWLER_FILES_CAPABILITY_HEADER)).toBe('1');
    expect(await served.text()).toBe(base());
  });

  it('may be kept by no cache', async () => {
    // The file without the operator's content, at an address that differs
    // from the real one by a query string only.
    const served = await serve({ kind: 'value', value: files() }, { path: '/llms.txt?part=base' })
      .response;
    expect(served.headers.get('cache-control')).toBe('no-store');
  });

  it('is withdrawn under exactly the conditions the file is', async () => {
    const at = (read: CrawlerFilesRead) => serve(read, { path: '/llms.txt?part=base' }).response;
    expectNotFound(await at({ kind: 'value', value: files({ index: false }) }));
    expectNotFound(await at({ kind: 'none' }));
    expectUnavailable(await at({ kind: 'unknown' }));
    expectUnavailable(await at({ kind: 'value', value: files({ unreadable: ['policy'] }) }));
  });

  it('is not what any other query string means', async () => {
    for (const path of ['/llms.txt?part=', '/llms.txt?part=system', '/llms.txt?base', '/llms.txt?PART=base']) {
      const served = await serve(
        { kind: 'value', value: files({ llmsTxtAdditional: ADDITIONAL }) },
        { path },
      ).response;
      expect(await served.text(), path).toBe(`${base()}\n${ADDITIONAL}`);
      expect(served.headers.get('cache-control')).toBe('public, max-age=60');
    }
  });
});

describe('llms.txt — pages this storefront does not serve right now (FR-025)', () => {
  it('leaves out a page that would answer not found', async () => {
    const served = await serve(
      { kind: 'value', value: files({ llmsTxtAdditional: ADDITIONAL }) },
      { pages: { paths: ['/blog'], certain: true } },
    ).response;
    const body = await served.text();
    expect(body).toBe(`${base('Endora Demo', ['/blog'])}\n${ADDITIONAL}`);
    expect(body).not.toContain('/blog');
  });

  it('asks about the request’s channel', async () => {
    const { response, pagesAsked } = serve(
      { kind: 'value', value: files() },
      { headers: { 'x-sales-channel': 'pl_retail' } },
    );
    await response;
    expect(pagesAsked).toEqual(['pl_retail']);
  });

  /**
   * A file built without knowing whether a page exists is not one to hand to
   * a shared cache for a minute: the next request may know. The question is
   * the reader's to remember (`llms-txt-pages.ts`); this module asks it for
   * every request and keeps nothing of the answer.
   */
  it('serves a file it was not sure of without the page, and lets no cache keep it', async () => {
    const value = files({ llmsTxtAdditional: ADDITIONAL });
    const unsure = serve({ kind: 'value', value }, { pages: { paths: ['/blog'], certain: false } });
    const served = await unsure.response;
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toBe('no-store');
    expect(await served.text()).toBe(`${base('Endora Demo', ['/blog'])}\n${ADDITIONAL}`);
    // Once the answer is certain the same configuration is served whole, and cacheable.
    const again = serve({ kind: 'value', value }, { pages: ALL_SERVED });
    const sure = await again.response;
    expect(sure.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await sure.text()).toContain('/blog');
    expect(again.pagesAsked).toEqual([undefined]);
  });

  it('a certain "not served" is cacheable like any other file', async () => {
    const served = await serve(
      { kind: 'value', value: files() },
      { pages: { paths: ['/blog'], certain: true } },
    ).response;
    expect(served.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('serves the file when the question itself fails: without the pages it could not confirm, uncached', async () => {
    const { response } = serve(
      { kind: 'value', value: files({ llmsTxtAdditional: ADDITIONAL }) },
      { pages: () => Promise.reject(new Error('boom')) },
    );
    const served = await response;
    expect(served.status).toBe(200);
    expect(served.headers.get('cache-control')).toBe('no-store');
    const body = await served.text();
    expect(body).not.toContain('/blog');
    expect(body.endsWith(`\n${ADDITIONAL}`)).toBe(true);
  });
});

describe('llms.txt — the composed file is kept, and never the wrong one', () => {
  const serveValue = async (value: CrawlerFiles): Promise<string> =>
    (await serve({ kind: 'value', value }).response).text();

  it('serves the same file for the same configuration, asked for repeatedly', async () => {
    const value = files({ llmsTxtAdditional: ADDITIONAL });
    const first = await serveValue(value);
    expect(await serveValue(value)).toBe(first);
    expect(first).toBe(`${base()}\n${ADDITIONAL}`);
  });

  it('serves the new content as soon as the reader holds a new configuration', async () => {
    const before = files({ llmsTxtAdditional: 'old\n' });
    expect(await serveValue(before)).toBe(`${base()}\nold\n`);
    expect(await serveValue(files({ llmsTxtAdditional: 'new\n' }))).toBe(`${base()}\nnew\n`);
    expect(await serveValue(files())).toBe(base());
    expect(await serveValue(before)).toBe(`${base()}\nold\n`);
  });

  it('is recomposed when the rendered base differs from the one a kept file was made with', async () => {
    // In a unit test the origin can be moved under a kept file. A built
    // storefront cannot do this: `NEXT_PUBLIC_SITE_URL` is fixed by the build.
    const value = files({ llmsTxtAdditional: ADDITIONAL });
    expect(await serveValue(value)).toContain('http://localhost:3000/catalog');
    process.env['NEXT_PUBLIC_SITE_URL'] = 'https://shop.example.com';
    const moved = await serveValue(value);
    expect(moved).toContain('https://shop.example.com/catalog');
    expect(moved).not.toContain('localhost');
  });

  it('answers content made to be slow to trim as fast as any other', async () => {
    // Compared across sizes, not against a clock (issue #612). Each call gets a
    // value of its own: the composed file is kept per value.
    const value = (length: number) => files({ llmsTxtAdditional: `${'\n'.repeat(length - 1)}x` });
    expect((await serveValue(value(65_536))).endsWith('\nx\n')).toBe(true);
    const ratio = await growthRatio(serveValue, value, 65_536);
    expect(ratio, `${GROWTH}× the content took ${ratio.toFixed(2)}× the time per character`).toBeLessThan(
      LINEAR_BOUND,
    );
  });
});

describe('llms.txt — sales-channel isolation', () => {
  it('asks for the request’s channel, and for none when the request names none', async () => {
    const named = serve({ kind: 'none' }, { headers: { 'x-sales-channel': 'pl_retail' } });
    await named.response;
    expect(named.asked).toEqual(['pl_retail']);

    const unnamed = serve({ kind: 'none' });
    await unnamed.response;
    expect(unnamed.asked).toEqual([undefined]);
  });

  it('tells a shared cache that every answer depends on the channel', async () => {
    for (const read of [
      { kind: 'none' },
      { kind: 'unknown' },
      { kind: 'value', value: files() },
      { kind: 'value', value: files({ index: false }) },
    ] satisfies CrawlerFilesRead[]) {
      expect((await serve(read).response).headers.get('vary')).toBe('X-Sales-Channel');
    }
  });
});

/**
 * The route file, as Next loads it — `fetch` is the only thing replaced.
 */
describe('app/llms.txt/route.ts', () => {
  interface Backend {
    calls: { path: string; channel: string | null }[];
    files: (channel: string | null) => Response | Promise<Response>;
    blog: (channel: string | null) => Response | Promise<Response>;
  }

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const filesAnswer = (overrides: Partial<CrawlerFiles> = {}): Response =>
    json({ data: files(overrides) });
  const blogServed = (): Response => json({ data: { posts: [], categories: [] } });
  const blogAbsent = (): Response => json({ error: { code: 'BLOG_DISABLED' } }, 404);

  function backend(
    answerFiles: Backend['files'],
    answerBlog: Backend['blog'] = blogServed,
  ): Backend {
    const state: Backend = { calls: [], files: answerFiles, blog: answerBlog };
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const channel = new Headers(init?.headers).get('x-sales-channel');
      const path = new URL(String(input)).pathname;
      state.calls.push({ path, channel });
      if (path === '/api/v1/storefront/seo/crawler-files') return state.files(channel);
      if (path === '/api/v1/blog/by-channel') return state.blog(channel);
      throw new Error(`unexpected request to ${path}`);
    });
    return state;
  }

  /** A fresh copy of the route, and with it a reader that knows nothing. */
  const route = () => import('../../app/llms.txt/route');
  const get = async (path = '/llms.txt', headers: Record<string, string> = {}) =>
    (await route()).GET(new Request(`http://shop.test${path}`, { headers }));

  it('is rendered per request: Next must not prerender it or cache it by address', async () => {
    const loaded = await route();
    expect(loaded.dynamic).toBe('force-dynamic');
    // Only what Next accepts from a route file, so the build does not refuse it.
    expect(Object.keys(loaded).sort()).toEqual(['GET', 'dynamic']);
  });

  it('reserves its address: no content page can be given it (FR-028)', () => {
    // The deployment's reserved set is copied from this array, and the `cms`
    // module refuses a slug whose first segment is in it. (A page slug cannot
    // contain a dot either; the entry is the array being complete.)
    expect(RESERVED_TOP_LEVEL_SEGMENTS).toContain('llms.txt');
    expect(RESERVED_TOP_LEVEL_SEGMENTS).toContain('robots.txt');
  });

  it('has nothing beside it that would be served instead of it', () => {
    // A file in `public/` is answered before any route is looked for —
    // measured on the standalone server: `200`, the file's bytes, and no
    // capability header. A `public/llms.txt` would be served as it is, for every channel, with no
    // operator content and on a channel kept out of search — and nothing
    // would say so. A storefront taking this route has no such file.
    expect(existsSync(fileURLToPath(new URL('../../public/llms.txt', import.meta.url)))).toBe(
      false,
    );
    // The route is the directory `app/llms.txt/`, holding `route.ts` alone:
    // a page beside it is refused by the build, and a plain file named
    // `app/llms.txt` cannot exist beside a directory of that name.
    expect(
      readdirSync(fileURLToPath(new URL('../../app/llms.txt', import.meta.url))).sort(),
    ).toEqual(['route.ts']);
    // Next has no metadata-file convention for this address, which is what
    // let `app/robots.ts` shadow `app/robots.txt/route.ts`; should it gain
    // one, these are the names it would take.
    for (const shadow of ['llms.ts', 'llms.tsx', 'llms.js', 'llms.jsx', 'llms.txt.ts']) {
      expect(
        existsSync(fileURLToPath(new URL(`../../app/${shadow}`, import.meta.url))),
        `app/${shadow} must not exist`,
      ).toBe(false);
    }
  });

  it('reads the backend’s crawler-files route for the request’s channel and appends its content', async () => {
    const api = backend(() => filesAnswer({ llmsTxtAdditional: ADDITIONAL }));
    const served = await get('/llms.txt', { 'x-sales-channel': 'pl_retail' });
    expect(served.status).toBe(200);
    expect(await served.text()).toBe(`${base()}\n${ADDITIONAL}`);
    expect(api.calls).toEqual([
      { path: '/api/v1/storefront/seo/crawler-files', channel: 'pl_retail' },
      { path: '/api/v1/blog/by-channel', channel: 'pl_retail' },
    ]);
  });

  it('never serves one channel’s content for another, in one process', async () => {
    const api = backend((channel) =>
      channel === 'a' ? filesAnswer({ llmsTxtAdditional: 'only-a\n' }) : filesAnswer(),
    );
    const { GET } = await route();
    const serveFor = async (channel?: string) =>
      (
        await GET(
          new Request('http://shop.test/llms.txt', {
            headers: channel !== undefined ? { 'x-sales-channel': channel } : {},
          }),
        )
      ).text();

    expect(await serveFor('a')).toBe(`${base()}\nonly-a\n`);
    expect(await serveFor('b')).toBe(base());
    expect(await serveFor()).toBe(base());
    expect(await serveFor('a')).toBe(`${base()}\nonly-a\n`);
    expect(
      api.calls.filter((call) => call.path.endsWith('/crawler-files')).map((call) => call.channel),
    ).toEqual(['a', 'b', null]);
  });

  it('answers not found on one channel and serves the file on another, in one process', async () => {
    backend((channel) => (channel === 'hidden' ? filesAnswer({ index: false }) : filesAnswer()));
    const { GET } = await route();
    const at = (channel: string) =>
      GET(new Request('http://shop.test/llms.txt', { headers: { 'x-sales-channel': channel } }));
    expect((await at('hidden')).status).toBe(404);
    expect((await at('open')).status).toBe(200);
    expect((await at('hidden')).status).toBe(404);
  });

  it('leaves the blog out while the backend says there is none for the channel', async () => {
    backend(() => filesAnswer(), blogAbsent);
    const body = await (await get()).text();
    expect(body).toBe(base('Endora Demo', ['/blog']));
    expect(body).toContain('/catalog');
  });

  it('leaves the blog out while its module is switched off', async () => {
    backend(
      () => filesAnswer(),
      () => json({ error: { code: 'MODULE_DISABLED' } }, 503),
    );
    expect(await (await get()).text()).toBe(base('Endora Demo', ['/blog']));
  });

  /**
   * `/llms.txt` is a public address, and whether the blog exists is a read of
   * the backend. The cases below hold that asking the file never becomes a way
   * of asking the backend: the question is remembered per channel on the
   * terms the reader keeps everything else (`crawler-policy.ts`).
   */
  describe('the question about the blog is the reader’s to remember', () => {
    const blogCalls = (api: Backend): number =>
      api.calls.filter((call) => call.path === '/api/v1/blog/by-channel').length;
    const request = (channel?: string) =>
      new Request('http://shop.test/llms.txt', {
        headers: channel !== undefined ? { 'x-sales-channel': channel } : {},
      });

    it('asks once for many requests while the answer is fresh', async () => {
      const api = backend(() => filesAnswer());
      const { GET } = await route();
      for (let i = 0; i < 10; i += 1) expect(await (await GET(request())).text()).toBe(base());
      expect(blogCalls(api)).toBe(1);
    });

    it('fifty requests at once for a channel nobody asked about make one request', async () => {
      const api = backend(() => filesAnswer());
      const { GET } = await route();
      const bodies = await Promise.all(
        Array.from({ length: 50 }, async () => (await GET(request('fresh'))).text()),
      );
      expect(new Set(bodies)).toEqual(new Set([base()]));
      expect(blogCalls(api)).toBe(1);
    });

    it('while the blog cannot be asked about: one request per back-off, the file uncached and without the blog', async () => {
      const api = backend(
        () => filesAnswer(),
        () => json({ error: { code: 'INTERNAL' } }, 500),
      );
      const { GET } = await route();
      for (let i = 0; i < 10; i += 1) {
        const served = await GET(request());
        expect(served.status).toBe(200);
        expect(served.headers.get('cache-control')).toBe('no-store');
        expect(await served.text()).toBe(base('Endora Demo', ['/blog']));
      }
      // Ten requests of a public address were one request of the backend.
      expect(blogCalls(api)).toBe(1);

      // …and it is asked again once the back-off is over.
      api.blog = blogServed;
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 5_001);
        const later = await GET(request());
        expect(await later.text()).toBe(base());
        expect(later.headers.get('cache-control')).toBe('public, max-age=60');
        expect(blogCalls(api)).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the line it last knew when the blog then cannot be asked about, and stays cacheable', async () => {
      const api = backend(() => filesAnswer());
      const { GET } = await route();
      expect(await (await GET(request())).text()).toBe(base());

      api.blog = () => json({ error: { code: 'INTERNAL' } }, 500);
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 61_000);
        const later = await GET(request());
        expect(await later.text()).toBe(base());
        expect(later.headers.get('cache-control')).toBe('public, max-age=60');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not make a request wait for a blog read that does not answer, once it knows something', async () => {
      const api = backend(() => filesAnswer());
      const { GET } = await route();
      expect(await (await GET(request())).text()).toBe(base());

      // The refresh never answers. The request is given the refresh's budget
      // — a fraction of a second — and then served what was known. The clock
      // is the fake one, so what this proves is which timer lets the request
      // go, not how fast the host is (issue #612): still waiting just before
      // the budget is spent, served as soon as it is, and the budget is well
      // inside the read's own deadline.
      api.blog = () => new Promise<Response>(() => undefined);
      expect(STALE_REFRESH_BUDGET_MS).toBeLessThan(READ_TIMEOUT_MS);
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 61_000);
        let later: Response | undefined;
        const pending = GET(request()).then((response) => (later = response));
        await vi.advanceTimersByTimeAsync(STALE_REFRESH_BUDGET_MS - 1);
        expect(later, 'served before the refresh budget was spent').toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        expect(later, 'still waiting once the refresh budget was spent').toBeDefined();
        expect(await (await pending).text()).toBe(base());
      } finally {
        vi.useRealTimers();
      }
    });

    it('gives the backend a deadline: the read carries a signal that aborts', async () => {
      let signal: AbortSignal | undefined;
      const state = backend(() => filesAnswer());
      const stubbed = globalThis.fetch;
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/api/v1/blog/by-channel')) signal = init?.signal ?? undefined;
        return stubbed(input, init);
      });
      await get();
      expect(blogCalls(state)).toBe(1);
      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('never answers one channel’s blog for another', async () => {
      backend(
        () => filesAnswer(),
        (channel) => (channel === 'no-blog' ? blogAbsent() : blogServed()),
      );
      const { GET } = await route();
      expect(await (await GET(request('no-blog'))).text()).toBe(base('Endora Demo', ['/blog']));
      expect(await (await GET(request('with-blog'))).text()).toBe(base());
      expect(await (await GET(request())).text()).toBe(base());
      expect(await (await GET(request('no-blog'))).text()).toBe(base('Endora Demo', ['/blog']));
    });
  });

  it('answers the generated base for `?part=base`, and not found for it on a hidden channel', async () => {
    backend((channel) =>
      channel === 'hidden'
        ? filesAnswer({ index: false })
        : filesAnswer({ llmsTxtAdditional: ADDITIONAL }),
    );
    const { GET } = await route();
    const open = await GET(new Request('http://shop.test/llms.txt?part=base'));
    expect(open.status).toBe(200);
    expect(open.headers.get('cache-control')).toBe('no-store');
    expect(await open.text()).toBe(base());
    const hidden = await GET(
      new Request('http://shop.test/llms.txt?part=base', { headers: { 'x-sales-channel': 'hidden' } }),
    );
    expect(hidden.status).toBe(404);
  });

  it('answers 503 from a process that knows nothing when the backend cannot be read', async () => {
    backend(() => {
      throw new TypeError('fetch failed');
    });
    const served = await get();
    expectUnavailable(served);
  });

  it('keeps serving the last version it read when the backend then fails', async () => {
    const api = backend(() => filesAnswer({ llmsTxtAdditional: ADDITIONAL }));
    const { GET } = await route();
    const request = () => new Request('http://shop.test/llms.txt');
    expect(await (await GET(request())).text()).toBe(`${base()}\n${ADDITIONAL}`);

    api.files = () => json({ error: { code: 'INTERNAL' } }, 500);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      const later = await GET(request());
      expect(later.status).toBe(200);
      expect(await later.text()).toBe(`${base()}\n${ADDITIONAL}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is withdrawn within the minute once the channel is set to noindex', async () => {
    const api = backend(() => filesAnswer({ llmsTxtAdditional: ADDITIONAL }));
    const { GET } = await route();
    const request = () => new Request('http://shop.test/llms.txt');
    expect((await GET(request())).status).toBe(200);

    api.files = () => filesAnswer({ index: false, llmsTxtAdditional: ADDITIONAL });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      expect((await GET(request())).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers not found once the backend says seo is off, and against one with no such route', async () => {
    const api = backend(() => filesAnswer({ llmsTxtAdditional: ADDITIONAL }));
    const { GET } = await route();
    const request = () => new Request('http://shop.test/llms.txt');
    expect((await GET(request())).status).toBe(200);

    api.files = () => json({ error: { code: 'MODULE_DISABLED' } }, 503);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 61_000);
      expect((await GET(request())).status).toBe(404);
    } finally {
      vi.useRealTimers();
    }

    vi.resetModules();
    backend(() => json({ error: { code: 'NOT_FOUND' } }, 404));
    expect((await get()).status).toBe(404);
  });

  /**
   * The corrupt-row case, for both files, through both route files: a default
   * robots value nobody can interpret costs the channel its `llms.txt` and
   * not its `robots.txt` (`contracts/crawler-policy.md` §2.2).
   */
  it('a channel whose default robots cannot be read keeps its robots.txt and loses its llms.txt', async () => {
    backend(() =>
      json({
        data: {
          index: false,
          follow: false,
          robotsTxtCustom: 'User-agent: GPTBot\nDisallow: /\n',
          llmsTxtAdditional: ADDITIONAL,
          shop: { name: 'Endora Demo' },
          unreadable: ['policy'],
        },
      }),
    );
    expectUnavailable(await get());

    const robots = await import('../../app/robots.txt/route');
    const served = await robots.GET(new Request('http://shop.test/robots.txt'));
    expect(served.status).toBe(200);
    expect((await served.text()).endsWith('\nUser-agent: GPTBot\nDisallow: /\n')).toBe(true);
  });
});
