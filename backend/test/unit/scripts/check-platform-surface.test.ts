import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  checkPlatformSurface,
  hostDependentCoverage,
  keyOf,
  platformSurfaceRefusal,
  scanPlatformSurface,
  UNPUBLISHED_PLATFORM_REACHES,
  type LedgeredReach,
  type PlatformSurfaceFinding,
  type PlatformSurfaceInput,
} from '../../../scripts/check-platform-surface.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';
import {
  barrelKeyOf,
  parseBarrel,
  publishedSurface,
  PUBLISHED_SUBPATHS,
  resolutionCandidates,
  resolveHostSpecifier,
  resolveRelative,
  type HostPackage,
} from '../../../scripts/lib/platform-surface.js';

/**
 * `check:platform-surface` — the detail of every shape it refuses (feature 080,
 * T042d; D-160.8).
 *
 * `test/unit/scripts/check-inventory.test.ts` carries one red proof per shape,
 * which is what stops a signal going blind behind another's red. This file is
 * where each shape's *behaviour* is asserted: what the finding says, what the
 * ledger does in both directions, and — the part a red proof cannot express —
 * the discriminations, the cases the check must **not** report.
 *
 * Every fixture is source text plus a file list plus barrel text, which is
 * exactly what a real run hands the analysis. Nothing here pre-computes the
 * published surface, the module attribution or the specifier resolution: those
 * three *are* the check, and a fixture entering below them would prove the last
 * function in the chain (issue #130).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
/**
 * The platform's own sources. The five barrels moved into
 * `@endora-commerce/platform` with the relocation; `backend/src/<subpath>/`
 * holds re-export shims, two of the five subpaths have none at all, and reading
 * a shim as a barrel would parse `export * from` and report the published
 * surface as unreadable.
 */
const SRC = join(BACKEND_ROOT, '..', 'packages', 'platform', 'src');

/** A barrel publishing one symbol out of one file, in the tree's own spelling. */
const KERNEL_BARREL = "export { ModuleContext } from './module-context.js';\n";
const HTTP_BARREL = "export { HttpError } from './error-envelope.js';\n";

/** The file list a fixture's specifiers resolve against. */
const FIXTURE_FILES = [
  'backend/src/kernel/index.ts',
  'backend/src/kernel/module-context.ts',
  'backend/src/kernel/settings/settings-cache.ts',
  'backend/src/http/index.ts',
  'backend/src/http/error-envelope.ts',
  'backend/src/db/index.ts',
  'backend/src/modules/blog/backend.ts',
  'backend/src/modules/blog/services/post-service.ts',
  'backend/src/modules/orders/services/order-service.ts',
];

/**
 * The host package as a packaged module names it (feature 080, T060).
 *
 * The name is the manifest's, never a scope written into the analysis, and the
 * subpath map is the `exports` map read back as file keys — which is what makes
 * `@endora-commerce/platform/kernel` and `../../kernel/index.js` the same reach
 * at the same barrel.
 */
const HOST: HostPackage = {
  name: '@endora-commerce/platform',
  subpathTargets: new Map([
    ['kernel', 'backend/src/kernel/index.ts'],
    ['http', 'backend/src/http/index.ts'],
  ]),
};

function input(
  sources: Record<string, string>,
  overrides: Partial<PlatformSurfaceInput> = {},
): PlatformSurfaceInput {
  const files = new Set([...FIXTURE_FILES, ...Object.keys(sources)]);
  return {
    sources: new Map(Object.entries(sources)),
    files,
    surface: publishedSurface(
      new Map([
        ['backend/src/kernel/index.ts', KERNEL_BARREL],
        ['backend/src/http/index.ts', HTTP_BARREL],
      ]),
    ),
    host: HOST,
    ...overrides,
  };
}

const kinds = (findings: readonly PlatformSurfaceFinding[]): string[] =>
  findings.map((finding) => finding.kind);

