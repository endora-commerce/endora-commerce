/**
 * `check:admin-surface` — a module reaching admin platform surface the platform
 * does not publish (feature 091, FR-009/FR-016).
 *
 * Every fixture enters at the **top** of the analysis: reach *sites* as the walk
 * produces them, plus the shim map and the barrels as the filesystem produces
 * them. A fixture handing in a ready-made verdict would exercise the
 * bookkeeping and leave the two derivations that matter — is this target a
 * shim, and does that subpath's barrel export this symbol — unrun, which is
 * issue #130's shape.
 *
 * The two source-text derivations get their own blocks, because each is the
 * place a green run could start meaning "not looking": `shimSubpathsOf` decides
 * what counts as published, and `barrelSymbolsOf` decides what a barrel says.
 *
 * The last block is about **this** repository: the real ledger's keys are held
 * to the real key grammar, so an entry written by hand in the shape the check
 * cannot match is caught here rather than as a stale entry six merges later.
 */
import { describe, expect, it } from 'vitest';

import {
  barrelSymbolsOf,
  bareKitSubpath,
  checkAdminSurface,
  reachKey,
  reachesOf,
  shimSubpathsOf,
  vacuousReason,
  type AdminReachSite,
  type AdminResolution,
  type AdminSurfaceFindingKind,
  type AdminSurfaceInput,
} from '../../../scripts/check-admin-surface.js';
import { UNPUBLISHED_ADMIN_REACHES } from '../../../scripts/ledgers/admin-surface.js';

const KIT = '@endora-commerce/admin-kit';

/** The published half of a tiny tree: one shim over one barrel. */
const SHIMS = new Map<string, ReadonlySet<string>>([
  ['admin/src/components/ui/button.tsx', new Set(['ui'])],
]);
const BARRELS = new Map<string, ReadonlySet<string>>([
  ['ui', new Set(['Button', 'buttonVariants'])],
]);

function site(overrides: Partial<AdminReachSite> = {}): AdminReachSite {
  return {
    file: 'admin/src/modules/orders/OrdersList.tsx',
    owner: 'orders',
    specifier: '@/components/ui/button',
    line: 3,
    symbols: ['Button'],
    shape: 'named',
    packaged: false,
    ...overrides,
  };
}

/**
 * The resolver, as a fixture. Anything under `admin/src/modules` is a module's,
 * anything else spelled with the alias is host, and one specifier deliberately
 * resolves to nothing.
 */
function resolveAdmin(reach: AdminReachSite): AdminResolution {
  if (!reach.specifier.startsWith('@/')) return { kind: 'external' };
  const path = `admin/src/${reach.specifier.slice(2)}`;
  if (path.startsWith('admin/src/modules/')) return { kind: 'module', path };
  if (path.endsWith('gone')) return { kind: 'unresolvable' };
  const withExtension = path.endsWith('.ts') || path.endsWith('.tsx');
  return { kind: 'admin', path: withExtension ? path : `${path}.tsx` };
}

function input(overrides: Partial<AdminSurfaceInput> = {}): AdminSurfaceInput {
  return {
    sites: [site()],
    shims: SHIMS,
    barrels: BARRELS,
    kitName: KIT,
    aliasPrefix: '@/',
    resolveAdmin,
    ...overrides,
  };
}

function kinds(
  sites: readonly AdminReachSite[],
  overrides: Partial<AdminSurfaceInput> = {},
): readonly AdminSurfaceFindingKind[] {
  return checkAdminSurface(input({ sites, ...overrides }), {}).findings.map((f) => f.kind);
}

