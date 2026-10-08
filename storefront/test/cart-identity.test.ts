import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No browser code talks to the backend's cart endpoints directly.
 *
 * The buyer's cart identity — `b2b_session` or `b2b_cart_anon` — is an httpOnly
 * cookie scoped to the *storefront* origin (`lib/session.ts`). A browser
 * `fetch` to the backend origin does not carry it, so on any deployment where
 * the two are different hosts that request is answered for somebody else: the
 * header badge read `itemCount: 0` and overwrote the correct server-rendered
 * count, and the product-card quick add filled a second cart, keyed by a cookie
 * on the backend's host, that the `/cart` page never reads. It went unnoticed
 * in development because cookies are not scoped by port, so `localhost:3000`
 * and `localhost:3001` share one jar.
 *
 * A test rather than a convention because the defect is invisible to every
 * other instrument: the components render, type-check and pass their SSR tests,
 * and the effects that make the call do not run under `renderToString`. The
 * same-origin path is `lib/actions/cart.ts`.
 */

const ROOTS = ['app', 'components', 'lib'] as const;
const STOREFRONT = join(__dirname, '..');

const CLIENT_DIRECTIVE = /^\s*(['"])use client\1/m;
const CART_ENDPOINT = /\/api\/v1\/cart(?![A-Za-z0-9_-])/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...sources(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** Source lines that are code, i.e. not part of a comment. */
function codeLines(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'));
}

describe('browser code never calls the backend cart endpoints', () => {
  const files = ROOTS.flatMap((root) => sources(join(STOREFRONT, root)));
  const clientFiles = files.filter((file) => CLIENT_DIRECTIVE.test(readFileSync(file, 'utf8')));

  it('read a population worth judging', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it('finds no cart endpoint in a client component', () => {
    const offenders = clientFiles
      .filter((file) => codeLines(readFileSync(file, 'utf8')).some((l) => CART_ENDPOINT.test(l)))
      .map((file) => relative(STOREFRONT, file));
    expect(offenders).toEqual([]);
  });
});