describe('the published-surface derivation', () => {
  it('publishes a name of the file the barrel re-exports it from, not of the barrel', () => {
    const parsed = parseBarrel(HTTP_BARREL, 'backend/src/http/index.ts');
    expect(parsed.published).toEqual([{ name: 'HttpError', target: 'backend/src/http/error-envelope.ts' }]);
    expect(parsed.unreadable).toEqual([]);
  });

  it('reads a renamed and a type-only re-export as the names they publish', () => {
    const parsed = parseBarrel(
      "export { type EventBase, EventBus as Bus } from './bus.js';",
      'backend/src/events/index.ts',
    );
    expect(parsed.published.map((symbol) => symbol.name).sort()).toEqual(['Bus', 'EventBase']);
  });

  it('reports a re-export it cannot enumerate instead of returning a short list', () => {
    const star = parseBarrel("export * from './bus.js';", 'backend/src/events/index.ts');
    expect(star.published).toEqual([]);
    expect(star.unreadable.map((entry) => entry.line)).toEqual([1]);

    const namespace = parseBarrel("export * as bus from './bus.js';", 'backend/src/events/index.ts');
    expect(namespace.unreadable).toHaveLength(1);

    const local = parseBarrel('const x = 1;\nexport { x };', 'backend/src/events/index.ts');
    expect(local.unreadable).toHaveLength(1);
  });

  it('attributes a name the barrel declares itself to the barrel', () => {
    const parsed = parseBarrel('export type Cursor = string;', 'backend/src/http/index.ts');
    expect(parsed.published).toEqual([{ name: 'Cursor', target: 'backend/src/http/index.ts' }]);
  });

  it('resolves the three specifier spellings the tree writes', () => {
    expect(resolveRelative('backend/src/modules/blog/backend.ts', '../../http/error-envelope.js')).toBe(
      'backend/src/http/error-envelope.js',
    );
    expect(resolutionCandidates('backend/src/http/error-envelope.js')[0]).toBe('backend/src/http/error-envelope.ts');
    expect(resolutionCandidates('backend/src/kernel/ports')).toContain('backend/src/kernel/ports/index.ts');
    expect(resolveRelative('backend/src/modules/blog/backend.ts', '@b2b/contracts')).toBeNull();
  });
});

describe('check:platform-surface findings', () => {
  it('reports a symbol the barrel does not publish out of that file', () => {
    const result = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import { SettingsCache } from '../../kernel/settings/settings-cache.js';",
      }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['unpublished-symbol']);
    expect(result.violations[0]).toMatchObject({
      moduleId: 'blog',
      target: 'backend/src/kernel/settings/settings-cache.ts',
      symbol: 'SettingsCache',
    });
  });

  it('clears a symbol the barrel publishes, reached by its deep relative path', () => {
    const result = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts': "import { HttpError } from '../../http/error-envelope.js';",
      }),
      {},
    );
    expect(result.violations).toEqual([]);
    expect(result.reaches).toBe(1);
  });

  it('refuses the same name taken from a file the barrel does not publish it out of', () => {
    // The pair is the verdict, not the name: `HttpError` is published, and
    // `db/index.ts` publishes nothing at all.
    const result = checkPlatformSurface(
      input({ 'backend/src/modules/blog/backend.ts': "import { HttpError } from '../../db/index.js';" }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['unpublished-symbol']);
    expect(result.violations[0]?.target).toBe('backend/src/db/index.ts');
  });

  it('reports a whole-file reach at a file that is not a barrel', () => {
    const result = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts': "import * as cache from '../../kernel/settings/settings-cache.js';",
        'backend/src/modules/blog/services/post-service.ts': "import '../../../db/index.js';",
      }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['whole-file-reach', 'whole-file-reach']);
  });

  it('clears a whole-file reach at a barrel, which is the published surface entire', () => {
    const result = checkPlatformSurface(
      input({ 'backend/src/modules/blog/backend.ts': "import * as kernel from '../../kernel/index.js';" }),
      {},
    );
    expect(result.violations).toEqual([]);
  });

  it('reports a relative specifier that names no file the walk found', () => {
    const result = checkPlatformSurface(
      input({ 'backend/src/modules/blog/backend.ts': "import { X } from '../../kernel/gone.js';" }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['unresolvable-reach']);
    expect(result.violations[0]?.target).toBe('../../kernel/gone.js');
  });

  it('reports a walked file no module owns instead of skipping it', () => {
    const result = checkPlatformSurface(input({ 'backend/src/apps/example/reduced-deployment.ts': '' }), {});
    expect(kinds(result.violations)).toEqual(['unattributed-source']);
    expect(result.violations[0]?.moduleId).toBeNull();
  });

  it('leaves a module-to-module reach to check:module-boundary', () => {
    const result = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import { OrderService } from '../orders/services/order-service.js';",
      }),
      {},
    );
    expect(result.findings).toEqual([]);
  });

  it('leaves a bare specifier into someone else\'s package alone', () => {
    const result = checkPlatformSurface(
      input({ 'backend/src/modules/blog/backend.ts': "import { z } from 'zod';" }),
      {},
    );
    expect(result.findings).toEqual([]);
    expect(scanPlatformSurface(input({ 'backend/src/modules/blog/backend.ts': "import { z } from 'zod';" })).reaches).toBe(0);
  });

  it('reads a type-only import and a type-position dynamic import as reaches', () => {
    // §0b: one specifier in the tree is written `import('…').T` inside a type,
    // and a `from '…'`-only scan does not see it.
    const result = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import type { SettingsCache } from '../../kernel/settings/settings-cache.js';",
        'backend/src/modules/blog/services/post-service.ts':
          "let cache: import('../../../kernel/settings/settings-cache.js').SettingsCache;",
      }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['unpublished-symbol', 'unpublished-symbol']);
  });

  it('counts sites as the reaches judged, cleared ones included', () => {
    const scan = scanPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import { HttpError } from '../../http/error-envelope.js';\n" +
          "import { SettingsCache } from '../../kernel/settings/settings-cache.js';",
      }),
    );
    expect(scan.reaches).toBe(2);
    expect(scan.findings).toHaveLength(1);
  });
});

