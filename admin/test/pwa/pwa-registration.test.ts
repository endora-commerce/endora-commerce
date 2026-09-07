import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Admin PWA installability (feature 046, US6). The admin SW is a static file
 * (no bundler); these tests pin its contract and the manifest's distinctness
 * from the storefront PWA.
 */
const here = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(resolve(here, '../../public/admin-service-worker.js'), 'utf-8');
const manifest = JSON.parse(
  readFileSync(resolve(here, '../../public/manifest.webmanifest'), 'utf-8'),
) as { name: string; display: string; scope: string; icons: Array<{ purpose?: string }> };
const registerSrc = readFileSync(resolve(here, '../../../packages/admin-shell/src/registerSw.ts'), 'utf-8');

describe('admin PWA (US6)', () => {
  it('manifest is a distinct, installable identity', () => {
    expect(manifest.name).toMatch(/admin/i);
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it('service worker caches assets but never /api and carries no push (FR-025)', () => {
    expect(swSource).toMatch(/b2b-admin-assets-/);
    expect(swSource).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/);
    expect(swSource).not.toMatch(/addEventListener\('push'/);
  });

  it('registration is gated to production + supported browsers', () => {
    expect(registerSrc).toMatch(/serviceWorker/);
    expect(registerSrc).toMatch(/import\.meta\.env\.DEV/);
    expect(registerSrc).toMatch(/admin-service-worker\.js/);
  });
});
