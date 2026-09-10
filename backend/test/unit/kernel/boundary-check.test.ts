import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeClosure,
  analyzePlatformImports,
  analyzeSource,
  bareModuleOwnerOf,
  collectSources,
  RELATION_DECORATOR_HINT,
  importFindingKey,
  isDraining,
  isImportViolation,
  isPending,
  isViolation,
  ownerOf,
  platformRootOf,
  stalePending,
  staleDraining,
  platformRootsOf,
  KERNEL_MODULE_IMPORTS_TO_DRAIN,
  PENDING_RELOCATION,
  type PlatformScope,
} from '../../../scripts/check-kernel-boundary.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';
import { platformSubpathsAt } from '../../../scripts/lib/platform-root.js';
import { inTreeRelationTarget } from '../../helpers/in-tree-relation-target.js';

/** Every root the check itself walks — resolved, never spelled (T040a). */
const MODULE_LAYOUT = await requireModuleLayout('[kernel-boundary-check]');

/**
 * The kernel boundary rule (feature 072, T021) is satisfied by construction now
 * that T018/T019 have landed: every remaining cross-owner ORM relation points
 * into the kernel. So the check's own test has to prove it can go **red**, not
 * merely that it agrees with the current tree.
 *
 * `analyzeSource` resolves a relation target through the import that declares
 * it, and skips a specifier that does not resolve to a file on disk — so these
 * fixtures must name entities that really exist.
 */

const ENTITY = (relation: string, imports: string): string => `
${imports}
@Entity()
export class Thing {
  ${relation}
  other!: unknown;
}
`;

describe('ownerOf', () => {
  it('reads the module id out of the path', () => {
    expect(ownerOf('/repo/backend/src/modules/search/entities/x.entity.ts')).toBe('search');
  });

  it('calls the kernel the kernel', () => {
    expect(ownerOf('/repo/backend/src/kernel/audit/x.entity.ts')).toBe('kernel');
  });

  it('calls pre-split core entities core', () => {
    expect(ownerOf('/repo/backend/src/db/entities/x.entity.ts')).toBe('core');
  });
});

describe('isViolation', () => {
  const finding = (sourceOwner: string, targetOwner: string) => ({
    file: 'x',
    className: 'Thing',
    property: 'other',
    decorator: 'ManyToOne',
    targetName: 'Other',
    sourceOwner,
    targetOwner,
  });

  it('allows a relation inside one module', () => {
    expect(isViolation(finding('orders', 'orders'))).toBe(false);
  });

  it('allows a module to relate into the kernel', () => {
    expect(isViolation(finding('search', 'kernel'))).toBe(false);
  });

  it('forbids a module relating into another module', () => {
    expect(isViolation(finding('search', 'sales_channels'))).toBe(true);
  });

  it('forbids the kernel relating into a module', () => {
    expect(isViolation(finding('kernel', 'catalog'))).toBe(true);
  });
});


/**
 * Derived, never written out. `analyzeSource` reads the owning module out of the
 * path and resolves the relation target as a file on disk, so a literal path
 * only works on the machine it was typed on: in CI the checkout lives under
 * `/builds/…`, every lookup missed, and three cases failed with "expected [] to
 * have a length of 1" — green locally, red in the pipeline.
 */
const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const moduleFile = (relative: string): string => join(BACKEND_ROOT, 'src/modules', relative);

/**
 * A cross-module relation target that really exists — derived, never named, and
 * shared with `check-inventory`'s rule-A red proof so the two cannot disagree.
 * See `test/helpers/in-tree-relation-target.ts` for why it is not a literal.
 */
const RELATION_TARGET = inTreeRelationTarget();
const RELATION_TARGET_IMPORT =
  `import { ${RELATION_TARGET.name} } from '${RELATION_TARGET.specifier}';`;
/**
 * The importing file for a proof that names {@link RELATION_TARGET_IMPORT}.
 *
 * It has to sit in the **fixture** tree rather than under `backend/src/modules`,
 * because the specifier above is relative and rule A resolves it against the
 * importing file. `moduleFile` stays for the proofs whose target is a real
 * platform file — the kernel's `SalesChannel` — which is where a path under the
 * application tree is still the right one.
 */
const relationFixtureFile = RELATION_TARGET.sourceFile;