/**
 * Feature 080, T060 — the walk keeps its population as a module becomes a
 * package.
 *
 * A module in `backend/src/modules` reaches the platform by relative specifier;
 * the same module in `packages/modules/<id>` reaches it by the host package's
 * bare one. Until this block the second was `continue`d one line into the scan,
 * so the reach left the walk as the module left the tree — 216 of them by the
 * first batch, judged by nothing, while the check printed a clean line over the
 * remainder.
 */
describe('a bare specifier into the host package', () => {
  const packaged = 'packages/modules/blog/src/backend.ts';

  it('resolves a published subpath to the barrel it names', () => {
    expect(resolveHostSpecifier('@endora-commerce/platform/kernel', HOST)).toEqual({
      kind: 'published-subpath',
      subpath: 'kernel',
      target: 'backend/src/kernel/index.ts',
    });
  });

  it('answers for nobody else — a relative specifier, another package, a name that merely starts the same', () => {
    // The segment boundary is the whole of the third: `@endora-commerce/platform-extras`
    // is a different package, and a bare `startsWith` reads it as this one.
    expect(resolveHostSpecifier('../../kernel/index.js', HOST)).toBeNull();
    expect(resolveHostSpecifier('zod', HOST)).toBeNull();
    expect(resolveHostSpecifier('@endora-commerce/platform-extras/kernel', HOST)).toBeNull();
    expect(resolveHostSpecifier('@endora-commerce/platform/kernel', null)).toBeNull();
  });

  it('judges a packaged module\'s reach the walk used to skip', () => {
    const scan = scanPlatformSurface(
      input({ [packaged]: "import { HttpError } from '@endora-commerce/platform/http';" }),
    );
    expect(scan.reaches).toBe(1);
    expect(scan.findings).toEqual([]);
    expect([...scan.hostReachModules]).toEqual(['blog']);
  });

  it('counts the same reach either way, so the population does not fall when a module moves', () => {
    // The property the recorded read size rests on: a module's platform reaches
    // are the same number in both layouts, so the number stops being a function
    // of where the module lives.
    const relative = scanPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import { HttpError } from '../../http/error-envelope.js';\n" +
          "import * as http from '../../http/index.js';",
      }),
    );
    const bare = scanPlatformSurface(
      input({
        [packaged]:
          "import { HttpError } from '@endora-commerce/platform/http';\n" +
          "import * as http from '@endora-commerce/platform/http';",
      }),
    );
    expect(bare.reaches).toBe(relative.reaches);
    expect(bare.findings).toEqual([]);
  });

  it('reports a subpath the host does not publish', () => {
    const deep = {
      [packaged]:
        "import { SettingsCache } from '@endora-commerce/platform/kernel/settings/settings-cache.js';",
    };
    const result = checkPlatformSurface(input(deep), {});
    expect(kinds(result.violations)).toEqual(['unpublished-subpath']);
    expect(result.violations[0]).toMatchObject({
      moduleId: 'blog',
      target: '@endora-commerce/platform/kernel/settings/settings-cache.js',
      specifier: '@endora-commerce/platform/kernel/settings/settings-cache.js',
    });
    // Still a host reach for the coverage derivation: the package named the
    // host and the walk read it. A subpath the `exports` map refuses is a
    // finding about the reach, not a reason to forget it was there.
    expect([...scanPlatformSurface(input(deep)).hostReachModules]).toEqual(['blog']);
  });

  it('reports the host package\'s root, which D-160.7 leaves unpublished', () => {
    const result = checkPlatformSurface(
      input({ [packaged]: "import { HttpError } from '@endora-commerce/platform';" }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['unpublished-subpath']);
  });

  it('reads nothing as a host reach when the workspace declares no platform', () => {
    // A fixture workspace legitimately has none, and the answer must be "no
    // host reach" rather than "every bare specifier is one".
    const scan = scanPlatformSurface(
      input(
        { [packaged]: "import { HttpError } from '@endora-commerce/platform/http';" },
        { host: null },
      ),
    );
    expect(scan.reaches).toBe(0);
    expect(scan.findings).toEqual([]);
    expect([...scan.hostReachModules]).toEqual([]);
  });
});

