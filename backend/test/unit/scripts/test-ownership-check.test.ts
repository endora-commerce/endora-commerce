import { describe, expect, it } from 'vitest';

import {
  checkTestOwnership,
  composerCalledBy,
  composesServer,
  declaredEntryType,
  HOST_COMPOSERS,
  mergesBaseConfig,
  outwardReachOf,
  ownersOf,
  ownershipOf,
  parseFailure,
  vacuousTestOwnership,
  CANONICAL_SHARD_ENTRY_TYPE,
  type VacuousInput,
  type VacuousReasonKind,
} from '../../../scripts/check-test-ownership.js';
import {
  findingsOfKind,
  HARNESS_FREE_BLOG_TEST,
  ledgerIssues,
  MODULE_PACKAGE_NAMES,
  ownershipFindings,
  ownershipInput,
  SCHEDULED,
  SERVER_BOUND_BLOG_TEST,
  shard,
} from '../../helpers/test-ownership-fixture.js';
import { vacuousModulePopulation } from '../../../scripts/lib/module-population.js';

/**
 * `check:test-ownership` — feature 106's instrument, and the shapes it refuses.
 *
 * Normative:
 * `specs/106-module-owned-tests/contracts/module-test-ownership.md`, extended by
 * `specs/109-backend-test-kit/contracts/test-kit-package.md` §5.
 *
 * Every fixture enters as **source text and a file map** — never an owner list,
 * never a verdict — so the specifier walk, the call-node predicate and the
 * ownership table all run in every proof. A fixture that entered below any of
 * the three could not catch a defect in it (issue #130), which is the failure
 * the inventory's `enters` field exists to record.
 */
describe('the ownership table (§1)', () => {
  const hosts = new Set<string>();

  it("places a single-owner harness-free file in that module's package", () => {
    expect(ownershipOf({ owners: ['blog'], composesServer: false, serverBoundHosts: hosts })).toEqual(
      { verdict: 'the-module', moduleId: 'blog' },
    );
  });

  it('leaves a file with no owner to the repository — it is the platform\'s own test', () => {
    expect(ownershipOf({ owners: [], composesServer: false, serverBoundHosts: hosts })).toEqual({
      verdict: 'the-repository',
      moduleId: null,
    });
  });

  it('leaves a file with two owners to the repository, and names neither', () => {
    // FR-003: a file with two owners has none. Putting it in either package
    // would make that package's suite depend on the other's.
    expect(
      ownershipOf({ owners: ['blog', 'orders'], composesServer: false, serverBoundHosts: hosts }),
    ).toEqual({ verdict: 'the-repository', moduleId: null });
  });

  it('leaves a server-bound file to the repository while no module can host one', () => {
    expect(ownershipOf({ owners: ['blog'], composesServer: true, serverBoundHosts: hosts })).toEqual(
      { verdict: 'the-repository', moduleId: 'blog' },
    );
  });

  it('gives the same file to the module once that module can host one (109 R5.1)', () => {
    // The one cell `specs/109-backend-test-kit/` moves, driven here so that the
    // feature's Phase 4 changes `serverBoundHosts` and nothing else. A constant
    // folded into the table would make this unprovable.
    expect(
      ownershipOf({
        owners: ['blog'],
        composesServer: true,
        serverBoundHosts: new Set(['blog']),
      }),
    ).toEqual({ verdict: 'the-module', moduleId: 'blog' });
  });

  it('is per module, so a capable module does not carry an incapable one', () => {
    expect(
      ownershipOf({
        owners: ['orders'],
        composesServer: true,
        serverBoundHosts: new Set(['blog']),
      }),
    ).toEqual({ verdict: 'the-repository', moduleId: 'orders' });
  });
});