describe('check:admin-surface — the five findings', () => {
  it('passes a reach that lands on a shim and names a symbol the barrel exports', () => {
    expect(kinds([site()])).toEqual([]);
  });

  it('refuses a symbol the barrel does not export, and names it', () => {
    const result = checkAdminSurface(
      input({ sites: [site({ symbols: ['Button', 'ButtonGroup'] })] }),
      {},
    );
    expect(result.findings.map((f) => f.kind)).toEqual(['unpublished-symbol']);
    // The verdict is per symbol: `Button` is published and must not be
    // reported, or the message sends its reader to the wrong repair.
    expect(result.findings[0]!.symbols).toEqual(['ButtonGroup']);
  });

  it('refuses a reach into a host file that is not a shim', () => {
    expect(kinds([site({ specifier: '@/components/organization-picker' })])).toEqual([
      'unpublished-symbol',
    ]);
  });

  it('refuses a namespace, a side-effect and a dynamic reach as whole-file', () => {
    expect(
      kinds([
        site({ shape: 'namespace', symbols: [] }),
        site({ shape: 'side-effect', symbols: [] }),
        site({ shape: 'dynamic', symbols: [] }),
      ]),
    ).toEqual(['whole-file-reach', 'whole-file-reach', 'whole-file-reach']);
  });

  it("refuses a packaged module's admin layer writing the application's alias", () => {
    expect(
      kinds([
        site({
          file: 'packages/modules/blog/src/admin/pages/BlogList.tsx',
          owner: 'blog',
          packaged: true,
        }),
      ]),
    ).toEqual(['aliased-reach']);
    // …and the same specifier from the application itself is not a finding,
    // which is what makes this about installability rather than about `@/`.
    expect(kinds([site({ packaged: false })])).toEqual([]);
  });

  it('refuses a bare specifier naming a subpath the exports map does not declare', () => {
    expect(kinds([site({ specifier: `${KIT}/forms` })])).toEqual(['unpublished-subpath']);
    expect(kinds([site({ specifier: KIT })])).toEqual(['unpublished-subpath']);
    expect(kinds([site({ specifier: `${KIT}/ui` })])).toEqual([]);
  });

  it('refuses a specifier inside the admin source root that resolves to nothing', () => {
    expect(kinds([site({ specifier: '@/components/gone' })])).toEqual(['unresolvable-reach']);
  });

  it('leaves a reach into another module directory to check:module-boundary', () => {
    expect(kinds([site({ specifier: '@/modules/cms/api/cms-client' })])).toEqual([]);
  });
});

describe('check:admin-surface — the ledger is two-way', () => {
  const key = reachKey(
    'admin/src/modules/orders/OrdersList.tsx',
    'admin/src/components/organization-picker.tsx',
  );

  it('accounts for a ledgered reach and reports it as ledgered, not as a pass', () => {
    const result = checkAdminSurface(
      input({ sites: [site({ specifier: '@/components/organization-picker' })] }),
      { [key]: { symbols: ['Button'], reason: 'ledgered' } },
    );
    expect(result.findings).toEqual([]);
    expect(result.ledgered).toHaveLength(1);
  });

  it('refuses an entry describing no reach in this run', () => {
    const result = checkAdminSurface(input({ sites: [site()] }), {
      'admin/src/modules/orders/OrdersList.tsx::admin/src/lib/gone.ts': {
        symbols: ['gone'],
        reason: 'stale',
      },
    });
    expect(result.stale).toHaveLength(1);
  });

  it('refuses an entry naming a symbol the walk no longer sees', () => {
    const result = checkAdminSurface(
      input({ sites: [site({ specifier: '@/components/organization-picker' })] }),
      { [key]: { symbols: ['Button', 'Vanished'], reason: 'stale symbol' } },
    );
    expect(result.stale).toEqual([]);
    expect(result.staleSymbols).toEqual([`${key}: Vanished`]);
  });
});

describe('shimSubpathsOf — what counts as published, derived from the text', () => {
  it('reads a file whose whole body forwards to the kit as a shim', () => {
    expect(
      shimSubpathsOf(
        `export { Button } from '${KIT}/ui';\nexport type { ButtonProps } from '${KIT}/ui';\n`,
        KIT,
      ),
    ).toEqual(new Set(['ui']));
  });

  it('refuses a file that also declares something of its own', () => {
    // The drift this predicate exists for: the admin re-acquires a private
    // component behind a name that used to be published, and every module
    // reaching it becomes a finding in the same run.
    expect(
      shimSubpathsOf(`export { Button } from '${KIT}/ui';\nexport const GAP = 4;\n`, KIT),
    ).toBeNull();
  });

  it('refuses a re-export of something that is not the kit', () => {
    expect(shimSubpathsOf(`export { Button } from './button-impl.js';\n`, KIT)).toBeNull();
  });

  it('refuses an empty file, which forwards nothing at all', () => {
    expect(shimSubpathsOf('', KIT)).toBeNull();
  });
});

