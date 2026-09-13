import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  applicationReachRefusal,
  checkApplicationReaches,
  checkPlatformSurface,
  hostDependentCoverage,
  hostReachCoverage,
  isPackageToolingConfig,
  keyOf,
  NO_SYMBOL,
  platformSurfaceRefusal,
  RELATIVE_HOST_REACHES,
  remedyOf,
  scanApplicationReaches,
  scanPlatformSurface,
  UNPUBLISHED_PLATFORM_REACHES,
  type ApplicationReachInput,
  type LedgeredReach,
  type PlatformSurfaceFinding,
  type PlatformSurfaceInput,
} from '../../../scripts/check-platform-surface.js';
import { platformSourceRootOf } from '../../../scripts/lib/platform-root.js';
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
  // The manifest's own `exports` keys, which are a **superset** of the published
  // barrels (D-160.14): `composition` is declared, carried by no barrel, and
  // nameable by no module. The two lists differing is what lets the analysis
  // tell "the map refuses this path" from "the map resolves it and no module
  // may write it".
  // Two host-internal members and not one, deliberately: the analysis reads this
  // as a *set* and a fixture with a single member cannot tell a rule from a
  // special case. `demo` is the ninth in the real manifest
  // (`specs/110-instance-repository/` T119b) and the first one added since the
  // class existed, so the proof below is taken over both.
  declaredSubpaths: new Set(['kernel', 'http', 'composition', 'demo']),
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
    const result = checkPlatformSurface(input({ 'backend/src/apps/example/divergence.ts': '' }), {});
    expect(kinds(result.violations)).toEqual(['unattributed-source']);
    expect(result.violations[0]?.moduleId).toBeNull();
  });

  it('leaves a module whose own sources are inside the platform package alone', () => {
    // D-160.11's second half: `_lifecycle` merged into the host package, so its
    // files reach `kernel/` and `http/` from *inside* the same package. The
    // specifier is unchanged and its meaning is not — nothing crosses a package
    // boundary and no `exports` map is asked about it — which is what the
    // sixteen `LIFECYCLE_HOST_HALF` entries meant by *"retires with the merge,
    // not by editing the import"*.
    const source = "import { SettingsCache } from '../kernel/settings/settings-cache.js';";
    const files = new Set([
      ...FIXTURE_FILES,
      'packages/platform/src/kernel/settings/settings-cache.ts',
    ]);
    const inside = checkPlatformSurface(
      {
        ...input({ 'packages/platform/src/lifecycle/services/orchestrator.ts': source }),
        files,
        moduleIdOf: (key) => (key.includes('/lifecycle/') ? '_lifecycle' : null),
        platformSourceRoot: 'packages/platform/src',
      },
      {},
    );
    expect(inside.findings).toEqual([]);
    expect(scanPlatformSurface({
      ...input({ 'packages/platform/src/lifecycle/services/orchestrator.ts': source }),
      files,
      moduleIdOf: (key) => (key.includes('/lifecycle/') ? '_lifecycle' : null),
      platformSourceRoot: 'packages/platform/src',
    }).reaches).toBe(0);

    // The discrimination: the identical reach from a module **outside** the
    // package is still a finding, so the exemption is about where the reaching
    // file is and not about the symbol.
    const outside = checkPlatformSurface(
      input({
        'backend/src/modules/blog/backend.ts':
          "import { SettingsCache } from '../../kernel/settings/settings-cache.js';",
      }),
      {},
    );
    expect(kinds(outside.violations)).toEqual(['unpublished-symbol']);
    expect(outside.violations[0]?.symbol).toBe('SettingsCache');
  });

  it('still reports a file inside the platform that no module owns', () => {
    // The exemption is applied **after** the attribution, never instead of it:
    // a file the walk opened and could not attribute is #215 one layer in,
    // whichever tree it is in.
    const result = checkPlatformSurface(
      {
        ...input({ 'packages/platform/src/lifecycle/services/orphan.ts': '' }),
        moduleIdOf: () => null,
        platformSourceRoot: 'packages/platform/src',
      },
      {},
    );
    expect(kinds(result.violations)).toEqual(['unattributed-source']);
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

  /**
   * D-160.14 — the third state, and the only finding here that neither `node`
   * nor `tsc` would raise. `./composition` is declared by the `exports` map, so
   * it resolves; it is carried by no barrel, so no module may name it.
   *
   * The fixture enters as source text at the top of the scan, like every other
   * proof in this file (issue #130): the classification under test is the one a
   * real run performs on a real specifier.
   */
  it('reports a subpath the host declares and publishes to nobody', () => {
    const reach = {
      [packaged]: "import { composeModules } from '@endora-commerce/platform/composition';",
    };
    const result = checkPlatformSurface(input(reach), {});
    expect(kinds(result.violations)).toEqual(['host-internal-subpath']);
    expect(result.violations[0]).toMatchObject({
      moduleId: 'blog',
      target: '@endora-commerce/platform/composition',
      specifier: '@endora-commerce/platform/composition',
      symbol: NO_SYMBOL,
    });
    // Its remedy must not be the `unpublished-subpath` one: telling this author
    // that the map "refuses the path at resolution time" is false, and the
    // repair it implies — widen the map — is the thing D-160.8 refuses.
    expect(remedyOf(result.violations[0]!)).toContain('publishes to nobody');
    expect(remedyOf(result.violations[0]!)).not.toContain('names no subpath');
    // A host reach for the coverage derivation, like every other one.
    expect([...scanPlatformSurface(input(reach)).hostReachModules]).toEqual(['blog']);
  });

  it('reports the demo subpath the same way, so the class is a rule and not a case', () => {
    // `specs/110-instance-repository/` T119b. `./demo` is declared by the
    // `exports` map and carried by no barrel, exactly as `./composition` is, and
    // it is the first member added since the third state was invented — so the
    // verdict is asserted for it rather than assumed to follow. A module that
    // could name it could seed, and reset, its siblings' data.
    const reach = {
      [packaged]: "import { runDemo } from '@endora-commerce/platform/demo';",
    };
    const result = checkPlatformSurface(input(reach), {});
    expect(kinds(result.violations)).toEqual(['host-internal-subpath']);
    expect(result.violations[0]).toMatchObject({
      moduleId: 'blog',
      target: '@endora-commerce/platform/demo',
      specifier: '@endora-commerce/platform/demo',
      symbol: NO_SYMBOL,
    });
    expect(remedyOf(result.violations[0]!)).toContain('publishes to nobody');
    expect(resolveHostSpecifier('@endora-commerce/platform/demo', HOST)).toEqual({
      kind: 'host-internal-subpath',
      subpath: 'demo',
    });
  });

  it('tells the declared-and-unpublished subpath from the one that does not exist', () => {
    // The two states are one branch and two verdicts, so the discrimination is
    // asserted rather than assumed: `composition` is in `declaredSubpaths`,
    // `testing` is in neither list.
    expect(resolveHostSpecifier('@endora-commerce/platform/composition', HOST)).toEqual({
      kind: 'host-internal-subpath',
      subpath: 'composition',
    });
    expect(resolveHostSpecifier('@endora-commerce/platform/testing', HOST)).toEqual({
      kind: 'undeclared-subpath',
      subpath: 'testing',
    });
  });

  it('does not publish a declared subpath’s symbols to a module’s relative reach', () => {
    // §2.7.5(a), measured as a discrimination rather than asserted: the subpath
    // is not a sixth `PUBLISHED_SUBPATHS` entry, so `composeModules` is still
    // unpublished at `kernel/compose.ts` for a module writing the relative
    // specifier. An entry there would have cleared this reach — silently, since
    // the check reports `violations=0` on the real tree.
    const source = {
      'backend/src/modules/blog/backend.ts':
        "import { composeModules } from '../../kernel/compose.js';",
    };
    const result = checkPlatformSurface(
      input(source, {
        // The file the specifier lands on has to exist for the reach to be
        // *resolved* rather than unresolvable — the proof is about the verdict,
        // so it must not pass for the wrong reason.
        files: new Set([...FIXTURE_FILES, ...Object.keys(source), 'backend/src/kernel/compose.ts']),
      }),
      {},
    );
    expect(kinds(result.violations)).toEqual(['unpublished-symbol']);
    expect(result.violations[0]).toMatchObject({
      symbol: 'composeModules',
      target: 'backend/src/kernel/compose.ts',
    });
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
    { moduleId: 'analytics', dependsOnHost: false },
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

/**
 * A module package's own tooling configuration is not module source
 * (feature 089, Phase 1).
 *
 * `vitest.config.ts` is the first `.ts` file a module package holds that its
 * build does not compile — and it exists to `mergeConfig` the repository root's
 * `vitest.config.base.ts`, a file in no module walk root and no source root, so
 * the walk cannot resolve the reach and reports `unresolvable-reach` (which is
 * right, and fail-closed, for a *module* reach). The honest answer is that the
 * file is not one. The end-to-end half of this proof is the spawned run below:
 * this tree now holds four such configurations and the check exits 0 over them.
 */
describe('a package configuration is out of the module source population', () => {
  it('drops a *.config.ts sitting at a module walk root', () => {
    expect(
      isPackageToolingConfig('/repo/packages/modules/blog', '/repo/packages/modules/blog/vitest.config.ts'),
    ).toBe(true);
  });

  it('keeps a config file that is module source', () => {
    // Under `src/` it is compiled, published and importable — module source by
    // every test the package's own build applies. The rule is about the package
    // root, not about the word "config".
    expect(
      isPackageToolingConfig(
        '/repo/packages/modules/blog',
        '/repo/packages/modules/blog/src/backend/feed.config.ts',
      ),
    ).toBe(false);
  });

  it('keeps an ordinary source file at the root of a module directory', () => {
    // A module still under `backend/src/modules/` keeps its `backend.ts` and
    // `manifest.ts` at the walk root; only the `.config.ts` suffix leaves.
    expect(
      isPackageToolingConfig('/repo/backend/src/modules/blog', '/repo/backend/src/modules/blog/backend.ts'),
    ).toBe(false);
  });
});

/* ------------------------------------------ the application's own reaches */

/**
 * The platform as the application actually reaches it (feature 115, D115-5).
 *
 * A second fixture rather than a reuse of {@link FIXTURE_FILES}, and the reason
 * is the subject: that one spells the platform at `backend/src/<subpath>/…`,
 * which is where the *shims* are, and this half's whole predicate is a specifier
 * that lands inside the **package**. Both spellings of the reach — `dist/`, what
 * the tree writes today, and `src/`, what a well-meaning cleanup would write
 * next — canonicalise onto the same source file, so the two fixtures below share
 * a ledger key.
 */
const PLATFORM_MEMBER = 'packages/platform';
const PLATFORM_SRC = 'packages/platform/src';

const APPLICATION_FILES = new Set([
  'packages/platform/src/kernel/index.ts',
  'packages/platform/src/kernel/settings/settings-cache.ts',
  'packages/platform/src/kernel/compose.ts',
  'packages/platform/src/lifecycle/manifest.ts',
  'backend/src/kernel/settings/settings-cache.ts',
  'backend/src/db/index.ts',
]);

const APPLICATION_HOST: HostPackage = {
  name: '@endora-commerce/platform',
  subpathTargets: new Map([['kernel', 'packages/platform/src/kernel/index.ts']]),
  declaredSubpaths: new Set(['kernel', 'composition']),
};

function applicationInput(
  sources: Record<string, string>,
  overrides: Partial<ApplicationReachInput> = {},
): ApplicationReachInput {
  return {
    sources: new Map(Object.entries(sources)),
    platformMemberRoot: PLATFORM_MEMBER,
    platformSourceRoot: PLATFORM_SRC,
    files: new Set([...APPLICATION_FILES, ...Object.keys(sources)]),
    surface: publishedSurface(
      new Map([
        [
          'packages/platform/src/kernel/index.ts',
          "export { SettingsCache } from './settings/settings-cache.js';\n",
        ],
      ]),
    ),
    host: APPLICATION_HOST,
    ...overrides,
  };
}

describe('the application as a second consumer population (feature 115)', () => {
  it('reports a relative reach into the platform build output', () => {
    const scan = scanApplicationReaches(
      applicationInput({
        'backend/src/kernel/index.ts':
          "export * from '../../../packages/platform/dist/kernel/index.js';",
      }),
    );

    expect(kinds(scan.findings)).toEqual(['relative-host-reach']);
    expect(scan.reaches).toBe(1);
    expect(scan.findings[0]!.target).toBe('packages/platform/src/kernel/index.ts');
  });

  it('gives the `src` spelling of the same reach the same key as the `dist` one', () => {
    // The one way this repair could regress in silence: re-spelling a `dist`
    // path as a `src` path is the same reach, and a specifier-keyed ledger
    // would report the entry stale and the reach unledgered in one run — two
    // findings that say "you moved it", and a green one edit away.
    const dist = scanApplicationReaches(
      applicationInput({
        'backend/src/kernel/index.ts':
          "export * from '../../../packages/platform/dist/kernel/index.js';",
      }),
    );
    const source = scanApplicationReaches(
      applicationInput({
        'backend/src/kernel/index.ts':
          "export * from '../../../packages/platform/src/kernel/index.ts';",
      }),
    );

    expect(keyOf(source.findings[0]!)).toBe(keyOf(dist.findings[0]!));
    expect(keyOf(dist.findings[0]!)).toBe(
      'backend/src/kernel/index.ts|packages/platform/src/kernel/index.ts',
    );
  });

  it('names the address when a barrel carries the file, and says so when none does', () => {
    const carried = scanApplicationReaches(
      applicationInput({
        'backend/src/kernel/settings/settings-cache.ts':
          "export * from '../../../../packages/platform/dist/kernel/settings/settings-cache.js';",
      }),
    );
    const uncarried = scanApplicationReaches(
      applicationInput({
        'backend/src/kernel/compose.ts':
          "export * from '../../../packages/platform/dist/kernel/compose.js';",
      }),
    );

    // The remedy is derived from the barrels and the `exports` map, so a sixth
    // published directory changes the sentence in the same run.
    expect(remedyOf(carried.findings[0]!)).toContain('`@endora-commerce/platform/kernel`');
    expect(remedyOf(uncarried.findings[0]!)).toContain('declares no subpath carrying this file');
  });

  it('says nothing about a bare specifier into the host, published or host-internal', () => {
    // The discrimination the rule turns on. The application is *entitled* to
    // `./composition` (D-160.14) — that three-way answer is a module's question,
    // and asking it twice with two verdicts is two answers waiting to disagree.
    const scan = scanApplicationReaches(
      applicationInput({
        'backend/src/composition.ts': [
          "import { SettingsCache } from '@endora-commerce/platform/kernel';",
          "import { composeModules } from '@endora-commerce/platform/composition';",
        ].join('\n'),
      }),
    );

    expect(scan.findings).toEqual([]);
    expect(scan.reaches).toBe(0);
  });

  it('says nothing about a module reaching the shim, which is the other rule', () => {
    // A module's relative specifier lands on `backend/src/<subpath>/…` — a shim,
    // not the package — so it is not this predicate's subject at all, and the
    // module half goes on judging it against the published surface.
    const specifier = "import { SettingsCache } from '../../kernel/settings/settings-cache.js';";

    expect(
      scanApplicationReaches(
        applicationInput({ 'backend/src/modules/blog/backend.ts': specifier }),
      ).findings,
    ).toEqual([]);
    expect(
      kinds(checkPlatformSurface(input({ 'backend/src/modules/blog/backend.ts': specifier }), {}).findings),
    ).toEqual(['unpublished-symbol']);
  });

  it('says nothing about a comment or a string that spells the path', () => {
    // The AST-node property, asserted rather than assumed. It is load-bearing
    // here rather than decorative: seven files under `backend/scripts` name a
    // `packages/platform/…` path in prose or in a string argument, and a text
    // scan would report every one of them.
    const scan = scanApplicationReaches(
      applicationInput({
        'backend/src/manifest-index.generated.ts': [
          "// forwarded from '../../packages/platform/dist/kernel/index.js'",
          "const path = resolveManifestPath(import.meta.url, '../../packages/platform/dist/kernel/index.js');",
        ].join('\n'),
      }),
    );

    expect(scan.findings).toEqual([]);
  });

  it('says nothing about a relative specifier that lands outside the platform member', () => {
    expect(
      scanApplicationReaches(
        applicationInput({ 'backend/src/composition.ts': "import { initOrm } from './db/index.js';" }),
      ).findings,
    ).toEqual([]);
  });
});

describe('the RELATIVE_HOST_REACHES ledger, in both directions', () => {
  const REACH = {
    'backend/src/kernel/index.ts': "export * from '../../../packages/platform/dist/kernel/index.js';",
  };
  const KEY = 'backend/src/kernel/index.ts|packages/platform/src/kernel/index.ts';

  it('clears a reach the ledger names', () => {
    const result = checkApplicationReaches(applicationInput(REACH), {
      [KEY]: { reason: 'a shim', retiredBy: '110 Phase 2' },
    });

    expect(result.violations).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
    expect(result.staleKeys).toEqual([]);
  });

  it('fails a reach the ledger does not name', () => {
    const result = checkApplicationReaches(applicationInput(REACH), {});
    expect(result.violations).toHaveLength(1);
  });

  it('fails a key that describes no reach the walk found', () => {
    const result = checkApplicationReaches(applicationInput({}), {
      [KEY]: { reason: 'gone', retiredBy: '110 Phase 2' },
    });
    expect(result.staleKeys).toEqual([KEY]);
  });

  it('gives every entry this repository ships a reason and a retiring phase', () => {
    // R4.1: an entry is debt with a due date, not a permission. R4.2: this is
    // not a permanence ledger, so there is no `permanent` member to check —
    // an entry saying "this reach is correct" would mean the predicate has
    // outgrown its population (R4.5).
    const thin = Object.entries(RELATIVE_HOST_REACHES).filter(
      ([, entry]) => entry.reason.trim().length < 40 || entry.retiredBy.trim().length < 10,
    );
    expect(thin.map(([key]) => key)).toEqual([]);
  });

  it('keys every entry on a file that is on disk and a platform source file', () => {
    for (const key of Object.keys(RELATIVE_HOST_REACHES)) {
      const [file, target] = key.split('|');
      expect(existsSync(join(BACKEND_ROOT, '..', file ?? '')), `${file} is gone`).toBe(true);
      expect(target, key).toMatch(/^packages\/platform\/src\//);
    }
  });
});

describe('the application half refuses rather than reporting clean', () => {
  it('refuses a platform walk that produced no canonical target', () => {
    const refusal = applicationReachRefusal({ canonicalTargets: 0, applicationFiles: 12 });
    expect(refusal).toContain('canonicalised against that walk');
  });

  it('refuses an application walk that opened no file', () => {
    const refusal = applicationReachRefusal({ canonicalTargets: 900, applicationFiles: 0 });
    expect(refusal).toContain('opened no file');
  });

  it('does not refuse a run that read both', () => {
    expect(applicationReachRefusal({ canonicalTargets: 900, applicationFiles: 137 })).toBeNull();
  });

  it('refuses a walk short of the files its own ledger names', () => {
    // The floor is derived from the ledger — a second author's answer to "which
    // application files reach the platform" — exactly as
    // `check:module-boundary`'s admin-host floor is. A walk that stopped
    // reaching them is a refusal, never a drained ledger.
    const ledger = {
      'backend/src/a.ts|packages/platform/src/kernel/index.ts': { reason: 'x', retiredBy: 'y' },
      'backend/src/b.ts|packages/platform/src/kernel/index.ts': { reason: 'x', retiredBy: 'y' },
    };
    const coverage = hostReachCoverage(ledger, () => true, new Set(['backend/src/a.ts']));

    expect(coverage).toEqual({ source: 'host-reaches', expected: 2, covered: 1 });
    const refusal = readSizeRefusal({ prefix: '[t]', files: 1, coverage: [coverage!] });
    expect(refusal?.kind).toBe('short-walk');
    expect(refusal?.message).toContain('host-reaches');
  });

  it('reports no floor at all once the ledger empties, rather than expecting zero', () => {
    // `expected: 0` is itself a refusal in this grammar, and rightly: a floor
    // that expects nothing is switched off. R4.2 expects this ledger to empty.
    expect(hostReachCoverage({}, () => true, new Set())).toBeNull();
  });

  it('drops a ledgered file that has left the tree from the expectation', () => {
    const ledger = { 'backend/src/gone.ts|packages/platform/src/kernel/index.ts': { reason: 'x', retiredBy: 'y' } };
    expect(hostReachCoverage(ledger, () => false, new Set())).toBeNull();
  });

  it('refuses a workspace whose members declare no platform', () => {
    // §5's first refusal, restated for this population because it depends on it
    // too: with no platform there is no member directory to canonicalise
    // against, and every relative reach would read as reaching nothing.
    expect(platformSourceRootOf([])).toBeNull();
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
    // The fourth is feature 115's: the ledger's own still-on-disk file set,
    // against what the application walk opened of it. Its `covered` and
    // `expected` are the same number on purpose — a shortfall is the refusal,
    // not a finding — and it disappears entirely when the ledger empties, which
    // is what R4.2 expects to happen.
    expect(run.stdout).toMatch(
      /\[platform-surface\] read: files=\d+ sites=\d+ sources=manifest-index:(\d+)\/\1,platform-barrels:5\/5,host-dependents:(\d+)\/\2,host-reaches:(\d+)\/\3/,
    );
    expect(run.stdout).toMatch(
      /application reaches into the platform by relative path=(\d+) violations=0 ledgered=\1 ledger-size=\d+ stale=0/,
    );
  });
});