describe('owners are read out of specifiers, in both spellings the tree writes', () => {
  const key = 'backend/test/unit/blog/x.test.ts';

  it('reads a relative reach into a module package', () => {
    expect(
      ownersOf(
        "import { x } from '../../../../packages/modules/blog/src/backend/cache.js';\n",
        key,
        MODULE_PACKAGE_NAMES,
      ).owners,
    ).toEqual(['blog']);
  });

  it('reads a bare specifier through the layout\'s name map, not a `mod-` rule', () => {
    // D-100: nothing here spells `@endora-commerce/mod-`. A package named
    // differently is followed because the map is the layout's answer.
    expect(
      ownersOf("import { x } from '@endora-commerce/mod-orders/backend';\n", key, MODULE_PACKAGE_NAMES)
        .owners,
    ).toEqual(['orders']);
  });

  it('finds both owners of a file that names two modules', () => {
    expect(
      ownersOf(
        "import { a } from '@endora-commerce/mod-blog/backend';\n" +
          "import { b } from '@endora-commerce/mod-orders/backend';\n",
        key,
        MODULE_PACKAGE_NAMES,
      ).owners,
    ).toEqual(['blog', 'orders']);
  });

  it('is not fooled by a module name in a comment or a string', () => {
    // Specifiers are AST nodes. A text rule would attribute this file to `blog`
    // and move somebody's platform test into a package.
    const source =
      "// see @endora-commerce/mod-blog/backend for the shape\n" +
      "const note = 'packages/modules/blog/src/backend/cache.ts';\n" +
      'export { note };\n';
    expect(ownersOf(source, key, MODULE_PACKAGE_NAMES).owners).toEqual([]);
  });

  it('counts every attribution, which is what the read line reports as `sites`', () => {
    expect(
      ownersOf(
        "import { a } from '@endora-commerce/mod-blog/backend';\n" +
          "import type { B } from '@endora-commerce/mod-blog/ports';\n",
        key,
        MODULE_PACKAGE_NAMES,
      ),
    ).toEqual({ owners: ['blog'], attributions: 2 });
  });
});

describe('`composesServer` is a call node, not a mention', () => {
  const key = 'backend/test/unit/blog/x.test.ts';

  it('sees the call', () => {
    expect(composesServer('await setupBackendServer();\n', key)).toBe(true);
  });

  it('sees it through a namespace or holder', () => {
    expect(composesServer('await harness.setupBackendServer();\n', key)).toBe(true);
  });

  it("sees the kit's composer, which D-252 names and this check never carried", () => {
    // One of D-262 clause 1's two measured disagreements: the extraction script
    // read two names, D-252 states two, and this predicate read one.
    expect(composesServer('const handle = await composeTestServer({});\n', key)).toBe(true);
  });

  it("sees the database fixture — D-262 clause 1's third member", () => {
    // `setupTestDb` awaits `mikroOrmConfig()`, which awaits `configuredEntities()`
    // and `configuredMigrations()`: one call reads two of the three generated
    // per-host artefacts D-252 enumerates, so it is the same species.
    expect(composesServer('const db = await setupTestDb();\n', key)).toBe(true);
  });

  it('names which member it found, so a finding cannot misreport the call', () => {
    expect(composerCalledBy('const db = await setupTestDb();\n', key)).toBe('setupTestDb');
    expect(composerCalledBy('await setupBackendServer();\n', key)).toBe('setupBackendServer');
    expect(composerCalledBy('export {};\n', key)).toBeNull();
  });

  it('does not see a member named in prose or in a string either', () => {
    expect(
      composesServer(
        "// setupTestDb opens the ORM\nconst name = 'composeTestServer';\nexport { name };\n",
        key,
      ),
    ).toBe(false);
  });

  it('does not see the harness naming its own export in prose', () => {
    // `test-server.ts` names `setupBackendServer` a dozen times in comments and
    // in its own type text; a run that counted those would classify the harness
    // as its own caller and, one step on, every file that quotes it.
    expect(
      composesServer(
        "// setupBackendServer boots the platform\nconst name = 'setupBackendServer';\nexport { name };\n",
        key,
      ),
    ).toBe(false);
  });
});