describe('the ledger, in both directions', () => {
  const source = {
    'backend/src/modules/blog/backend.ts':
      "import { SettingsCache } from '../../kernel/settings/settings-cache.js';",
  };
  const key = 'backend/src/modules/blog/backend.ts|backend/src/kernel/settings/settings-cache.ts';

  it('clears a reach an entry names', () => {
    const result = checkPlatformSurface(input(source), {
      [key]: { symbols: ['SettingsCache'], reason: 'why' },
    });
    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
  });

  it('fails a key that describes no reach at all', () => {
    const result = checkPlatformSurface(input({}), {
      [key]: { symbols: ['SettingsCache'], reason: 'why' },
    });
    expect(result.staleKeys).toEqual([key]);
  });

  it('fails a symbol the entry names and the walk no longer sees', () => {
    const result = checkPlatformSurface(input(source), {
      [key]: { symbols: ['SettingsCache', 'SETTINGS_LRU_TTL_MS'], reason: 'why' },
    });
    expect(result.violations).toEqual([]);
    expect(result.staleSymbols).toEqual([`${key}#SETTINGS_LRU_TTL_MS`]);
  });

  it('fails a symbol the entry does not name, under a key that exists', () => {
    // The reason a count would not do: swapping one unpublished name for
    // another leaves the key and the site total unchanged.
    const result = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import { SETTINGS_LRU_TTL_MS } from '../../kernel/settings/settings-cache.js';",
      }),
      { [key]: { symbols: ['SettingsCache'], reason: 'why' } },
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.symbol).toBe('SETTINGS_LRU_TTL_MS');
  });
});

describe('the ledger this repository ships', () => {
  it('carries a non-empty reason for every entry', () => {
    const empty = Object.entries(UNPUBLISHED_PLATFORM_REACHES).filter(
      ([, entry]: [string, LedgeredReach]) => entry.reason.trim().length < 40,
    );
    expect(empty.map(([key]) => key)).toEqual([]);
  });

  it('names at least one symbol per entry', () => {
    const bare = Object.entries(UNPUBLISHED_PLATFORM_REACHES).filter(
      ([, entry]: [string, LedgeredReach]) => entry.symbols.length === 0,
    );
    expect(bare.map(([key]) => key)).toEqual([]);
  });

  it('is keyed the way the check keys a finding', () => {
    const finding: PlatformSurfaceFinding = {
      kind: 'unpublished-symbol',
      file: 'backend/src/modules/blog/backend.ts',
      line: 1,
      moduleId: 'blog',
      target: 'backend/src/db/index.ts',
      symbol: 'initOrm',
      specifier: '../../db/index.js',
    };
    expect(keyOf(finding)).toBe('backend/src/modules/blog/backend.ts|backend/src/db/index.ts');
  });
});

