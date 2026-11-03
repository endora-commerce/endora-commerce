import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ChannelIdentityRead } from '../../lib/channel/channel-identity';
import { LANGUAGE_NEUTRAL_SEGMENTS } from '../../app/reserved-segments';

/**
 * Feature 167 (SC-001, FR-010, FR-022) — every page route of the storefront is
 * addressable under each channel prefix and is handed to the render in the **path**
 * language, whatever the `lang` cookie and `Accept-Language` say.
 *
 * The routes are derived from the `app/` tree (the rules `check:storefront-indexability`
 * reads it by: route groups, private folders and parallel slots add no segment), so a
 * new route is covered without editing this file. The render's own language is
 * `getServerContext`'s reading of the forwarded header (`server-context-language.test.ts`);
 * this holds the other half — that the middleware forwards the path's language for
 * every route.
 */

const APP = fileURLToPath(new URL('../../app', import.meta.url));

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pageFiles(full));
    else if (/^page\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A concrete URL path for a page file: dynamic segments filled with sample values. */
function samplePath(file: string): string {
  const segments = relative(APP, file)
    .split('/')
    .slice(0, -1)
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')) && !s.startsWith('_') && !s.startsWith('@'))
    .map((s) => {
      if (s.startsWith('[[...')) return '';
      if (s.startsWith('[...')) return 'sample/nested';
      if (s.startsWith('[')) return 'sample';
      return s;
    })
    .filter((s) => s !== '');
  return `/${segments.join('/')}`;
}

const NEUTRAL = new Set(LANGUAGE_NEUTRAL_SEGMENTS);
const ROUTES = [...new Set(pageFiles(APP).map(samplePath))]
  .filter((path) => !NEUTRAL.has(path.split('/')[1] ?? ''))
  .sort();

const identity: ChannelIdentityRead = {
  kind: 'value',
  value: {
    code: 'b2b',
    anonymousAccess: true,
    prefixDefaultLanguage: true,
    urlLanguages: [
      { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
      { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
    ],
    urlLanguageAliases: [],
  },
};

vi.mock('../../lib/seo/crawler-policy', () => ({ readRobotsPolicy: vi.fn(async () => ({ kind: 'none' })) }));
vi.mock('../../lib/channel/channel-identity', () => ({ readChannelIdentity: vi.fn(async () => identity) }));
// Feature 171 — the middleware's blog routing read: no blog mapping here.
vi.mock('../../lib/blog/blog-routing', () => ({
  readBlogRouting: vi.fn(async () => null),
  blogRouteDecision: vi.fn(() => null),
}));
vi.mock('../../lib/api/backend-reachability', () => ({ backendReachability: vi.fn(async () => 'reachable') }));

let middleware: (request: NextRequest) => Promise<Response>;
beforeAll(async () => {
  ({ middleware } = await import('../../middleware'));
});

function forwardedLanguage(response: Response): string | null {
  const names = (response.headers.get('x-middleware-override-headers') ?? '').split(',');
  return names.includes('x-storefront-language') ? response.headers.get('x-middleware-request-x-storefront-language') : null;
}

describe('every page route renders in the path language (SC-001)', () => {
  it('derives a meaningful route table from app/', () => {
    // A walk that found nothing would make every case below vacuous.
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES).toEqual(expect.arrayContaining(['/', '/cart', '/catalog', '/c/sample', '/p/sample', '/search']));
  });

  it.each(ROUTES)('%s under /pl and /en, against the cookie and Accept-Language', async (route) => {
    for (const [prefix, language, other] of [
      ['pl', 'pl-PL', 'en-US'],
      ['en', 'en-US', 'pl-PL'],
    ] as const) {
      const path = route === '/' ? `/${prefix}` : `/${prefix}${route}`;
      const response = await middleware(
        new NextRequest(`http://shop.test${path}`, { headers: { cookie: `lang=${other}`, 'accept-language': other } }),
      );
      expect(response.status, path).not.toBe(307);
      expect(response.headers.get('x-middleware-rewrite'), path).toBe(`http://shop.test${route}`);
      expect(forwardedLanguage(response), path).toBe(language);
    }
  });
});