describe('§3 — what a module package\'s test may name', () => {
  const fileKey = 'packages/modules/blog/src/backend/cache.test.ts';
  const reach = (specifier: string, moduleId = 'blog'): string | null =>
    outwardReachOf({ specifier, fileKey, moduleId });

  it('allows the package naming its own sources relatively', () => {
    expect(reach('./cache.js')).toBeNull();
  });

  it('allows a package naming its own `src/backend` through a longer path', () => {
    // The regression that produced the anchor: every module package keeps its
    // sources under `src/backend/`, so a rule matching the `backend` segment
    // anywhere reported all 211 package tests as reaching the application.
    expect(reach('../../backend/services/blog-service.js')).toBeNull();
  });

  it('allows the published contracts and platform surface', () => {
    expect(reach('@endora-commerce/contracts')).toBeNull();
    expect(reach('@endora-commerce/platform/http')).toBeNull();
  });

  it('allows a sibling module by bare specifier', () => {
    expect(reach('@endora-commerce/mod-orders/backend')).toBeNull();
  });

  it('allows a package naming its own `src/admin` through a longer path', () => {
    // The same anchor the `backend` row needs, on the root D-262 clause 3 adds:
    // every module package keeps its screens under `src/admin/`, so a rule
    // matching the segment anywhere would report each of those as reaching the
    // application.
    expect(reach('../../admin/pages/BlogListPage.js')).toBeNull();
  });

  it('refuses a reach into the application', () => {
    expect(reach('../../../../../backend/test/helpers/test-server.js')).toMatch(
      /testable without the application/,
    );
  });

  it('refuses a reach into the admin application (D-262 clause 3)', () => {
    // The route by which a module's rendered admin case would be "moved into the
    // package" while still depending on an unpublished React harness: it
    // resolves in this checkout and in no other, and it passed until now.
    expect(reach('../../../../../admin/test/helpers/render-with-i18n.js')).toMatch(
      /testable without the application/,
    );
  });

  it('refuses a reach into the storefront application (D-262 clause 3)', () => {
    expect(reach('../../../../../storefront/test/helpers/render.js')).toMatch(
      /testable without the application/,
    );
  });

  it('refuses a sibling named by relative path', () => {
    expect(reach('../../../orders/src/backend/index.js')).toMatch(/sibling package `orders`/);
  });

  it('refuses a reach into any build output', () => {
    expect(reach('../../../orders/dist/backend/index.js')).toMatch(/build output/);
    expect(reach('@endora-commerce/mod-orders/dist/backend/index.js')).toMatch(/build output/);
  });
});

describe('the five findings, one red proof each', () => {
  it('misplaced-test — a single-owner harness-free file under `backend/test`', () => {
    expect(
      findingsOfKind(
        { application: { 'backend/test/unit/blog/cache.test.ts': HARNESS_FREE_BLOG_TEST } },
        'misplaced-test',
      ),
    ).toBe(1);
  });

  it('harness-bound-move — a package test composing a server it may not name', () => {
    expect(
      findingsOfKind(
        { packages: { 'packages/modules/blog/src/backend/boot.test.ts': SERVER_BOUND_BLOG_TEST } },
        'harness-bound-move',
      ),
    ).toBe(1);
  });

  it('unconfigured-package-tests — test files with no `test` script', () => {
    expect(
      findingsOfKind(
        {
          packages: { 'packages/modules/blog/src/backend/cache.test.ts': "export {};\n" },
          manifests: { blog: { testScript: null } },
        },
        'unconfigured-package-tests',
      ),
    ).toBe(1);
  });

  it('unconfigured-package-tests — a config that does not merge the workspace base', () => {
    // Issue #255's refusal lives in the base, so a package that skips it can run
    // another checkout's sources while reporting on this branch. Reported under
    // the same kind because it is the same defect: the tests are not configured.
    expect(
      findingsOfKind(
        {
          packages: { 'packages/modules/blog/src/backend/cache.test.ts': "export {};\n" },
          manifests: {
            blog: { vitestConfig: "import { defineConfig } from 'vitest/config';\nexport default defineConfig({});\n" },
          },
        },
        'unconfigured-package-tests',
      ),
    ).toBe(1);
  });

  it('outward-reach — a package test naming the application', () => {
    expect(
      findingsOfKind(
        {
          packages: {
            'packages/modules/blog/src/backend/cache.test.ts':
              "import { helper } from '../../../../../backend/test/helpers/fixtures.js';\nexport { helper };\n",
          },
        },
        'outward-reach',
      ),
    ).toBe(1);
  });

  it('outward-reach — a package test naming the *admin* application', () => {
    // Driven through the check and not only through `outwardReachOf`, because
    // this is the shape W2.2 forbids and the one that reached the package by
    // passing: a rendered admin case relocated with its harness left behind.
    expect(
      findingsOfKind(
        {
          packages: {
            'packages/modules/blog/src/admin/surface.test.ts':
              "import { renderWithI18n } from '../../../../../admin/test/helpers/render-with-i18n.js';\nexport { renderWithI18n };\n",
          },
        },
        'outward-reach',
      ),
    ).toBe(1);
  });

  it('unclassifiable-test — a file the analysis could not read', () => {
    // A finding and never a skip (issue #113): reading an unreadable file as the
    // repository's agrees with the defect, because the repository is where an
    // unmoved file already is.
    expect(
      findingsOfKind(
        { application: { 'backend/test/unit/blog/broken.test.ts': 'const x = {{{ ;\n' } },
        'unclassifiable-test',
      ),
    ).toBe(1);
  });

  it('reads an unparseable file as unclassifiable rather than as owning nothing', () => {
    expect(parseFailure('const x = {{{ ;\n', 'x.test.ts')).not.toBeNull();
    expect(parseFailure('export {};\n', 'x.test.ts')).toBeNull();
  });
});