describe('the host-dependent floor (feature 080, T060)', () => {
  const declaring = [
    { moduleId: 'blog', dependsOnHost: true },
    { moduleId: 'seo', dependsOnHost: true },
    { moduleId: 'health_checks', dependsOnHost: false },
  ];

  it('expects a host reach from every package whose manifest declares the host', () => {
    expect(hostDependentCoverage(declaring, new Set(['blog', 'seo']))).toEqual({
      source: 'host-dependents',
      expected: 2,
      covered: 2,
    });
  });

  it('comes back short when a declaring package contributed no reach', () => {
    // What `reportReadSize` turns into exit 2 — and the whole point of the
    // derivation: the manifest is generated from the bare specifiers the
    // sources write, so a package that declares the host and reaches it nowhere
    // means the walk stopped reading those specifiers.
    const coverage = hostDependentCoverage(declaring, new Set(['blog']));
    expect(coverage).toEqual({ source: 'host-dependents', expected: 2, covered: 1 });
    expect(readSizeRefusal({ prefix: '[platform-surface]', files: 10, coverage: [coverage!] }))
      .toMatchObject({ kind: 'short-walk' });
  });

  it('declines to report a floor no package supports, rather than expecting nothing', () => {
    // `expected: 0` is itself a refusal in this grammar, and a tree with no
    // module package is a legal tree — every one of them until !910.
    expect(hostDependentCoverage([{ moduleId: 'blog', dependsOnHost: false }], new Set())).toBeNull();
    expect(hostDependentCoverage([], new Set())).toBeNull();
  });
});

describe('the vacuous-pass guards', () => {
  it('every published subpath has a barrel with exports on this tree', () => {
    for (const subpath of PUBLISHED_SUBPATHS) {
      const barrel = join(SRC, barrelKeyOf(subpath));
      expect(existsSync(barrel), `${subpath} has no barrel`).toBe(true);
      const parsed = parseBarrel(readFileSync(barrel, 'utf8'), barrelKeyOf(subpath));
      expect(parsed.published.length, `${subpath} publishes nothing`).toBeGreaterThan(0);
      expect(parsed.unreadable, `${subpath} holds an unreadable re-export`).toEqual([]);
    }
  });

  it('reports a short barrel list rather than a narrower surface', () => {
    const surface = publishedSurface(new Map([['backend/src/http/index.ts', HTTP_BARREL]]));
    expect(surface.barrelsWithExports).toBe(1);
    expect(surface.barrelsWithExports).toBeLessThan(PUBLISHED_SUBPATHS.length);
  });

  it('refuses a published subpath whose barrel is not there', () => {
    const refusal = platformSurfaceRefusal({
      missingBarrels: ['backend/src/tenancy/index.ts'],
      surface: publishedSurface(new Map([['backend/src/http/index.ts', HTTP_BARREL]])),
    });
    expect(refusal).toContain('backend/src/tenancy/index.ts');
    expect(refusal).toContain('come back short');
  });

  it('refuses a barrel holding a re-export it cannot enumerate', () => {
    const refusal = platformSurfaceRefusal({
      missingBarrels: [],
      surface: publishedSurface(new Map([['backend/src/events/index.ts', "export * from './bus.js';"]])),
    });
    expect(refusal).toContain('cannot enumerate');
  });

  it('does not refuse the surface this tree actually ships', () => {
    const barrels = new Map(
      PUBLISHED_SUBPATHS.map((subpath) => [
        barrelKeyOf(subpath),
        readFileSync(join(SRC, barrelKeyOf(subpath)), 'utf8'),
      ]),
    );
    expect(
      platformSurfaceRefusal({ missingBarrels: [], surface: publishedSurface(barrels) }),
    ).toBeNull();
  });

  it('exits 0 on this tree, with a read line naming all three derivations', () => {
    const run = spawnSync(
      join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx'),
      [join(BACKEND_ROOT, 'scripts', 'check-platform-surface.ts')],
      { cwd: BACKEND_ROOT, encoding: 'utf8', env: { ...process.env } },
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    // The third is T060's: every module package whose manifest declares the
    // host as a dependency must have contributed a host reach to this walk. It
    // is the derivation that goes red when the next batch of modules moves and
    // their bare specifiers stop being read — the failure that stood here for
    // two batches with nothing but a recorded number between it and a green.
    expect(run.stdout).toMatch(
      /\[platform-surface\] read: files=\d+ sites=\d+ sources=manifest-index:(\d+)\/\1,platform-barrels:5\/5,host-dependents:(\d+)\/\2/,
    );
  });
});
