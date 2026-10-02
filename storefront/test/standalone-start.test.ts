import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { assembleStandalone, standaloneAppDir } from '../scripts/start-standalone.mjs';

/**
 * `pnpm run start` serves the build `pnpm run build` produced.
 *
 * `next.config.js` builds with `output: 'standalone'`, and `next start` over
 * such a build prints `"next start" does not work with "output: standalone"
 * configuration` — the first line a stranger read after building the storefront
 * `endora install` wrote. What serves that build is the server it emits, with
 * the two directories the standalone tree deliberately leaves out put beside
 * it; the image's Dockerfile and the conformance job each did that by hand.
 */
const roots: string[] = [];

function builtApp(name: string, options: { readonly server: boolean } = { server: true }): string {
  const parent = mkdtempSync(join(tmpdir(), 'standalone-start-'));
  roots.push(parent);
  const app = join(parent, name);
  mkdirSync(join(app, '.next', 'static', 'chunks'), { recursive: true });
  writeFileSync(join(app, '.next', 'static', 'chunks', 'main.js'), '// chunk\n');
  mkdirSync(join(app, 'public'), { recursive: true });
  writeFileSync(join(app, 'public', 'robots.txt'), 'User-agent: *\n');
  if (options.server) {
    mkdirSync(join(app, '.next', 'standalone', name), { recursive: true });
    writeFileSync(join(app, '.next', 'standalone', name, 'server.js'), '// server\n');
  }
  return app;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('the storefront starts the server its own build emits', () => {
  it('finds the standalone tree under the directory name, whatever the client called it', () => {
    // `outputFileTracingRoot` is the directory above the application, so the
    // emitted tree repeats the application's own directory name.
    expect(standaloneAppDir('/srv/acme-shop-storefront')).toBe(
      '/srv/acme-shop-storefront/.next/standalone/acme-shop-storefront',
    );
  });

  it('puts the static assets and `public/` beside the server, and answers its path', () => {
    const app = builtApp('acme-shop-storefront');
    const server = assembleStandalone(app);
    const standalone = join(app, '.next', 'standalone', 'acme-shop-storefront');
    expect(server).toBe(join(standalone, 'server.js'));
    expect(existsSync(join(standalone, '.next', 'static', 'chunks', 'main.js'))).toBe(true);
    expect(existsSync(join(standalone, 'public', 'robots.txt'))).toBe(true);
  });

  it('replaces what an earlier build left there, so a start never serves stale assets', () => {
    const app = builtApp('shop');
    const standalone = join(app, '.next', 'standalone', 'shop');
    mkdirSync(join(standalone, '.next', 'static'), { recursive: true });
    writeFileSync(join(standalone, '.next', 'static', 'stale.js'), '// from the last build\n');
    assembleStandalone(app);
    expect(existsSync(join(standalone, '.next', 'static', 'stale.js'))).toBe(false);
    expect(existsSync(join(standalone, '.next', 'static', 'chunks', 'main.js'))).toBe(true);
  });

  it('refuses a tree that was not built, naming the command that builds it', () => {
    const app = builtApp('shop', { server: false });
    expect(() => assembleStandalone(app)).toThrow(/pnpm run build/);
  });

  it('is what `start` runs: the manifest names the script, with `.env` loaded, and not `next start`', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts['start']).toBe('node --env-file-if-exists=.env scripts/start-standalone.mjs');
  });
});