describe('a correct tree produces nothing', () => {
  it('is silent over a ledgered misplaced file, a configured package and a clean reach', () => {
    const result = checkTestOwnership(
      ownershipInput({
        application: { 'backend/test/unit/blog/cache.test.ts': HARNESS_FREE_BLOG_TEST },
        packages: {
          'packages/modules/blog/src/backend/cache.test.ts':
            "import { BlogCache } from './cache.js';\nexport { BlogCache };\n",
        },
        ledger: [shard('blog', { 'backend/test/unit/blog/cache.test.ts': SCHEDULED })],
      }),
    );
    expect(result.findings).toEqual([]);
    expect(result.ledgerIssues).toEqual([]);
    expect(result.scheduled).toBe(1);
    expect(result.retained).toBe(0);
  });

  it('counts a retained entry apart from a scheduled one, which is what makes the drain a number', () => {
    const result = checkTestOwnership(
      ownershipInput({
        application: { 'backend/test/unit/blog/cache.test.ts': HARNESS_FREE_BLOG_TEST },
        modules: ['blog'],
        ledger: [
          shard('blog', {
            'backend/test/unit/blog/cache.test.ts':
              'It stays: it asserts the platform composes this module, which is not a claim the package can make about itself.',
          }),
        ],
      }),
    );
    expect(result.findings).toEqual([]);
    expect(result.scheduled).toBe(0);
    expect(result.retained).toBe(1);
  });
});

