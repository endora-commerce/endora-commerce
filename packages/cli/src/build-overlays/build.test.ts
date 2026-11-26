import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runBuildOverlays, type TscRunner } from './index.js';

/**
 * `specs/190-overlay-full-modules/` T014 (FR-012, FR-013, contract `overlay-build.md` §2):
 * `endora build overlays` refuses a broken layout, compiles `apps/` with the instance's own
 * `tsc -p backend/tsconfig.apps.json`, and mirrors every overlay module's runtime assets into
 * `backend/dist/apps/**`. Exit 0 done, 1 refusal or compile error, 2 unreadable input.
 *
 * The compiler is a seam: most cases hand in a recording runner, one case runs the real
 * `tsc` this package depends on, so "it compiles" is measured once rather than assumed.
 */

function instance(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'build-overlays-'));
  const all = {
    'backend/package.json': '{ "name": "acme-backend", "type": "module" }',
    'backend/tsconfig.apps.json': '{}',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  }
  return root;
}

function recorder(code = 0): { runner: TscRunner; calls: Array<{ cwd: string; args: readonly string[] }> } {
  const calls: Array<{ cwd: string; args: readonly string[] }> = [];
  return { calls, runner: (cwd, args) => (calls.push({ cwd, args }), code) };
}

const quiet = { out: () => undefined, err: () => undefined };

describe('endora build overlays', () => {
  it('compiles with the instance project and mirrors i18n into backend/dist/apps', async () => {
    const root = instance({
      'apps/acme/modules/acme_loyalty/manifest.ts': '',
      'apps/acme/modules/acme_loyalty/i18n/en.json': '{"title":"Loyalty"}',
      'apps/acme/modules/acme_loyalty/i18n/pl.json': '{"title":"Lojalność"}',
      'apps/acme/modules/acme_loyalty/admin/strings.json': '{}',
      'apps/acme/modules/acme_loyalty/admin/logo.svg': '<svg/>',
    });
    const { runner, calls } = recorder();
    const code = await runBuildOverlays({ cwd: root, tsc: runner, ...quiet });

    expect(code).toBe(0);
    expect(calls).toEqual([
      {
        cwd: join(root, 'backend'),
        args: ['-p', 'tsconfig.apps.json', '--noEmit', 'false', '--declaration', 'false', '--sourceMap'],
      },
    ]);
    const out = join(root, 'backend/dist/apps/acme/modules/acme_loyalty');
    expect(readFileSync(join(out, 'i18n/en.json'), 'utf8')).toBe('{"title":"Loyalty"}');
    expect(existsSync(join(out, 'i18n/pl.json'))).toBe(true);
    // The admin layer is the admin build's, as `tsconfig.apps.json` excludes it.
    expect(existsSync(join(out, 'admin'))).toBe(false);
  });

  it('runs from the backend member as the build script does', async () => {
    const root = instance({ 'apps/acme/modules/acme_loyalty/manifest.ts': '' });
    const { runner, calls } = recorder();
    expect(await runBuildOverlays({ cwd: join(root, 'backend'), tsc: runner, ...quiet })).toBe(0);
    expect(calls[0]?.cwd).toBe(join(root, 'backend'));
  });

  it('refuses a broken layout before compiling anything (exit 1)', async () => {
    const root = instance({
      'apps/acme/modules/acme_loyalty/manifest.ts': '',
      'apps/acme/modules/acme_loyalty/package.json': '{}',
    });
    const { runner, calls } = recorder();
    const errors: string[] = [];
    const code = await runBuildOverlays({ cwd: root, tsc: runner, out: () => undefined, err: (s) => errors.push(s) });
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(errors.join('')).toContain('package-in-disguise');
  });

  it('refuses an asset no classification ships (exit 1)', async () => {
    const root = instance({
      'apps/acme/modules/acme_loyalty/manifest.ts': '',
      'apps/acme/modules/acme_loyalty/data/rates.csv': 'a,b',
    });
    const errors: string[] = [];
    const code = await runBuildOverlays({
      cwd: root,
      tsc: recorder().runner,
      out: () => undefined,
      err: (s) => errors.push(s),
    });
    expect(code).toBe(1);
    expect(errors.join('')).toContain('apps/acme/modules/acme_loyalty/data/rates.csv');
  });

  it('reports a compile error as exit 1 and mirrors nothing', async () => {
    const root = instance({
      'apps/acme/modules/acme_loyalty/manifest.ts': '',
      'apps/acme/modules/acme_loyalty/i18n/en.json': '{}',
    });
    expect(await runBuildOverlays({ cwd: root, tsc: recorder(2).runner, ...quiet })).toBe(1);
    expect(existsSync(join(root, 'backend/dist/apps'))).toBe(false);
  });

  it('refuses a directory that is not an instance (exit 2)', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'not-an-instance-'));
    expect(await runBuildOverlays({ cwd: elsewhere, tsc: recorder().runner, ...quiet })).toBe(2);
  });

  it('builds an instance with no overlay modules as a no-op that still compiles', async () => {
    const root = instance({});
    const { runner, calls } = recorder();
    expect(await runBuildOverlays({ cwd: root, tsc: runner, ...quiet })).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('compiles for real with the typescript this package depends on', async () => {
    const root = instance({
      'backend/tsconfig.apps.json': JSON.stringify({
        compilerOptions: {
          rootDir: '../apps',
          outDir: 'dist/apps',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          strict: true,
          erasableSyntaxOnly: true,
          noEmit: true,
        },
        include: ['../apps/*/modules/**/*.ts', '../apps/*/*.ts'],
        exclude: ['../apps/*/modules/*/admin/**', '../apps/**/*.test.ts'],
      }),
      'apps/acme/modules/acme_loyalty/manifest.ts': 'export const manifest = { id: "acme_loyalty" };\n',
    });
    expect(await runBuildOverlays({ cwd: root, ...quiet })).toBe(0);
    expect(existsSync(join(root, 'backend/dist/apps/acme/modules/acme_loyalty/manifest.js'))).toBe(true);
  });
});