describe('barrelSymbolsOf — a barrel that cannot be enumerated is not a barrel', () => {
  it('enumerates the names an explicit barrel publishes, values and types alike', () => {
    expect(
      barrelSymbolsOf(
        "export { Button } from './button.js';\nexport type { ButtonProps } from './button.js';\n",
      ),
    ).toEqual(new Set(['Button', 'ButtonProps']));
  });

  it('refuses an `export *`', () => {
    expect(barrelSymbolsOf("export * from './button.js';\n")).toBeNull();
  });

  it('refuses a namespace re-export and an `export {…}` with no `from`', () => {
    expect(barrelSymbolsOf("export * as ui from './button.js';\n")).toBeNull();
    expect(barrelSymbolsOf('const Button = 1;\nexport { Button };\n')).toBeNull();
  });
});

describe('reachesOf — the shapes the walk has to tell apart', () => {
  const source = [
    "import { Button, type ButtonProps } from '@/components/ui/button';",
    "import Chart from 'echarts';",
    "import * as ui from '@/components/ui/table';",
    "import '@/styles/x.css';",
    "export { Card } from '@/components/ui/card';",
    "const lazy = () => import('@/components/ui/combobox');",
  ].join('\n');

  it('names the symbols of a named import and re-export, and no symbol otherwise', () => {
    const sites = reachesOf(source, 'admin/src/modules/orders/X.tsx', 'orders', false);
    expect(sites.map((s) => s.shape)).toEqual([
      'named',
      'default',
      'namespace',
      'side-effect',
      'named',
      'dynamic',
    ]);
    expect(sites[0]!.symbols).toEqual(['Button', 'ButtonProps']);
    expect(sites[4]!.symbols).toEqual(['Card']);
    expect(sites[2]!.symbols).toEqual([]);
  });
});

describe('bareKitSubpath', () => {
  it('reads a subpath, calls the root `.`, and ignores a foreign package', () => {
    expect(bareKitSubpath(`${KIT}/ui`, KIT)).toEqual({ name: 'ui' });
    expect(bareKitSubpath(KIT, KIT)).toEqual({ name: '.' });
    expect(bareKitSubpath('@endora-commerce/contracts', KIT)).toBeNull();
  });
});

describe('check:admin-surface — the seven vacuous refusals', () => {
  const ok = {
    adminResolved: true,
    kitFound: true,
    implementationSubpaths: 4,
    barrelsRead: 4,
    barrelWithStar: null,
    walkedFiles: 300,
    shims: 53,
  };

  it('reports no reason for a run that read everything', () => {
    expect(vacuousReason(ok)).toBeNull();
  });

  it.each([
    ['no admin layout', { adminResolved: false }],
    ['no kit', { kitFound: false }],
    ['a kit that declares no implementation subpath', { implementationSubpaths: 0 }],
    ['a barrel that could not be read', { barrelsRead: 3 }],
    ['a barrel holding an `export *`', { barrelWithStar: 'ui' }],
    ['a walk that opened no module file', { walkedFiles: 0 }],
    ['a tree with no shim at all', { shims: 0 }],
  ])('refuses %s', (_label, override) => {
    expect(vacuousReason({ ...ok, ...override })).not.toBeNull();
  });
});

describe('the ledger this repository ships', () => {
  it('is not empty, and every key is `<file>::<target>` in one namespace', () => {
    const keys = Object.keys(UNPUBLISHED_ADMIN_REACHES);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const parts = key.split('::');
      expect(parts).toHaveLength(2);
      // One base for both halves. `check:platform-surface` lost 90 reaches to a
      // key whose two halves were relative to different roots.
      expect(parts[0]!.startsWith('admin/') || parts[0]!.startsWith('packages/')).toBe(true);
      expect(parts[1]!.startsWith('admin/') || parts[1]!.startsWith('@')).toBe(true);
    }
  });

  it('names at least one symbol per entry, because the verdict is per symbol', () => {
    for (const [key, entry] of Object.entries(UNPUBLISHED_ADMIN_REACHES)) {
      expect(entry.symbols.length, key).toBeGreaterThan(0);
      expect(entry.reason.length, key).toBeGreaterThan(40);
    }
  });
});