describe('the ledger fails in seven ways (§4)', () => {
  const misplaced = { 'backend/test/unit/blog/cache.test.ts': HARNESS_FREE_BLOG_TEST };

  it('an unledgered finding — reported as `misplaced-test`, not as a ledger defect', () => {
    expect(ownershipFindings({ application: misplaced })).toHaveLength(1);
  });

  it('a stale entry describing no file the walk found', () => {
    expect(
      ledgerIssues({
        application: misplaced,
        modules: ['blog'],
        ledger: [
          shard('blog', {
            'backend/test/unit/blog/cache.test.ts': SCHEDULED,
            'backend/test/unit/blog/gone.test.ts': SCHEDULED,
          }),
        ],
      }).filter((issue) => issue.includes('gone.test.ts')),
    ).toHaveLength(1);
  });

  it('an empty shard', () => {
    expect(
      ledgerIssues({ application: misplaced, modules: ['blog'], ledger: [shard('blog', {})] }).filter((issue) =>
        issue.includes('the shard is empty'),
      ),
    ).toHaveLength(1);
  });

  it('an orphan shard naming no module package', () => {
    expect(
      ledgerIssues({
        application: misplaced,
        modules: ['blog'],
        ledger: [
          shard('blog', { 'backend/test/unit/blog/cache.test.ts': SCHEDULED }),
          shard('no_such_module', { 'backend/test/unit/blog/cache.test.ts': SCHEDULED }),
        ],
      }).filter((issue) => issue.includes('no module package of that id')),
    ).toHaveLength(1);
  });

  it("an entry filed under another module's shard", () => {
    expect(
      ledgerIssues({
        application: misplaced,
        modules: ['orders'],
        ledger: [shard('orders', { 'backend/test/unit/blog/cache.test.ts': SCHEDULED })],
      }).filter((issue) => issue.includes("is `blog`'s file")),
    ).toHaveLength(1);
  });

  it('an entry with no reason', () => {
    expect(
      ledgerIssues({
        application: misplaced,
        modules: ['blog'],
        ledger: [shard('blog', { 'backend/test/unit/blog/cache.test.ts': '   ' })],
      }).filter((issue) => issue.includes('carries no reason')),
    ).toHaveLength(1);
  });

  it('a scheduled entry naming no batch — `retiredBy` is what makes it a drain', () => {
    expect(
      ledgerIssues({
        application: misplaced,
        modules: ['blog'],
        ledger: [
          shard('blog', {
            'backend/test/unit/blog/cache.test.ts': {
              scheduled: true,
              reason: 'it has not moved',
              retiredBy: '',
            },
          }),
        ],
      }).filter((issue) => issue.includes('names no batch')),
    ).toHaveLength(1);
  });

  it('a shard declaring an entry type that makes a field unusable (issue #217)', () => {
    // `payments` declared `Readonly<Record<string, string>>` in
    // `check:module-boundary`'s ledger, so the richer entry was a type error in
    // it and the rule that runs on that field never ran over that shard at all.
    expect(
      ledgerIssues({
        application: misplaced,
        modules: ['blog'],
        ledger: [
          shard(
            'blog',
            { 'backend/test/unit/blog/cache.test.ts': SCHEDULED },
            'export const entries: Readonly<Record<string, string>> = {};\n',
          ),
        ],
      }).filter((issue) => issue.includes('issue #217')),
    ).toHaveLength(1);
  });

  it('reads the declared entry type out of the shard\'s own source', () => {
    expect(
      declaredEntryType(
        'export const entries: Readonly<Record<string, TestOwnershipLedgerEntry>> = {};',
      ),
    ).toBe(CANONICAL_SHARD_ENTRY_TYPE);
    expect(declaredEntryType('export const entries = {};')).toBeNull();
  });
});

