import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeClosure,
  analyzePlatformImports,
  analyzeSource,
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
  KERNEL_MODULE_IMPORTS_TO_DRAIN,
  PENDING_RELOCATION,
  PLATFORM_ROOTS,
} from '../../../scripts/check-kernel-boundary.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

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

/** A cross-module import that still resolves after the D-32 relocations. */
const CATALOG_CATEGORY_IMPORT =
  "import { Category } from '../../catalog/entities/category.entity.js';";

/**
 * Derived, never written out. `analyzeSource` reads the owning module out of the
 * path and resolves the relation target as a file on disk, so a literal path
 * only works on the machine it was typed on: in CI the checkout lives under
 * `/builds/…`, every lookup missed, and three cases failed with "expected [] to
 * have a length of 1" — green locally, red in the pipeline.
 */
const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const moduleFile = (relative: string): string => join(BACKEND_ROOT, 'src/modules', relative);

describe('analyzeSource', () => {
  it('finds the relation target through the import that declares it', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToOne(() => Category, { fieldName: "category_id" })',
        CATALOG_CATEGORY_IMPORT,
      ),
      moduleFile('search/entities/search-phrase-record.entity.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceOwner: 'search',
      targetOwner: 'catalog',
      decorator: 'ManyToOne',
      targetName: 'Category',
    });
    expect(isViolation(findings[0]!)).toBe(true);
  });

  it('ignores a plain @Property — an FK column is not an ORM relation', () => {
    const findings = analyzeSource(
      ENTITY('@Property({ type: "uuid" })', CATALOG_CATEGORY_IMPORT),
      moduleFile('search/entities/x.entity.ts'),
    );
    expect(findings).toEqual([]);
  });

  it('reads the entity out of the object form too', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToMany({ entity: () => Category, pivotTable: "setting_categories" })',
        CATALOG_CATEGORY_IMPORT,
      ),
      moduleFile('settings/entities/setting.entity.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('catalog');
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
      ENTITY('@OneToMany(() => Category, (c) => c.thing)', CATALOG_CATEGORY_IMPORT),
      moduleFile('search/entities/index.ts'),
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
const PLATFORM_ROOT = join(BACKEND_ROOT, '..', 'packages', 'platform', 'src');
const kernelFile = (relative: string): string => join(PLATFORM_ROOT, 'kernel', relative);
const srcFile = (relative: string): string => join(PLATFORM_ROOT, relative);

describe('analyzePlatformImports', () => {
  it('finds a value import into a module and names its bindings', () => {
    const findings = analyzePlatformImports(
      "import { ModuleDisabledError } from '../../modules/_lifecycle/plugin-helpers.js';",
      kernelFile('ports/provide.ts'),
      PLATFORM_ROOT,
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
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('organizations');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses the inline `import(…).Type` annotation ESLint encourages', () => {
    const findings = analyzePlatformImports(
      'export type Org = import("../../modules/organizations/entities/organization.entity.js").Organization;',
      kernelFile('ports/organizations.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'organizations', kind: 'import-type' });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a re-export — an import with a wider blast radius', () => {
    const findings = analyzePlatformImports(
      "export { Category } from '../modules/catalog/entities/category.entity.js';",
      kernelFile('index.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'export' });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a dynamic import', () => {
    const findings = analyzePlatformImports(
      "const m = await import('../modules/catalog/backend.js');",
      kernelFile('compose.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'dynamic' });
  });

  it('refuses a require()', () => {
    const findings = analyzePlatformImports(
      "const m = require('../modules/catalog/backend.js');",
      kernelFile('compose.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'require' });
  });

  it('refuses a deployment overlay module', () => {
    const findings = analyzePlatformImports(
      "import { thing } from '../apps/example/modules/example_overlay/service.js';",
      kernelFile('compose.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('example_overlay');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a deployment decoration — a kernel that differs per deployment is not a kernel', () => {
    const findings = analyzePlatformImports(
      "import { decorate } from '../apps/example/decorations/catalog-service.js';",
      kernelFile('compose.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('apps/example');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('allows the kernel to import a peer of the kernel', () => {
    const findings = analyzePlatformImports(
      "import { scopedEm } from '../tenancy/scoped-em.js';",
      kernelFile('container.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBeNull();
    expect(isImportViolation(findings[0]!)).toBe(false);
  });

  it('ignores a kernel-internal import and a package specifier', () => {
    const findings = analyzePlatformImports(
      ["import { asFunction } from 'awilix';", "import { x } from './container.js';"].join('\n'),
      kernelFile('ports/provide.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toEqual([]);
  });

  it('says nothing about a module importing the kernel — that direction is allowed', () => {
    const findings = analyzePlatformImports(
      "import { registerPort } from '../../kernel/ports/provide.js';",
      join(BACKEND_ROOT, 'src/modules/catalog/backend.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toEqual([]);
  });

  it('does not gate on the target existing on disk', () => {
    const findings = analyzePlatformImports(
      "import { gone } from '../modules/catalog/services/deleted-yesterday.js';",
      kernelFile('compose.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(isImportViolation(findings[0]!)).toBe(true);
  });
});

/**
 * Rule B widened to the platform roots (D-53). The kernel cannot compile without
 * these three peers — five kernel entities take `@GlobalEntity()` from
 * `src/tenancy` and four kernel files take `HttpError` from `src/http` as a
 * value — so a peer that may import a module is a kernel that imports modules
 * with one extra hop.
 */
describe('analyzePlatformImports over the platform roots', () => {
  it('declares the four roots the rule walks', () => {
    expect([...PLATFORM_ROOTS]).toEqual(['kernel', 'http', 'events', 'tenancy']);
  });

  it('names the root a file belongs to, and nothing outside them', () => {
    expect(platformRootOf(kernelFile('compose.ts'), PLATFORM_ROOT)).toBe('kernel');
    expect(platformRootOf(srcFile('http/error-envelope.ts'), PLATFORM_ROOT)).toBe('http');
    expect(platformRootOf(srcFile('events/bus.ts'), PLATFORM_ROOT)).toBe('events');
    expect(platformRootOf(srcFile('tenancy/scoped-em.ts'), PLATFORM_ROOT)).toBe('tenancy');
    expect(platformRootOf(srcFile('db/entities-registry.generated.ts'), PLATFORM_ROOT)).toBeNull();
    expect(platformRootOf(moduleFile('catalog/backend.ts'), PLATFORM_ROOT)).toBeNull();
  });

  it('refuses the one hop that made the kernel rule cosmetic — a peer naming a module', () => {
    const findings = analyzePlatformImports(
      "import { ERROR_TRANSLATION_KEYS } from '../modules/_i18n/services/error-translation.js';",
      srcFile('http/error-envelope.ts'),
      PLATFORM_ROOT,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: '_i18n', kind: 'import', line: 1 });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses it from tenancy and from events too', () => {
    const fromTenancy = analyzePlatformImports(
      "import type { Organization } from '../modules/organizations/entities/organization.entity.js';",
      srcFile('tenancy/org-scoped.decorator.ts'),
      PLATFORM_ROOT,
    );
    expect(fromTenancy).toHaveLength(1);
    expect(fromTenancy[0]?.targetOwner).toBe('organizations');

    const fromEvents = analyzePlatformImports(
      "const m = await import('../modules/catalog/backend.js');",
      srcFile('events/bus.ts'),
      PLATFORM_ROOT,
    );
    expect(fromEvents).toHaveLength(1);
    expect(fromEvents[0]).toMatchObject({ targetOwner: 'catalog', kind: 'dynamic' });
  });

  it('allows a peer to import the kernel, and ignores its own root', () => {
    const outward = analyzePlatformImports(
      "import { HttpError } from '../kernel/index.js';",
      srcFile('http/server.ts'),
      PLATFORM_ROOT,
    );
    expect(outward).toHaveLength(1);
    expect(outward[0]?.targetOwner).toBeNull();
    expect(isImportViolation(outward[0]!)).toBe(false);

    expect(
      analyzePlatformImports(
        "import { HttpError } from './error-envelope.js';",
        srcFile('http/server.ts'),
        PLATFORM_ROOT,
      ),
    ).toEqual([]);
  });

  it('keys a peer violation on the file that wrote it', () => {
    const [finding] = analyzePlatformImports(
      "import { ERROR_TRANSLATION_KEYS } from '../modules/_i18n/services/error-translation.js';",
      srcFile('http/error-envelope.ts'),
      PLATFORM_ROOT,
    );
    expect(importFindingKey(finding!)).toBe(
      'packages/platform/src/http/error-envelope.ts:../modules/_i18n/services/error-translation.js -> _i18n',
    );
  });

  it('says nothing about src/db, src/commands or src/overlay — they are not platform roots', () => {
    // `src/db` names every module by construction — F2 of the packaging
    // roadmap made both registries generated, so the names are emitted from a
    // tree walk rather than typed, but they are still there. `src/commands`
    // sits *above* the kernel, so D-57 flags it for F4 rather than folding it
    // in here.
    expect(
      analyzePlatformImports(
        "import { Category } from '../modules/catalog/entities/category.entity.js';",
        srcFile('db/entities-registry.generated.ts'),
        PLATFORM_ROOT,
      ),
    ).toEqual([]);
    expect(
      analyzePlatformImports(
        "import { Category } from '../modules/catalog/entities/category.entity.js';",
        srcFile('commands/command-bus.ts'),
        PLATFORM_ROOT,
      ),
    ).toEqual([]);
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
      PLATFORM_ROOT,
    );
    expect(importFindingKey(organization!)).toBe(ORGANIZATION_ENTRY);
    expect(isDraining(organization!)).toBe(false);
    expect(isImportViolation(organization!)).toBe(true);
  });

  it('fails on an entry that no longer describes an import', () => {
    expect(staleDraining([]).sort()).toEqual(Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN).sort());
  });
});
