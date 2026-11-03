import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Feature 170 (T149; `contracts/url-keys.md` §3, research R12) — `UrlKeyService` is the **one**
 * writer of `product_url_keys`, `product_url_redirects` and `products.slug`, and every key writer
 * of §3's list reaches it.
 *
 * Walks `packages/modules/* /src` (tests and migrations excluded) and fails when:
 * 1. any file other than `catalog/src/backend/services/url-key.service.ts` writes one of the three
 *    stores — SQL (`insert into` / `update` / `delete from` the key tables, `update products set …
 *    slug`) or ORM (`create(ProductUrlKey|ProductUrlRedirect …`, `<product>.slug = …`, a
 *    `create(Product, { … slug … })`) — unless the file is a key writer that calls the service;
 * 2. a key writer of §3 does not call `lockAndCheck` / `allocateFreeSlug` (or `importKeys`, which
 *    is `lockAndCheck` in integration mode).
 * Prints its read line and fails on an empty population.
 */

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../..');
const MODULES = join(ROOT, 'packages/modules');
const OWNER = 'packages/modules/catalog/src/backend/services/url-key.service.ts';

/** §3's key writers → the file that implements each, and why it may name the stores. */
const KEY_WRITERS: Record<string, string> = {
  'packages/modules/catalog/src/backend/services/catalog-admin.service.ts': 'product create and duplicate: the slug comes from allocateFreeSlug',
  'packages/modules/catalog/src/backend/plugin.ts': 'the scoped-values save: its URL-key step is UrlKeyService.lockAndCheck',
  'packages/modules/catalog/src/backend/services/catalog-write-ports.ts': 'the connector port: UrlKeyService.importKeys (integration mode)',
};

/** Files that write a store and are not request paths — each with its reason. */
const ALLOWED: Record<string, string> = {
  'packages/modules/catalog/src/backend/demo/': 'development fixture data seeded by the demo composition, never a request or a worker',
};

const STORE_WRITES: ReadonlyArray<[string, RegExp]> = [
  ['sql:url-key tables', /\b(insert\s+into|update|delete\s+from)\s+"?(product_url_keys|product_url_redirects)"?\b/i],
  ['sql:products.slug', /update\s+"?products"?\s+set\b[^;`]*\bslug\b/i],
  ['orm:create key row', /\.create\(\s*(ProductUrlKey|ProductUrlRedirect)\b/],
  ['orm:product.slug =', /\b(product|products?\[\w+\]|p|copy|source|created)\.slug\s*=(?!=)/],
  ['orm:create(Product, { slug })', /\.create\(\s*Product\s*,\s*\{[^}]*\bslug\b/],
];

const CALLS_SERVICE = /\b(lockAndCheck|allocateFreeSlug|importKeys)\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'migrations') continue;
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

describe('170 T149 — UrlKeyService is the one URL-key writer', () => {
  const files = readdirSync(MODULES)
    .map((id) => join(MODULES, id, 'src'))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    })
    .flatMap((dir) => walk(dir));
  const sites: Array<{ file: string; kind: string }> = [];
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    const file = relative(ROOT, path);
    for (const [kind, pattern] of STORE_WRITES) if (pattern.test(text)) sites.push({ file, kind });
  }
  console.log(`[url-key-writer-ownership] read: files=${files.length} sites=${sites.length}`);

  it('reads a population', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(sites.some((site) => site.file === OWNER)).toBe(true);
  });

  it('no file but the service (and the key writers that call it) writes the URL-key stores', () => {
    const offenders = sites.filter(
      (site) =>
        site.file !== OWNER &&
        !(site.file in KEY_WRITERS) &&
        !Object.keys(ALLOWED).some((prefix) => site.file.startsWith(prefix)),
    );
    expect(offenders).toEqual([]);
  });

  it('every key writer of §3 calls the service', () => {
    const missing = Object.keys(KEY_WRITERS).filter((file) => !CALLS_SERVICE.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(missing).toEqual([]);
  });
});
