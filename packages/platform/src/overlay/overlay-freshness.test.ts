import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertOverlayBuildFresh,
  OverlayBuildError,
  overlayFreshness,
} from './overlay-freshness.js';

/**
 * `specs/190-overlay-full-modules/` T016 (FR-015, `data-model.md` §5): a compiled overlay is
 * judged against its sources before anything is imported. Each pair is two files on disk with
 * set modification times, so the verdict is the one the guard would reach on a real tree.
 */

const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-06-01T00:00:00Z');

function write(root: string, path: string, mtime: Date, content = ''): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  utimesSync(full, mtime, mtime);
}

function roots(): { source: string; compiled: string } {
  const base = mkdtempSync(join(tmpdir(), 'overlay-fresh-'));
  return { source: join(base, 'src'), compiled: join(base, 'dist') };
}

describe('overlayFreshness', () => {
  it('pairs module and deployment-level units and gives each verdict', () => {
    const { source, compiled } = roots();
    write(source, 'apps/acme/divergence.ts', OLD);
    write(compiled, 'apps/acme/divergence.js', NEW); // fresh
    write(source, 'apps/acme/modules/a/manifest.ts', OLD);
    write(compiled, 'apps/acme/modules/a/manifest.js', NEW); // fresh
    write(source, 'apps/acme/modules/a/backend.ts', NEW);
    write(compiled, 'apps/acme/modules/a/backend.js', OLD); // stale
    write(source, 'apps/acme/modules/a/services/x.ts', OLD); // unbuilt
    write(compiled, 'apps/acme/modules/a/gone.js', NEW); // orphan
    write(source, 'apps/acme/modules/b/manifest.ts', OLD); // unbuilt: whole module

    const pairs = overlayFreshness({ deploymentRoot: compiled, deploymentSourceRoot: source }, 'acme');
    const verdicts = Object.fromEntries(
      pairs.map((pair) => [pair.source ?? pair.emitted, pair.verdict]),
    );
    expect(verdicts).toEqual({
      [join(source, 'apps/acme/divergence.ts')]: 'fresh',
      [join(source, 'apps/acme/modules/a/backend.ts')]: 'stale',
      [join(compiled, 'apps/acme/modules/a/gone.js')]: 'orphan',
      [join(source, 'apps/acme/modules/a/manifest.ts')]: 'fresh',
      [join(source, 'apps/acme/modules/a/services/x.ts')]: 'unbuilt',
      [join(source, 'apps/acme/modules/b/manifest.ts')]: 'unbuilt',
    });
  });

  it('leaves out admin, tests, declarations, source maps and runtime assets', () => {
    const { source, compiled } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', OLD);
    write(compiled, 'apps/acme/modules/a/manifest.js', NEW);
    write(source, 'apps/acme/modules/a/admin/index.tsx', NEW);
    write(source, 'apps/acme/modules/a/backend.test.ts', NEW);
    write(source, 'apps/acme/modules/a/types.d.ts', NEW);
    write(compiled, 'apps/acme/modules/a/manifest.js.map', NEW);
    write(source, 'apps/acme/modules/a/i18n/en.json', NEW, '{}');
    write(compiled, 'apps/acme/modules/a/i18n/en.json', OLD, '{}');

    const pairs = overlayFreshness({ deploymentRoot: compiled, deploymentSourceRoot: source }, 'acme');
    expect(pairs.map((pair) => pair.verdict)).toEqual(['fresh']);
  });
});

