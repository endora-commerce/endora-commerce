import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductKeyResolution } from '@endora-commerce/contracts';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * Feature 163, Phase 17 (T109) — the product page resolves the key it was opened
 * by before it reads the product
 * (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md` §4, §6;
 * FR-071, FR-074).
 *
 * - `kind: 'redirect'` answers a redirect to the resolve answer's `path`,
 *   verbatim — permanent (308) for a former key, temporary (307) for a key of
 *   another channel language (feature 167, FR-024): the backend built it with
 *   `productPath()`, and the storefront composes no product URL of its own;
 * - `kind: 'product'` reads the product **by id**, so the page shows the product
 *   the key resolved to and never a second lookup by key;
 * - not-found from the resolve answers the page's not-found;
 * - canonical and alternate-language links are the PDP response's `paths`, as
 *   they came.
 *
 * `next/navigation`'s `permanentRedirect` and `notFound` throw in Next; the stubs
 * below throw the same way so the control flow under test is the real one.
 */

class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect ${path}`);
  }
}
class NotFoundSignal extends Error {}

class TemporaryRedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`temporary redirect ${path}`);
  }
}

const navigation = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('next/navigation', () => navigation);

const catalogApi = vi.hoisted(() => ({
  resolveProductKey: vi.fn(),
  getProductBySlug: vi.fn(),
}));
vi.mock('../../lib/api/catalog', () => catalogApi);

const { productIdForKey, productById, alternateLanguages } = await import('../../app/(catalog)/p/[slug]/resolution');

const ctx = { salesChannelCode: 'b2b', locale: 'pl-PL' };

beforeEach(() => {
  navigation.permanentRedirect.mockReset().mockImplementation((path: string) => {
    throw new RedirectSignal(path);
  });
  navigation.redirect.mockReset().mockImplementation((path: string) => {
    throw new TemporaryRedirectSignal(path);
  });
  navigation.notFound.mockReset().mockImplementation(() => {
    throw new NotFoundSignal();
  });
  catalogApi.resolveProductKey.mockReset();
  catalogApi.getProductBySlug.mockReset();
});