describe('exit 2 — the run could not see (§7)', () => {
  const declaring = (name: string): string =>
    `export async function ${name}(): Promise<void> {}\n`;
  const sound: VacuousInput = {
    applicationFiles: 1428,
    packageFiles: 211,
    attributions: 1090,
    packagesDeclaringTests: 56,
    ledgerDirectoryExists: true,
    composerSources: Object.fromEntries(
      HOST_COMPOSERS.map((composer) => [composer.name, declaring(composer.name)]),
    ),
  };

  const refusalOf = (over: Partial<VacuousInput>): VacuousReasonKind | null =>
    vacuousTestOwnership({ ...sound, ...over })?.kind ?? null;

  it('reports nothing over a sound record', () => {
    expect(refusalOf({})).toBeNull();
  });

  it('refuses a run that opened no application test file', () => {
    expect(refusalOf({ applicationFiles: 0 })).toBe('no-application-test-file');
  });

  it('refuses a run that opened no package test file', () => {
    // The union's second addend, floored separately: 1428 of the 1639 files are
    // the application's, so a package walk that went to zero leaves `files=`
    // looking healthy while three of the five findings have no population.
    expect(refusalOf({ packageFiles: 0 })).toBe('no-package-test-file');
  });

  it('refuses a run that resolved no owner at all (issue #237)', () => {
    expect(refusalOf({ attributions: 0 })).toBe('no-owner-attribution');
  });

  it('refuses a run whose independent author has no subject', () => {
    expect(refusalOf({ packagesDeclaringTests: 0 })).toBe('no-package-test-script');
  });

  it('refuses a missing ledger directory and accepts an empty one', () => {
    expect(refusalOf({ ledgerDirectoryExists: false })).toBe('missing-ledger-directory');
    // An empty ledger is a clean tree — the state this sweep is draining
    // towards — and must not be confused with a baseline the run cannot read.
    expect(refusalOf({})).toBeNull();
  });

  const withComposer = (name: string, source: string | null): Partial<VacuousInput> => ({
    composerSources: { ...sound.composerSources, [name]: source },
  });

  it('refuses a harness that is not at its exact path', () => {
    expect(refusalOf(withComposer('setupBackendServer', null))).toBe('harness-not-found');
  });

  it('refuses a harness that no longer exports the composer', () => {
    // The predicate's subject. Reclassifying every server-bound file in the tree
    // because a symbol was renamed is the one answer this must never give.
    expect(
      refusalOf(
        withComposer('setupBackendServer', 'export async function bootServer() {}\n'),
      ),
    ).toBe('harness-not-found');
  });

  it('refuses on **every** member, not only the first (D-262 clause 1)', () => {
    // §1: "§7 case 6's refusal applies to every member". A second member that
    // could go missing silently would reclassify its own population at once —
    // the 51 files this clause drains from the ledger, for `setupTestDb`.
    for (const composer of HOST_COMPOSERS) {
      expect(refusalOf(withComposer(composer.name, null))).toBe('harness-not-found');
      expect(
        refusalOf(withComposer(composer.name, 'export async function renamed() {}\n')),
      ).toBe('harness-not-found');
    }
    expect(HOST_COMPOSERS).toHaveLength(3);
  });

  it('names the declaring file each member is read from', () => {
    // The mapping is per member and not per harness: two members are declared in
    // `backend/test/helpers/test-server.ts`'s neighbourhood and the third is the
    // database fixture, so one path could not be the subject of all three.
    expect(HOST_COMPOSERS.map((composer) => composer.declaredIn)).toEqual([
      'backend/test/helpers/test-server.ts',
      'packages/test-kit/src/server/compose-test-server.ts',
      'backend/test/helpers/test-db.ts',
    ]);
  });
});

describe('a package\'s vitest configuration', () => {
  it('recognises the workspace base however the specifier is spelled', () => {
    expect(
      mergesBaseConfig("import baseConfig from '../../../vitest.config.base.js';\n", 'c.ts'),
    ).toBe(true);
  });

  it('does not recognise a configuration that merges nothing', () => {
    expect(mergesBaseConfig("import { defineConfig } from 'vitest/config';\n", 'c.ts')).toBe(false);
  });

  it('asks nothing of a package that ships no test file', () => {
    // The conditional shape `check:bundle-pairing` uses: a universal obligation
    // would be satisfied by two dozen files whose only effect is to make a check
    // pass. 14 of the 70 module packages ship no test, correctly.
    expect(
      findingsOfKind(
        { manifests: { blog: { testScript: null, vitestConfig: null } } },
        'unconfigured-package-tests',
      ),
    ).toBe(0);
  });
});

describe('§7 case 2 — the module floor, whose unit is the directory', () => {
  // Proven here rather than in `moved-module-tree.test.ts`, and the inventory
  // entry says why: those fixture backends carry no `backend/test`, which is
  // this check's *first* vacuous condition, and giving them one reds
  // `check-singleton-identity` for the fixture's shape. So the discrimination is
  // driven directly, over the inputs the host hands the shared floor.
  const directoryOf = (moduleId: string): string => `/repo/packages/modules/${moduleId}`;
  const moduleIdOf = (path: string): string | null =>
    /packages\/modules\/([^/]+)$/.exec(path)?.[1] ?? null;

  it('is silent when every registered module has a directory on disk', () => {
    // The unit is the module's own directory and **not** a test file, because 14
    // of the 70 packages ship no test at all: a floor over test files would
    // refuse every clean run rather than a moved tree.
    expect(
      vacuousModulePopulation({
        registered: ['blog', 'orders'],
        files: [directoryOf('blog'), directoryOf('orders')],
        moduleIdOf,
      }),
    ).toBeNull();
  });

  it('refuses a tree where a registered module has no directory', () => {
    expect(
      vacuousModulePopulation({
        registered: ['blog', 'orders'],
        files: [directoryOf('blog')],
        moduleIdOf,
      }),
    ).toMatch(/produced none for/);
  });
});