describe('assertOverlayBuildFresh', () => {
  it('refuses, listing every non-fresh pair and the rebuild command', () => {
    const { source, compiled } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', NEW);
    write(compiled, 'apps/acme/modules/a/manifest.js', OLD);
    write(source, 'apps/acme/modules/a/backend.ts', OLD);

    let refused: unknown;
    try {
      assertOverlayBuildFresh({ deploymentRoot: compiled, deploymentSourceRoot: source }, 'acme', {
        rebuild: 'pnpm run build',
      });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(OverlayBuildError);
    const message = (refused as Error).message;
    expect(message).toContain('[stale]');
    expect(message).toContain('[unbuilt]');
    expect(message).toContain(join(source, 'apps/acme/modules/a/manifest.ts'));
    expect(message).toContain(join(compiled, 'apps/acme/modules/a/manifest.js'));
    expect(message).toContain('Rebuild: pnpm run build');
  });

  it('accepts a fresh build', () => {
    const { source, compiled } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', OLD);
    write(compiled, 'apps/acme/modules/a/manifest.js', NEW);
    expect(() =>
      assertOverlayBuildFresh({ deploymentRoot: compiled, deploymentSourceRoot: source }, 'acme', {
        rebuild: 'pnpm run build',
      }),
    ).not.toThrow();
  });

  it('says once that nothing was compared when no source root is given', () => {
    const { compiled } = roots();
    const lines: string[] = [];
    assertOverlayBuildFresh({ deploymentRoot: compiled }, 'acme', {
      rebuild: 'pnpm run build',
      info: (line) => lines.push(line),
    });
    expect(lines).toEqual(['[overlay] no source root; build freshness not compared']);
  });

  it('compares nothing when the source root is the deployment root (run from sources)', () => {
    const { source } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', NEW);
    const lines: string[] = [];
    expect(() =>
      assertOverlayBuildFresh({ deploymentRoot: source, deploymentSourceRoot: source }, 'acme', {
        rebuild: 'pnpm run build',
        info: (line) => lines.push(line),
      }),
    ).not.toThrow();
    expect(lines).toEqual([]);
  });
});

describe('overlay resolution runs the guard before anything is imported (T017)', () => {
  it('overlayModulesFor refuses a stale build at ids(), before a manifest is imported', async () => {
    const { overlayModulesFor } = await import('./overlay-runtime.js');
    const { source, compiled } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', NEW);
    write(compiled, 'apps/acme/modules/a/manifest.js', OLD, 'throw new Error("imported");\n');

    const modules = overlayModulesFor(
      { deploymentRoot: compiled, deploymentSourceRoot: source },
      { DEPLOYMENT: 'acme' },
      () => [],
    );
    expect(() => modules.ids()).toThrow(OverlayBuildError);
    await expect(modules.manifests()).rejects.toBeInstanceOf(OverlayBuildError);
  });

  it('refuses a module added to the sources and never built, even with no compiled modules/', async () => {
    // Measured by acceptance:instance A8 on #1848: the compiled deployment held only
    // `divergence.js`, so there was no compiled modules root, the resolution saw no overlay
    // at all and the boot composed without the module — silently.
    const { overlayModulesFor } = await import('./overlay-runtime.js');
    const { source, compiled } = roots();
    write(source, 'apps/acme/divergence.ts', OLD);
    write(compiled, 'apps/acme/divergence.js', NEW);
    write(source, 'apps/acme/modules/added/manifest.ts', NEW);
    const modules = overlayModulesFor(
      { deploymentRoot: compiled, deploymentSourceRoot: source },
      { DEPLOYMENT: 'acme' },
      () => [],
    );
    expect(() => modules.ids()).toThrow(OverlayBuildError);
  });

  it('refuses a broken layout in the sources, which the compiled tree does not carry', async () => {
    // Measured by acceptance:instance A18 on #1848: `tsc` emits no `package.json`, so a
    // layout check over the compiled tree alone let a package in disguise through.
    const { overlayModulesFor } = await import('./overlay-runtime.js');
    const { OverlayLayoutError } = await import('./overlay-layout.js');
    const { source, compiled } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', OLD);
    write(source, 'apps/acme/modules/a/package.json', OLD, '{}');
    write(compiled, 'apps/acme/modules/a/manifest.js', NEW);
    const modules = overlayModulesFor(
      { deploymentRoot: compiled, deploymentSourceRoot: source },
      { DEPLOYMENT: 'acme' },
      () => [],
    );
    expect(() => modules.ids()).toThrow(OverlayLayoutError);
  });

  it('resolves a fresh build as overlayModulesUnder does', async () => {
    const { overlayModulesFor } = await import('./overlay-runtime.js');
    const { source, compiled } = roots();
    write(source, 'apps/acme/modules/a/manifest.ts', OLD);
    write(compiled, 'apps/acme/modules/a/manifest.js', NEW);
    const modules = overlayModulesFor(
      { deploymentRoot: compiled, deploymentSourceRoot: source },
      { DEPLOYMENT: 'acme' },
      () => [],
    );
    expect(modules.ids()).toEqual(['a']);
  });

  it('compares nothing and says so once when no source root is given', async () => {
    const { overlayModulesFor } = await import('./overlay-runtime.js');
    const { compiled } = roots();
    write(compiled, 'apps/acme/modules/a/manifest.js', NEW);
    const lines: string[] = [];
    const modules = overlayModulesFor({ deploymentRoot: compiled }, { DEPLOYMENT: 'acme' }, () => [], {
      info: (line) => lines.push(line),
    });
    expect(modules.ids()).toEqual(['a']);
    modules.ids();
    expect(lines).toEqual(['[overlay] no source root; build freshness not compared']);
  });
});