describe('productIdForKey', () => {
  it('redirects permanently (308) to the path the backend built for a former key, verbatim', async () => {
    const answer: ProductKeyResolution = {
      kind: 'redirect',
      key: 'wiertarka',
      languageCode: 'pl-PL',
      path: '/pl/p/wiertarka',
      permanent: true,
    };
    catalogApi.resolveProductKey.mockResolvedValue(answer);

    await expect(productIdForKey('drill', ctx)).rejects.toEqual(new RedirectSignal('/pl/p/wiertarka'));
    expect(catalogApi.resolveProductKey).toHaveBeenCalledWith('drill', ctx);
    expect(navigation.permanentRedirect).toHaveBeenCalledWith('/pl/p/wiertarka');
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it('redirects temporarily (307) to the language\'s own key for a key of another channel language (FR-024)', async () => {
    catalogApi.resolveProductKey.mockResolvedValue({
      kind: 'redirect',
      key: 'drill',
      languageCode: 'en-US',
      path: '/en/p/drill',
      permanent: false,
    } satisfies ProductKeyResolution);

    await expect(productIdForKey('wiertarka', ctx)).rejects.toEqual(new TemporaryRedirectSignal('/en/p/drill'));
    expect(navigation.permanentRedirect).not.toHaveBeenCalled();
  });

  it.each(['/p/drill', '/en/p/drill', '/en-gb/p/drill?variant=A'])('accepts the product path %s', async (path) => {
    catalogApi.resolveProductKey.mockResolvedValue({ kind: 'redirect', key: 'drill', languageCode: 'en-US', path, permanent: true });
    await expect(productIdForKey('x', ctx)).rejects.toEqual(new RedirectSignal(path));
  });

  it.each([
    '//evil.example/p/x',
    'https://evil.example/p/x',
    '/\\evil.example',
    '/cart',
    'p/x',
    '/p//evil.example',
    '/en/cart',
    '//en/p/x',
    '/EN/p/x',
    '/en/p/x/y',
  ])(
    'never redirects off the product pages: %s is not-found (checkpoint E security review, I3)',
    async (path) => {
      catalogApi.resolveProductKey.mockResolvedValue({ kind: 'redirect', key: 'k', languageCode: 'pl-PL', path, permanent: true });
      await expect(productIdForKey('drill', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
      expect(navigation.permanentRedirect).not.toHaveBeenCalled();
    },
  );

  it('answers the product id the key resolved to', async () => {
    catalogApi.resolveProductKey.mockResolvedValue({
      kind: 'product',
      productId: '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d',
      key: 'wiertarka',
    } satisfies ProductKeyResolution);

    await expect(productIdForKey('wiertarka', ctx)).resolves.toBe('0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d');
    expect(navigation.permanentRedirect).not.toHaveBeenCalled();
  });

  it('answers not-found when the key resolves to nothing', async () => {
    catalogApi.resolveProductKey.mockRejectedValue(new StorefrontApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.'));

    await expect(productIdForKey('impact-drill', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('answers not-found for an archived product’s 410, never the error page (T155, B4)', async () => {
    catalogApi.resolveProductKey.mockRejectedValue(new StorefrontApiError(410, 'PRODUCT_ARCHIVED', 'Product is archived.'));

    await expect(productIdForKey('old-drill', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('lets any other failure through to the error page', async () => {
    const failure = new StorefrontApiError(500, 'INTERNAL', 'Something went wrong.');
    catalogApi.resolveProductKey.mockRejectedValue(failure);

    await expect(productIdForKey('drill', ctx)).rejects.toBe(failure);
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

describe('productById (T155, B4)', () => {
  it('answers the product read by id', async () => {
    const product = { id: 'p-1' };
    catalogApi.getProductBySlug.mockResolvedValue(product);
    await expect(productById('p-1', ctx)).resolves.toBe(product);
    // Feature 172 — the page's own read asks for the content attributes too.
    expect(catalogApi.getProductBySlug).toHaveBeenCalledWith('p-1', ctx, { include: ['content'] });
  });

  it.each([404, 410])('answers not-found for a %i (gone between the resolve and the read)', async (status) => {
    catalogApi.getProductBySlug.mockRejectedValue(new StorefrontApiError(status, 'PRODUCT_NOT_FOUND', 'Product not found.'));
    await expect(productById('p-1', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('lets any other failure through to the error page', async () => {
    const failure = new StorefrontApiError(500, 'INTERNAL', 'Something went wrong.');
    catalogApi.getProductBySlug.mockRejectedValue(failure);
    await expect(productById('p-1', ctx)).rejects.toBe(failure);
  });
});

describe('alternateLanguages', () => {
  it('maps each alternate the backend sent to its language, verbatim, plus x-default (feature 167)', () => {
    expect(
      alternateLanguages({
        canonical: '/pl/p/wiertarka',
        alternates: [
          { languageCode: 'en-US', path: '/en/p/drill' },
          { languageCode: 'pl-PL', path: '/pl/p/wiertarka' },
        ],
        xDefault: '/p/wiertarka',
      }),
    ).toEqual({ 'en-US': '/en/p/drill', 'pl-PL': '/pl/p/wiertarka', 'x-default': '/p/wiertarka' });
  });

  it('lists no alternates when the product has none for the anonymous audience', () => {
    expect(alternateLanguages({ canonical: '/p/drill', alternates: [], xDefault: '/p/drill' })).toBeUndefined();
  });
});

describe('the product page composes no product URL of its own', () => {
  const dir = resolve(import.meta.dirname, '../../app/(catalog)/p/[slug]');
  const page = readFileSync(resolve(dir, 'page.tsx'), 'utf8');
  const seo = readFileSync(resolve(dir, 'seo.ts'), 'utf8');

  it('resolves the key before reading, in the page and in its metadata', () => {
    expect(page).toMatch(/productIdForKey\(slug, ctx\)/);
    expect(page).toMatch(/resolveProductKey\(slug, anonymous\)/);
    expect(page).toMatch(/productById\(productId, ctx\)/);
    expect(page).toMatch(/canonical: product\.paths\.canonical/);
  });

  it('holds no `/p/` path literal and no canonical built from the route pattern', () => {
    for (const source of [page, seo]) {
      // The route declaration (`'/p/[slug]'`) is a pattern, not a URL.
      expect(source).not.toMatch(/['"`]\/p\/(?!\[slug\])/);
      expect(source).not.toMatch(/canonicalPath\(/);
    }
  });
});

/**
 * Feature 167 — the path decides the page language (OR-4): the product page no longer
 * reads `?lang=` and no storefront source passes a language override to the server
 * context (163's interim `langOverride`, Q-M7, is gone).
 */
describe('no `?lang` override is left (feature 167, OR-4)', () => {
  const root = resolve(import.meta.dirname, '../..');
  const page = readFileSync(resolve(root, 'app/(catalog)/p/[slug]/page.tsx'), 'utf8');

  it('the product page reads no `lang` search parameter', () => {
    expect(page).not.toMatch(/search\.lang|requestedLanguage/);
  });

  it('no storefront source passes langOverride', () => {
    const skip = new Set(['node_modules', '.next', 'test', 'dist', 'coverage', 'public']);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/langOverride/.test(readFileSync(full, 'utf8'))) offenders.push(relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  /**
   * T155 finding §1.5 (B3) marked the page's own content with `lang={locale}` because
   * `<html lang>` could disagree with a `?lang=` page. With the language in the path,
   * `<html lang>` is the page language, so the workaround is gone.
   */
  it('the outermost element no longer repeats the language', () => {
    const body = page.slice(page.search(/export default async function ProductPage\(/));
    const outermost = body.slice(body.indexOf('return (')).match(/return \(\s*<div([^>]*)>/);
    expect(outermost?.[1] ?? '').not.toContain('lang={locale}');
  });
});