describe('analyzeSource', () => {
  it('finds the relation target through the import that declares it', () => {
    const findings = analyzeSource(
      ENTITY(
        `@ManyToOne(() => ${RELATION_TARGET.name}, { fieldName: "target_id" })`,
        RELATION_TARGET_IMPORT,
      ),
      relationFixtureFile('search/entities/search-phrase-record.entity.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceOwner: 'search',
      targetOwner: RELATION_TARGET.module,
      decorator: 'ManyToOne',
      targetName: RELATION_TARGET.name,
    });
    expect(isViolation(findings[0]!)).toBe(true);
  });

  it('ignores a plain @Property — an FK column is not an ORM relation', () => {
    const findings = analyzeSource(
      ENTITY('@Property({ type: "uuid" })', RELATION_TARGET_IMPORT),
      relationFixtureFile('search/entities/x.entity.ts'),
    );
    expect(findings).toEqual([]);
  });

  it('reads the entity out of the object form too', () => {
    const findings = analyzeSource(
      ENTITY(
        `@ManyToMany({ entity: () => ${RELATION_TARGET.name}, pivotTable: "setting_targets" })`,
        RELATION_TARGET_IMPORT,
      ),
      relationFixtureFile('settings/entities/setting.entity.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe(RELATION_TARGET.module);
  });

  it('allows the relocated settings → SalesChannel relations, now kernel-internal', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToOne(() => SalesChannel, { fieldName: "sales_channel_id" })',
        "import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';",
      ),
      moduleFile('search/entities/search-phrase-record.entity.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('kernel');
    expect(isViolation(findings[0]!)).toBe(false);
  });
});

/**
 * What rule A looks at (issue #113). The rule was scoped to `*.entity.ts`,
 * which is a filename convention nothing enforces: a relation declared in an
 * `entities/index.ts` or in an ordinary service file was not permitted, it was
 * unread — and an unread file and a clean one produce the same green line.
 */
describe('rule A — the scan scope', () => {
  // Every root the check itself walks, not `backend/src` alone. Measured on the
  // batch-three tree: **zero** relation decorators are left under `backend/src`
  // — every ORM relation in this repository now sits in a module package — so a
  // population rooted at the application tree makes this file's recall
  // assertion vacuous, which is issue #215 inside the test that exists to
  // refuse it.
  const relationSources = (): string[] =>
    MODULE_LAYOUT.sourceRoots.flatMap((root) => collectSources(root));

  it('collects sources that are not named *.entity.ts', () => {
    const files = relationSources();
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith('/backend.ts'))).toBe(true);
    expect(files.every((f) => !f.endsWith('.test.ts'))).toBe(true);
  });

  it('flags a cross-module relation declared in a file with no entity suffix', () => {
    const findings = analyzeSource(
      ENTITY(
        `@OneToMany(() => ${RELATION_TARGET.name}, (c) => c.thing)`,
        RELATION_TARGET_IMPORT,
      ),
      relationFixtureFile('search/entities/index.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(isViolation(findings[0]!)).toBe(true);
  });

  it('the pre-filter admits every relation decorator and nothing else', () => {
    for (const decorator of ['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany']) {
      expect(RELATION_DECORATOR_HINT.test(`  @${decorator}(() => X)`), decorator).toBe(true);
    }
    expect(RELATION_DECORATOR_HINT.test('@Property({ type: "uuid" })')).toBe(false);
    expect(RELATION_DECORATOR_HINT.test('@Entity()')).toBe(false);
  });

  it('every relation in the tree sits in a file the pre-filter keeps', () => {
    // The filter is the scan scope now, so its recall is the rule's reach.
    const kept = relationSources().filter((f) =>
      RELATION_DECORATOR_HINT.test(readFileSync(f, 'utf8')),
    );
    expect(kept.length).toBeGreaterThan(0);
    const missed = relationSources().filter(
      (f) => !kept.includes(f) && /@(?:ManyToOne|OneToMany|OneToOne|ManyToMany)/.test(readFileSync(f, 'utf8')),
    );
    expect(missed).toEqual([]);
  });
});

describe('the pending-relocation ratchet', () => {
  it('is empty — T018 and T019 dissolved every entry it carried', () => {
    // The completion signal for D-32: the four SalesChannel relations became
    // module→kernel (search) or kernel-internal (settings), so nothing is
    // pending. A non-empty list here is a debt marker, never an exemption.
    expect(PENDING_RELOCATION).toEqual([]);
  });

  it('does not cover a new cross-module relation', () => {
    expect(
      isPending({
        file: 'x',
        className: 'Invoice',
        property: 'order',
        decorator: 'ManyToOne',
        targetName: 'Order',
        sourceOwner: 'invoices',
        targetOwner: 'orders',
      }),
    ).toBe(false);
  });

  it('reports nothing stale while the list is empty', () => {
    expect(stalePending([])).toEqual([]);
  });
});

/**
 * The import rule (D-37, widened by D-53). The relation rule above polices
 * foreign keys; this one polices specifiers, which is the mechanism the kernel
 * actually reached into `src/modules/` through. As with the relation rule the
 * fixtures are synthetic, so the check has to be able to go **red** on shapes
 * the tree does not contain yet — every specifier form of the plan's §4.2 table.
 */
/**
 * The platform root the fixtures are written against.
 *
 * Rules B and C read the platform's own sources, which since the relocation are
 * `@endora-commerce/platform`'s and not `backend/src`'s — and the root is passed
 * in rather than matched by name, because a `/src/<root>/` substring test now
 * matches two trees: the platform's, and the re-export shims left at the old
 * paths. These fixtures name the real one so that the resolution they exercise
 * is the resolution a run performs.
 */
const PLATFORM_ROOT = MODULE_LAYOUT.platformRoot;
if (PLATFORM_ROOT === null) {
  throw new Error('no workspace member declares `endora.type: "platform"` — rules B and C have no subject');
}
const kernelFile = (relative: string): string => join(PLATFORM_ROOT, 'kernel', relative);
const srcFile = (relative: string): string => join(PLATFORM_ROOT, relative);

/**
 * The population rule B judges, derived exactly as a run derives it (T118a).
 *
 * The proofs below hand this scope in with their source text, so a directory
 * that drops out of {@link platformRootsOf} reds that directory's proof instead
 * of passing quietly — which is the whole reason the fixture is source text plus
 * the real derivation rather than a fabricated root list.
 */
const PLATFORM_ROOTS = platformRootsOf(PLATFORM_ROOT);
const SCOPE: PlatformScope = {
  root: PLATFORM_ROOT,
  roots: PLATFORM_ROOTS,
  modulePackageNames: MODULE_LAYOUT.modulePackageNames,
};

/** The npm name a module publishes under, by id — derived, never spelled. */
const packageNameOf = (moduleId: string): string => {
  const entry = [...MODULE_LAYOUT.modulePackageNames].find(([, id]) => id === moduleId);
  if (entry === undefined) throw new Error(`no module package declares id '${moduleId}'`);
  return entry[0];
};

describe('analyzePlatformImports', () => {
  it('finds a value import into a module and names its bindings', () => {
    const findings = analyzePlatformImports(
      "import { ModuleDisabledError } from '../../modules/_lifecycle/plugin-helpers.js';",
      kernelFile('ports/provide.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      targetOwner: '_lifecycle',
      bindings: ['ModuleDisabledError'],
      kind: 'import',
      line: 1,
    });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a type-only import — it does not erase from a package.json', () => {
    const findings = analyzePlatformImports(
      "import type { Organization } from '../../modules/organizations/entities/organization.entity.js';",
      kernelFile('ports/organizations.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('organizations');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses the inline `import(…).Type` annotation ESLint encourages', () => {
    const findings = analyzePlatformImports(
      'export type Org = import("../../modules/organizations/entities/organization.entity.js").Organization;',
      kernelFile('ports/organizations.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'organizations', kind: 'import-type' });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a re-export — an import with a wider blast radius', () => {
    const findings = analyzePlatformImports(
      "export { Category } from '../modules/catalog/entities/category.entity.js';",
      kernelFile('index.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'export' });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a dynamic import', () => {
    const findings = analyzePlatformImports(
      "const m = await import('../modules/catalog/backend.js');",
      kernelFile('compose.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'dynamic' });
  });

  it('refuses a require()', () => {
    const findings = analyzePlatformImports(
      "const m = require('../modules/catalog/backend.js');",
      kernelFile('compose.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'require' });
  });

  it('refuses a deployment overlay module', () => {
    const findings = analyzePlatformImports(
      "import { thing } from '../apps/example/modules/example_overlay/service.js';",
      kernelFile('compose.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('example_overlay');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a per-deployment file — a kernel that differs per deployment is not a kernel', () => {
    // The fixture named `apps/example/decorations/catalog-service.js` until the
    // file seam was retired. What the rule refuses is a platform root reaching
    // *any* file a deployment owns, so the fixture names one that exists: the
    // attribution is to `apps/<deployment>`, not to the directory below it.
    const findings = analyzePlatformImports(
      "import { divergence } from '../apps/example/divergence.js';",
      kernelFile('compose.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('apps/example');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('allows the kernel to import a peer of the kernel', () => {
    const findings = analyzePlatformImports(
      "import { scopedEm } from '../tenancy/scoped-em.js';",
      kernelFile('container.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBeNull();
    expect(isImportViolation(findings[0]!)).toBe(false);
  });

  it('ignores a kernel-internal import and a package specifier', () => {
    const findings = analyzePlatformImports(
      ["import { asFunction } from 'awilix';", "import { x } from './container.js';"].join('\n'),
      kernelFile('ports/provide.ts'),
      SCOPE,
    );
    expect(findings).toEqual([]);
  });

  it('says nothing about a module importing the kernel — that direction is allowed', () => {
    const findings = analyzePlatformImports(
      "import { registerPort } from '../../kernel/ports/provide.js';",
      join(BACKEND_ROOT, 'src/modules/catalog/backend.ts'),
      SCOPE,
    );
    expect(findings).toEqual([]);
  });

  it('does not gate on the target existing on disk', () => {
    const findings = analyzePlatformImports(
      "import { gone } from '../modules/catalog/services/deleted-yesterday.js';",
      kernelFile('compose.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(isImportViolation(findings[0]!)).toBe(true);
  });
});

/**
 * Rule B widened to the platform roots (D-53), and widened again to **every**
 * directory the platform keeps (`specs/110-instance-repository/` T118a).
 *
 * D-52 put the three peers on the list because the kernel cannot compile without
 * them — five kernel entities take `@GlobalEntity()` from `src/tenancy` and four
 * kernel files take `HttpError` from `src/http` as a value — so a peer that may
 * import a module is a kernel that imports modules with one extra hop. That
 * argument counted hops between source directories that might become different
 * packages. They did not: all fourteen compile into one artefact behind one
 * dependency list, so the hop is zero and the answer is the package.
 */
describe('analyzePlatformImports over the platform roots', () => {
  it('walks every directory the platform keeps, and derives them from the platform', () => {
    // Not an expected list: the assertion is that the roots *are* the platform's
    // directories, which is what makes the eleventh one judged by existing. A
    // literal here would be the four-element constant this replaced, one
    // population larger (D-100).
    expect([...PLATFORM_ROOTS]).toEqual(
      readdirSync(PLATFORM_ROOT, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    );
    // The four the rule started with are still in it, which is the half a
    // derivation could silently lose.
    expect(PLATFORM_ROOTS).toEqual(expect.arrayContaining(['kernel', 'http', 'events', 'tenancy']));
  });

  it('names the root a file belongs to, and nothing outside them', () => {
    expect(platformRootOf(kernelFile('compose.ts'), SCOPE)).toBe('kernel');
    expect(platformRootOf(srcFile('http/error-envelope.ts'), SCOPE)).toBe('http');
    expect(platformRootOf(srcFile('events/bus.ts'), SCOPE)).toBe('events');
    expect(platformRootOf(srcFile('tenancy/scoped-em.ts'), SCOPE)).toBe('tenancy');
    // `db` is a root since T118a — the four-element literal is what answered
    // `null` here, and that answer was the hole.
    expect(platformRootOf(srcFile('db/orm-bootstrap.ts'), SCOPE)).toBe('db');
    expect(platformRootOf(srcFile('composition/index.ts'), SCOPE)).toBe('composition');
    // Outside the platform entirely: the application's own tree and a module's.
    expect(platformRootOf(join(BACKEND_ROOT, 'src/composition.ts'), SCOPE)).toBeNull();
    expect(platformRootOf(moduleFile('catalog/backend.ts'), SCOPE)).toBeNull();
  });

  it('refuses the one hop that made the kernel rule cosmetic — a peer naming a module', () => {
    const findings = analyzePlatformImports(
      "import { ERROR_TRANSLATION_KEYS } from '../modules/_i18n/services/error-translation.js';",
      srcFile('http/error-envelope.ts'),
      SCOPE,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: '_i18n', kind: 'import', line: 1 });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses it from tenancy and from events too', () => {
    const fromTenancy = analyzePlatformImports(
      "import type { Organization } from '../modules/organizations/entities/organization.entity.js';",
      srcFile('tenancy/org-scoped.decorator.ts'),
      SCOPE,
    );
    expect(fromTenancy).toHaveLength(1);
    expect(fromTenancy[0]?.targetOwner).toBe('organizations');

    const fromEvents = analyzePlatformImports(
      "const m = await import('../modules/catalog/backend.js');",
      srcFile('events/bus.ts'),
      SCOPE,
    );
    expect(fromEvents).toHaveLength(1);
    expect(fromEvents[0]).toMatchObject({ targetOwner: 'catalog', kind: 'dynamic' });
  });

  it('allows a peer to import the kernel, and ignores its own root', () => {
    const outward = analyzePlatformImports(
      "import { HttpError } from '../kernel/index.js';",
      srcFile('http/server.ts'),
      SCOPE,
    );
    expect(outward).toHaveLength(1);
    expect(outward[0]?.targetOwner).toBeNull();
    expect(isImportViolation(outward[0]!)).toBe(false);

    expect(
      analyzePlatformImports(
        "import { HttpError } from './error-envelope.js';",
        srcFile('http/server.ts'),
        SCOPE,
      ),
    ).toEqual([]);
  });

  it('keys a peer violation on the file that wrote it', () => {
    const [finding] = analyzePlatformImports(
      "import { ERROR_TRANSLATION_KEYS } from '../modules/_i18n/services/error-translation.js';",
      srcFile('http/error-envelope.ts'),
      SCOPE,
    );
    expect(importFindingKey(finding!)).toBe(
      'packages/platform/src/http/error-envelope.ts:../modules/_i18n/services/error-translation.js -> _i18n',
    );
  });

  it('refuses src/db, src/commands and src/overlay — D-57 left them open and F4 closed it', () => {
    // The inverse of the assertion that stood here, and each carve-out's own
    // premise is what retired it. `src/db` was excluded because it "imports
    // every module by construction": `packages/platform/src/db/` imports none,
    // the two generated registries having stayed in `backend/src` when T116
    // moved the ORM configuration, the ordering and the bootstrap. `src/overlay`
    // was excluded as "per-deployment resolution": T114/T114a made the overlay
    // root and the id claims parameters, so it derives no deployment path. And
    // D-57 left `src/commands` open in as many words — "a real open item F4 must
    // close".
    for (const file of [
      srcFile('db/orm-bootstrap.ts'),
      srcFile('commands/command-bus.ts'),
      srcFile('overlay/overlay-runtime.ts'),
    ]) {
      const findings = analyzePlatformImports(
        "import { Category } from '../modules/catalog/entities/category.entity.js';",
        file,
        SCOPE,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.targetOwner).toBe('catalog');
      expect(isImportViolation(findings[0]!)).toBe(true);
    }
  });

  /**
   * One red proof per platform directory, over the **derived** roots.
   *
   * `describe.each` rather than fourteen written-out cases: the population is
   * the derivation's, so the directory that arrives next brings its own proof
   * and no list here goes stale (D-100). Ten of these — `cli`, `commands`,
   * `composition`, `db`, `demo`, `env`, `lifecycle`, `migrations`, `overlay`,
   * `packages` — were outside the rule entirely until T118a, `composition/`
   * being the one T118 puts `composeApp` in.
   *
   * **A derivation that narrows makes these proofs *disappear* rather than go
   * red**, which is why the completeness assertion above them is load-bearing
   * rather than decorative: it is what fails when `platformRootsOf` stops
   * listing the platform, and a vanished test asserts nothing. Measured, with
   * the four-element literal restored: 84 tests become 64, eight of them red,
   * and twenty simply gone.
   */
  describe.each(PLATFORM_ROOTS)('the %s directory', (root) => {
    it('refuses a relative reach into a module', () => {
      const findings = analyzePlatformImports(
        "import { blogService } from '../modules/blog/services/blog.service.js';",
        srcFile(`${root}/reach.ts`),
        SCOPE,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ targetOwner: 'blog', kind: 'import' });
      expect(isImportViolation(findings[0]!)).toBe(true);
    });

    it('refuses a module package by its bare name', () => {
      const findings = analyzePlatformImports(
        `import { registerModule } from '${packageNameOf('blog')}/backend';`,
        srcFile(`${root}/reach.ts`),
        SCOPE,
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ targetOwner: 'blog', kind: 'import' });
      expect(isImportViolation(findings[0]!)).toBe(true);
    });
  });
});

/**
 * The bare half of rule B's predicate (T118a).
 *
 * The paragraph it replaced said there was no `@endora-commerce/mod-*` package
 * yet and that F4 would need a predicate over package names. F4 is closed,
 * `backend/src/modules/` holds nothing but a `README.md`, and the bare name is
 * therefore the **only** spelling by which a platform file can reach a module —
 * so a widened population judged by a relative-only predicate would be a green
 * over the live shape.
 */
describe('bareModuleOwnerOf', () => {
  const NAMES = MODULE_LAYOUT.modulePackageNames;

  it('names the module a bare package specifier reaches', () => {
    expect(bareModuleOwnerOf(packageNameOf('blog'), NAMES)).toBe('blog');
  });

  it('reads a subpath as the same reach — both put one entry in a dependency list', () => {
    expect(bareModuleOwnerOf(`${packageNameOf('catalog')}/backend`, NAMES)).toBe('catalog');
    expect(bareModuleOwnerOf(`${packageNameOf('catalog')}/ports`, NAMES)).toBe('catalog');
  });

  it('says nothing about a third-party dependency or the platform itself', () => {
    expect(bareModuleOwnerOf('awilix', NAMES)).toBeNull();
    expect(bareModuleOwnerOf('@endora-commerce/contracts', NAMES)).toBeNull();
    expect(bareModuleOwnerOf('@endora-commerce/platform/kernel', NAMES)).toBeNull();
  });

  it('says nothing about a relative specifier — that is the other half', () => {
    expect(bareModuleOwnerOf('../modules/blog/backend.js', NAMES)).toBeNull();
  });

  it('matches the declared name and never a prefix habit', () => {
    // A `mod-` regex would be a derived fact written down (D-100) and would
    // answer wrongly for the first package not named that way. Nothing outside
    // the map is a module, whatever it is called.
    expect(bareModuleOwnerOf('@endora-commerce/mod-not-a-member', NAMES)).toBeNull();
    expect(bareModuleOwnerOf('@endora-commerce/mod-not-a-member', new Map())).toBeNull();
  });

  it('refuses every specifier shape from a platform file, not only a value import', () => {
    const name = packageNameOf('orders');
    const shapes: Readonly<Record<string, string>> = {
      // `import type` reports as `import`: the shared walker keeps the
      // distinction and rules B and C collapse it, because they report *where* a
      // specifier points and only mention how it was written. It is a violation
      // either way — a type-only import does not erase from a `package.json`.
      import: `import type { OrderService } from '${name}/backend';`,
      export: `export { orders } from '${name}/backend';`,
      dynamic: `const m = await import('${name}/backend');`,
      require: `const m = require('${name}/backend');`,
      'import-type': `export type S = import('${name}/backend').OrderService;`,
    };
    for (const [kind, source] of Object.entries(shapes)) {
      const findings = analyzePlatformImports(source, srcFile('composition/index.ts'), SCOPE);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ targetOwner: 'orders', kind });
      expect(isImportViolation(findings[0]!)).toBe(true);
    }
  });

  it('keys a bare reach on the specifier the file wrote', () => {
    const [finding] = analyzePlatformImports(
      `import { registerModule } from '${packageNameOf('blog')}/backend';`,
      srcFile('composition/index.ts'),
      SCOPE,
    );
    expect(importFindingKey(finding!)).toBe(
      `packages/platform/src/composition/index.ts:${packageNameOf('blog')}/backend -> blog`,
    );
  });
});

/**
 * The derivation itself (T118a). Its fixture is a directory tree rather than
 * source text, because a directory listing is what it reads.
 */
describe('platformRootsOf', () => {
  it('lists the directories and nothing else, sorted', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'platform-roots-'));
    mkdirSync(join(fixture, 'kernel'));
    mkdirSync(join(fixture, 'composition'));
    writeFileSync(join(fixture, 'index.ts'), 'export {};\n');
    expect(platformRootsOf(fixture)).toEqual(['composition', 'kernel']);
    rmSync(fixture, { recursive: true, force: true });
  });

  it('answers nothing for a platform with no directory — the run refuses on it', () => {
    // Not a pass over an empty population: `main` prints "holds no directory"
    // and exits 2, for the reason a `platformRoot` of `null` does.
    const fixture = mkdtempSync(join(tmpdir(), 'platform-roots-empty-'));
    expect(platformRootsOf(fixture)).toEqual([]);
    rmSync(fixture, { recursive: true, force: true });
  });

  it('covers every subpath the platform publishes — the run refuses a short walk', () => {
    // The `exports` map is the second author on the `read:` line, and this is
    // the reconciliation it is there for: a published subpath naming no walked
    // directory is a walk that has lost part of the platform.
    const declared = platformSubpathsAt(MODULE_LAYOUT.repoRoot);
    expect(declared.length).toBeGreaterThan(0);
    for (const subpath of declared) {
      expect(PLATFORM_ROOTS).toContain(subpath.split('/')[0]);
    }
  });

  it('is a containment and not an equality, whatever today\'s tree happens to be', () => {
    // This case asserted its own witness until `specs/110-instance-repository/`
    // T119b: it read `expect(PLATFORM_ROOTS.filter(…)).toContain('demo')`, on
    // the grounds that *"`src/demo/` is a directory with no subpath"*. T119b
    // gave that directory `./demo`, at which point every walked directory had an
    // address, the sets were equal, and the assertion was red — a test failing
    // because the tree improved, which is a derived fact written down (D-100).
    //
    // The property it was reaching for is real and is not about `demo`: the map
    // is the **corroboration** and the directory listing is the derivation, so a
    // directory with no subpath is legal and a subpath with no directory is not.
    // It is proven where a property belongs, over a fixture — the real tree may
    // hold a witness on any given day and is not the place to demand one.
    const fixture = mkdtempSync(join(tmpdir(), 'platform-roots-unaddressed-'));
    mkdirSync(join(fixture, 'kernel'));
    mkdirSync(join(fixture, 'workshop'));
    expect(platformRootsOf(fixture)).toEqual(['kernel', 'workshop']);
    rmSync(fixture, { recursive: true, force: true });
  });
});

/**
 * Rule C — the closure (D-53). B is a list, and #92 exists precisely because a
 * peer was never put on a list; C has no list to forget. The fixtures are an
 * in-memory tree, so the rule can go red on a two-hop chain the real tree does
 * not contain.
 */
describe('analyzeClosure', () => {
  const tree = (entries: Readonly<Record<string, string>>, roots: readonly string[]) => ({
    roots,
    read: (file: string): string | null => entries[file] ?? null,
    modulePackageNames: MODULE_LAYOUT.modulePackageNames,
  });

  it('follows a peer to the module behind it and prints the chain', () => {
    const { violations } = analyzeClosure(
      tree(
        {
          [kernelFile('compose.ts')]: "import { HttpError } from '../http/error-envelope.js';",
          [srcFile('http/error-envelope.ts')]:
            "import { ERROR_TRANSLATION_KEYS } from '../modules/_i18n/services/error-translation.js';",
        },
        [kernelFile('compose.ts')],
      ),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ targetOwner: '_i18n', line: 1 });
    expect(violations[0]?.chain).toEqual([
      'packages/platform/src/kernel/compose.ts',
      'packages/platform/src/http/error-envelope.ts',
      // The fixture's specifiers are resolved against the platform root, so the
      // module it reaches is keyed there too. Synthetic on both ends: the rule
      // under test is that the chain is followed and printed, not where this
      // repository's `_i18n` lives.
      'packages/platform/src/modules/_i18n/services/error-translation.ts',
    ]);
  });

  it('reports a direct kernel edge as a two-element chain', () => {
    const { violations } = analyzeClosure(
      tree(
        {
          [kernelFile('ports/organizations.ts')]:
            "import type { Organization } from '../../modules/organizations/entities/organization.entity.js';",
        },
        [kernelFile('ports/organizations.ts')],
      ),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.chain).toEqual([
      'packages/platform/src/kernel/ports/organizations.ts',
      'packages/platform/src/modules/organizations/entities/organization.entity.ts',
    ]);
  });

  it('stops at the module boundary — what is behind the edge is that module’s graph', () => {
    const { violations, files } = analyzeClosure(
      tree(
        {
          [kernelFile('compose.ts')]:
            "import { x } from '../modules/organizations/entities/organization.entity.js';",
          [moduleFile('organizations/entities/organization.entity.ts')]:
            "import { y } from '../../catalog/entities/category.entity.js';",
        },
        [kernelFile('compose.ts')],
      ),
    );
    expect(violations).toHaveLength(1);
    expect(files).not.toContain('src/modules/catalog/entities/category.entity.ts');
  });

  it('is silent on a closure that never reaches a module, and counts what it walked', () => {
    const { violations, files } = analyzeClosure(
      tree(
        {
          [kernelFile('container.ts')]: [
            "import { forkScopedEm } from '../tenancy/scoped-em.js';",
            "import { asFunction } from 'awilix';",
          ].join('\n'),
          [srcFile('tenancy/scoped-em.ts')]: "import { EntityManager } from '@mikro-orm/postgresql';",
        },
        [kernelFile('container.ts')],
      ),
    );
    expect(violations).toEqual([]);
    expect([...files].sort()).toEqual(['packages/platform/src/kernel/container.ts', 'packages/platform/src/tenancy/scoped-em.ts']);
  });

  it('reports a module edge whose target is not on disk, and walks on', () => {
    const { violations } = analyzeClosure(
      tree(
        {
          [kernelFile('compose.ts')]:
            "import { gone } from '../modules/catalog/services/deleted-yesterday.js';",
        },
        [kernelFile('compose.ts')],
      ),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.targetOwner).toBe('catalog');
  });

  it('reports a bare module package as a chain ending in the specifier', () => {
    // The closure follows relative edges and cannot follow this one — a package
    // resolves through its own `exports` map — so it reports the edge and stops,
    // which is what it already does at the module boundary. Without it a chain
    // could reach a module by name and rule C would walk straight past it.
    const { violations } = analyzeClosure(
      tree(
        {
          [kernelFile('compose.ts')]: "import { e } from '../composition/index.js';",
          [srcFile('composition/index.ts')]:
            `import { registerModule } from '${packageNameOf('blog')}/backend';`,
        },
        [kernelFile('compose.ts')],
      ),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.targetOwner).toBe('blog');
    expect(violations[0]?.chain).toEqual([
      'packages/platform/src/kernel/compose.ts',
      'packages/platform/src/composition/index.ts',
      `${packageNameOf('blog')}/backend`,
    ]);
  });

  it('walks past a third-party bare specifier without reporting it', () => {
    const { violations, files } = analyzeClosure(
      tree(
        {
          [kernelFile('container.ts')]: [
            "import { asFunction } from 'awilix';",
            "import { s } from '@endora-commerce/contracts';",
            "import { x } from '../tenancy/scoped-em.js';",
          ].join('\n'),
          [srcFile('tenancy/scoped-em.ts')]: 'export const x = 1;',
        },
        [kernelFile('container.ts')],
      ),
    );
    expect(violations).toEqual([]);
    expect(files).toHaveLength(2);
  });

  it('walks a file once, however many roots reach it', () => {
    const { violations } = analyzeClosure(
      tree(
        {
          [kernelFile('compose.ts')]: "import { e } from '../http/error-envelope.js';",
          [kernelFile('scope.ts')]: "import { e } from '../http/error-envelope.js';",
          [srcFile('http/error-envelope.ts')]:
            "import { k } from '../modules/_i18n/services/error-translation.js';",
        },
        [kernelFile('compose.ts'), kernelFile('scope.ts')],
      ),
    );
    expect(violations).toHaveLength(1);
  });
});

describe('the kernel→module import ledger', () => {
  const ORGANIZATION_ENTRY =
    'packages/platform/src/kernel/ports/organizations.ts:../../modules/organizations/entities/organization.entity.js -> organizations';

  it('is empty — D-54 and D-55 dissolved the last two edges', () => {
    // The completion signal for D-53. D-37 A1 seeded four entries and dissolved
    // three by relocating the file; the survivor was the `Organization` entity
    // type, and D-55 dissolved it with a structural `OrganizationSnapshot`. An
    // empty ledger is the strongest form of the assertion: every entry from here
    // on is a debt with an owner, never a standing exemption.
    expect(Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN)).toEqual([]);
  });

  it('covers nothing — the edge it used to carry is now a failure', () => {
    const [organization] = analyzePlatformImports(
      "import type { Organization } from '../../modules/organizations/entities/organization.entity.js';",
      kernelFile('ports/organizations.ts'),
      SCOPE,
    );
    expect(importFindingKey(organization!)).toBe(ORGANIZATION_ENTRY);
    expect(isDraining(organization!)).toBe(false);
    expect(isImportViolation(organization!)).toBe(true);
  });

  it('fails on an entry that no longer describes an import', () => {
    expect(staleDraining([]).sort()).toEqual(Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN).sort());
  });
});
