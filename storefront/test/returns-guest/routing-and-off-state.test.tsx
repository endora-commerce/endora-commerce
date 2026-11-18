import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSortedRoutes } from 'next/dist/shared/lib/router/utils/sorted-routes';

/**
 * `specs/181-guest-complaints/` T066 (FR-080; research R-13; design review F-6):
 *
 * - `/returns/guest/…` and `/returns/track/…` are static segments, so they win over the
 *   account's `(account)/returns/[id]` — a guest link never opens as a case id.
 * - Every new page sits under a layout that calls `requireModulePresent('returns')`, so
 *   each answers not-found while `returns` is off, through the site's generic page — the
 *   tracking page's neutral page is the token's, rendered one level below the gate.
 */
const APP = resolve(__dirname, '../../app');

function pagesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) pagesUnder(path, out);
    else if (name === 'page.tsx') out.push(path);
  }
  return out;
}

/** The URL a page file answers, route groups removed. */
function routeOf(file: string): string {
  const segments = relative(APP, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return `/${segments.join('/')}`;
}

let present = true;
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ modules: { isPresent: (id: string) => (id === 'returns' ? present : true), presentIds: [], absentIds: [] } }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

beforeEach(() => {
  present = true;
});

describe('route precedence', () => {
  it('sorts the guest and tracking pages before the account’s case id', () => {
    const routes = [...pagesUnder(join(APP, 'returns')), ...pagesUnder(join(APP, '(account)', 'returns'))].map(routeOf);
    expect(routes).toEqual(expect.arrayContaining(['/returns/guest', '/returns/guest/new', '/returns/track/[token]', '/returns/[id]']));
    const sorted = getSortedRoutes(routes);
    for (const route of ['/returns/guest', '/returns/guest/new', '/returns/guest/sent', '/returns/guest/verify', '/returns/track/[token]']) {
      expect(sorted.indexOf(route)).toBeLessThan(sorted.indexOf('/returns/[id]'));
    }
  });
});

describe('module off (FR-080)', () => {
  it('puts every new page under a gated layout', () => {
    const pages = pagesUnder(join(APP, 'returns'));
    // entry, sent, verify, form, success, tracking.
    expect(pages.length).toBe(6);
    for (const page of pages) {
      const route = routeOf(page);
      expect(route.startsWith('/returns/guest') || route.startsWith('/returns/track'), route).toBe(true);
    }
  });

  it.each([
    ['guest', '../../app/returns/guest/layout'],
    ['track', '../../app/returns/track/layout'],
  ])('the %s layout answers not-found while returns is off, and renders its children while on', async (_name, path) => {
    const { default: Layout } = (await import(path)) as { default: (p: { children: unknown }) => Promise<unknown> };
    present = false;
    await expect(Layout({ children: 'page' })).rejects.toThrow('NEXT_NOT_FOUND');
    present = true;
    expect(JSON.stringify(await Layout({ children: 'page' }))).toContain('page');
  });
});
