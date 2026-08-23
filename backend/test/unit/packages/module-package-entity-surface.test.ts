import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import {
  backendBarrelSourceOf,
  d168Findings,
  declaredEntityClassesUnder,
  emitLayoutOfBuild,
  readBackendSurface,
} from '../../helpers/module-package-surface.js';

/**
 * D-168 — a module package publishes its entities as **one `entities` array**
 * on `./backend`, and **no entity class by name**.
 *
 * The rule is general on purpose: `blog` is the first module package and it is
 * not going to be the last, and the two defects this fixes were both invisible
 * for the same structural reason — a workspace member is not an installed
 * package, so the package-facing half of the estate reports `package pass=0`
 * and nothing in CI ever read blog's `./backend` export the way a running
 * platform reads it. Measured on `master`, with `blog` packed and installed
 * into a throwaway instance outside the repository, the real boot-time reader
 * (`packageSchemaContributionsUnder`) answered **`entities=0`** — and only after
 * the same file's `./migrations` sibling was repaired, because that one threw
 * outright.
 *
 * So the population here is **every module package**, keyed on the `endora`
 * block a package declares about itself — the same statement the runtime
 * discovery reads (D-142) — and never on a path. That reaches the acceptance
 * fixture package too, which is not a workspace member by design and is
 * therefore invisible to `discoverModulePackages`; it is a module package all
 * the same and D-168 is about what a module package publishes.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

interface Subject {
  readonly moduleId: string;
  readonly name: string;
  readonly dir: string;
  readonly backendTarget: string | null;
  /** The package's own `build` script, which names the tsconfig its emit follows. */
  readonly buildScript: string | undefined;
}

/**
 * Module packages this repository ships that the workspace globs do not reach.
 *
 * Two-way, and it exists because the population cannot be one derivation. The
 * globs are the authority for *members* (D-100), and the acceptance fixture is
 * deliberately not one — that is the whole point of D-110, a package pnpm
 * cannot link — while being the module package written as a template for a
 * stranger, so it is exactly the one a rule about a published surface must
 * cover. An entry names a directory relative to the repository root and says
 * why the globs do not hold it.
 */
const MODULE_PACKAGES_OUTSIDE_THE_WORKSPACE: Readonly<Record<string, string>> = {
  'backend/acceptance/fixture-package':
    'the package-schema acceptance fixture (D-110). Not a `pnpm-workspace.yaml` member on ' +
    'purpose, so pnpm cannot link it and the criterion measures a real install — and it is ' +
    'the shape a third-party author copies, so D-168 has to reach it.',
};

/**
 * Module manifests that are **inputs to a check** rather than packages this
 * repository ships.
 *
 * Two-way as well. `backend/test/fixtures/installed-packages/` holds four
 * hand-written `node_modules` trees whose job is to be malformed —
 * `mod-schema-without-entities` exists to be refused by
 * `package-declarations.ts`, and holding it to D-168 would make one check's red
 * proof another check's red. They ship hand-written `.js` and no build, so
 * there is no source barrel to read either.
 */
const FIXTURE_ROOTS: Readonly<Record<string, string>> = {
  'backend/test/fixtures/installed-packages':
    "red proofs for `package-declarations.ts`; several are malformed by design and none ships " +
    'a TypeScript source barrel this analysis could read.',
};

/** Directories a scan for module manifests never enters. */
const SKIPPED = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', 'build']);

function backendTargetOf(manifest: Record<string, unknown>): string | null {
  const exportsMap = manifest['exports'] as Record<string, unknown> | undefined;
  const backend = exportsMap?.['./backend'];
  if (typeof backend === 'string') return backend;
  const withConditions = backend as { default?: unknown } | undefined;
  return typeof withConditions?.default === 'string' ? withConditions.default : null;
}

/** Every `endora: { type: 'module' }` manifest under the checkout, fixtures included. */
function scanForModuleManifests(root: string, out: Subject[] = [], depth = 0): Subject[] {
  if (depth > 6) return out;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  if (entries.includes('package.json')) {
    let manifest: Record<string, unknown> | null = null;
    try {
      manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<
        string,
        unknown
      >;
    } catch {
      manifest = null;
    }
    const endora = manifest?.['endora'] as { type?: unknown; id?: unknown } | undefined;
    if (manifest !== null && endora?.type === 'module' && typeof endora.id === 'string') {
      out.push({
        moduleId: endora.id,
        name: String(manifest['name'] ?? endora.id),
        dir: root,
        backendTarget: backendTargetOf(manifest),
        buildScript: (manifest['scripts'] as Record<string, string> | undefined)?.['build'],
      });
    }
  }
  for (const entry of entries) {
    if (SKIPPED.has(entry)) continue;
    const full = join(root, entry);
    try {
      if (statSync(full).isDirectory()) scanForModuleManifests(full, out, depth + 1);
    } catch {
      /* a dangling link is not a package */
    }
  }
  return out;
}

function isUnder(dir: string, root: string, relative: string): boolean {
  const base = join(root, relative);
  return dir === base || dir.startsWith(`${base}/`);
}

function subjectsIn(root: string): Subject[] {
  const declared = new Set(
    Object.keys(MODULE_PACKAGES_OUTSIDE_THE_WORKSPACE).map((relative) => join(root, relative)),
  );
  const members = new Set(discoverModulePackages(root).map((pkg) => pkg.dir));
  return scanForModuleManifests(root)
    .filter((subject) => members.has(subject.dir) || declared.has(subject.dir))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('D-168 — a module package publishes its entities as one array and no named class', () => {
  if (repoRoot === null) throw new Error('[d168] no repository root above the test tree');
  const root: string = repoRoot;

  const scanned = scanForModuleManifests(root);
  const workspacePackages = discoverModulePackages(root);
  const subjects = subjectsIn(root);

  it('found module packages at all, so the sweep below is not vacuous', () => {
    expect(subjects.length).toBeGreaterThan(0);
  });

  it('holds every module package the workspace declares', () => {
    // The second, independent source. `discoverModulePackages` answers over the
    // `pnpm-workspace.yaml` globs; the scan answers over the filesystem. A scan
    // that has stopped reaching `packages/modules` would sweep nothing and
    // report clean, which is issue #215 in this population.
    expect(workspacePackages.length).toBeGreaterThan(0);
    const held = new Set(subjects.map((s) => s.moduleId));
    for (const pkg of workspacePackages) expect(held, pkg.name).toContain(pkg.moduleId);
  });

  it('holds every module package outside the workspace that this repository ships', () => {
    for (const [relative, reason] of Object.entries(MODULE_PACKAGES_OUTSIDE_THE_WORKSPACE)) {
      expect(reason.length, relative).toBeGreaterThan(20);
      const found = scanned.find((s) => s.dir === join(root, relative));
      expect(found, `${relative} declares no \`endora.type: "module"\` manifest`).toBeDefined();
      expect(subjects.map((s) => s.dir)).toContain(join(root, relative));
    }
  });

  it('accounts for every module manifest in the checkout, so nothing drops out silently', () => {
    // The two-way half. A module package added anywhere — a second one under
    // `packages/modules`, a vendored one, a new acceptance fixture — is either
    // a workspace member (swept), a declared exception (swept) or a declared
    // check fixture (excluded with a reason). There is no fourth answer.
    const members = new Set(workspacePackages.map((pkg) => pkg.dir));
    const declared = new Set(
      Object.keys(MODULE_PACKAGES_OUTSIDE_THE_WORKSPACE).map((r) => join(root, r)),
    );
    const unaccounted = scanned.filter(
      (s) =>
        !members.has(s.dir) &&
        !declared.has(s.dir) &&
        !Object.keys(FIXTURE_ROOTS).some((r) => isUnder(s.dir, root, r)),
    );
    expect(unaccounted.map((s) => `${s.name} (${s.dir})`)).toEqual([]);
  });

  it('keeps the fixture-root exclusions honest', () => {
    for (const [relative, reason] of Object.entries(FIXTURE_ROOTS)) {
      expect(reason.length, relative).toBeGreaterThan(20);
      const held = scanned.filter((s) => isUnder(s.dir, root, relative));
      expect(held.length, `${relative} holds no module manifest any more`).toBeGreaterThan(0);
    }
  });

  for (const subject of subjectsIn(root)) {
    describe(subject.name, () => {
      it('declares a `./backend` subpath whose source this analysis can read', () => {
        expect(subject.backendTarget, `${subject.name} publishes no ./backend`).not.toBeNull();
        const emit = emitLayoutOfBuild(subject.dir, subject.buildScript);
        const barrel = backendBarrelSourceOf(subject.dir, subject.backendTarget ?? '', emit);
        expect(barrel, `${subject.backendTarget} maps to no source file`).not.toBeNull();
      });

      it('publishes one `entities` array and no entity class by name', () => {
        const emit = emitLayoutOfBuild(subject.dir, subject.buildScript);
        const barrel = backendBarrelSourceOf(subject.dir, subject.backendTarget ?? '', emit);
        if (barrel === null) throw new Error(`[d168] no source behind ${subject.name}/backend`);

        const surface = readBackendSurface(barrel);
        const declared = declaredEntityClassesUnder(subject.dir);
        const findings = d168Findings(surface, declared);

        expect(
          findings.map((finding) => `${finding.kind}: ${finding.detail}`),
          `${subject.name} (${barrel})`,
        ).toEqual([]);
      });

      it('declares every entity it owns, so the array is a claim rather than a formality', () => {
        const declared = declaredEntityClassesUnder(subject.dir);
        const emit = emitLayoutOfBuild(subject.dir, subject.buildScript);
        const barrel = backendBarrelSourceOf(subject.dir, subject.backendTarget ?? '', emit);
        if (barrel === null) throw new Error(`[d168] no source behind ${subject.name}/backend`);
        const surface = readBackendSurface(barrel);
        // A package may legitimately own no entity; one that owns some must list
        // exactly those. Asserting equality rather than containment catches the
        // array member that is not an entity at all, which the platform's loader
        // would hand the ORM as a class it can map to no table.
        expect(surface.entitiesArray ?? []).toEqual(declared);
      });
    });
  }
});

/**
 * The analyser's own red proofs — one per shape D-168 refuses, each entering at
 * the top of the analysis over a fixture tree on disk (issue #130).
 *
 * They are here rather than in the sweep above because the sweep is green by
 * construction once the tree is repaired, and a rule whose only evidence is a
 * green run over a correct tree is a rule nobody has seen refuse anything.
 */
describe('D-168 — the shapes the analysis refuses', () => {
  let fixtures: string;

  const ENTITY = `@${'Ent'}${'ity'}({ tableName: 'widgets' })`;

  function writePackage(name: string, barrel: string, extra: Record<string, string> = {}): string {
    const dir = join(fixtures, name, 'src', 'backend');
    mkdirSync(join(dir, 'entities'), { recursive: true });
    writeFileSync(
      join(dir, 'entities', 'widget.entity.ts'),
      `import { Entity } from '@mikro-orm/core';\n${ENTITY}\nexport class Widget {}\n`,
    );
    for (const [file, text] of Object.entries(extra)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    writeFileSync(join(dir, 'index.ts'), barrel);
    return join(dir, 'index.ts');
  }

  beforeAll(() => {
    fixtures = mkdtempSync(join(tmpdir(), 'd168-fixtures-'));
  });
  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true });
  });

  it('refuses a barrel that re-exports its entities and declares no array — the `master` shape', () => {
    const barrel = writePackage('star', `export * from './entities/widget.entity.js';\n`);
    const findings = d168Findings(readBackendSurface(barrel), ['Widget']);

    expect(findings.map((f) => f.kind).sort()).toEqual([
      'missing-entities-array',
      'named-entity-export',
    ]);
    expect(findings.find((f) => f.kind === 'named-entity-export')?.detail).toContain('Widget');
  });

  it('refuses a named class export standing beside a correct array', () => {
    const barrel = writePackage(
      'named',
      `import { Widget } from './entities/widget.entity.js';\n` +
        `export { Widget };\n` +
        `export const entities = [Widget] as const;\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), ['Widget']).map((f) => f.kind)).toEqual([
      'named-entity-export',
    ]);
  });

  it('refuses a barrel that lost its array while keeping no named export either', () => {
    const barrel = writePackage(
      'noarray',
      `import { Widget } from './entities/widget.entity.js';\nexport const used = Widget.name;\n`,
    );

    // One finding, not two: with no array at all there is nothing for an entity
    // to be missing from, and reporting each class beside the absent array would
    // bury the one instruction the author needs.
    expect(d168Findings(readBackendSurface(barrel), ['Widget']).map((f) => f.kind)).toEqual([
      'missing-entities-array',
    ]);
  });

  it('refuses an `entities` export that is not an array', () => {
    const barrel = writePackage(
      'notarray',
      `import { Widget } from './entities/widget.entity.js';\n` +
        `export const entities = new Set([Widget]);\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), ['Widget']).map((f) => f.kind)).toEqual([
      'entities-not-an-array',
    ]);
  });

  it('refuses an entity the package owns and the array omits', () => {
    const barrel = writePackage(
      'omitted',
      `import { Widget } from './entities/widget.entity.js';\n` +
        `export const entities = [Widget];\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), ['Widget', 'Gadget']).map((f) => f.kind)).toEqual(
      ['entity-missing-from-array'],
    );
  });

  it('reports a re-export it cannot follow rather than passing it', () => {
    const barrel = writePackage(
      'bare',
      `export * from '@somebody/else';\nexport const entities = [];\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), []).map((f) => f.kind)).toEqual([
      'unresolvable-reexport',
    ]);
  });

  it('follows a named re-export chain, so one hop does not hide the class', () => {
    // `export { Widget } from './x.js'` two files deep — the same edge as
    // `export *`, spelled the way an author reaches for when told to stop
    // using the star.
    const barrel = writePackage(
      'chain',
      `export * from './inner.js';\nexport const entities = [];\n`,
      { 'inner.ts': `export { Widget } from './entities/widget.entity.js';\n` },
    );

    expect(d168Findings(readBackendSurface(barrel), []).map((f) => f.kind)).toEqual([
      'named-entity-export',
    ]);
  });

  it('accepts the shape D-168 rules — one array, no named class', () => {
    const barrel = writePackage(
      'good',
      `import { Widget } from './entities/widget.entity.js';\n` +
        `export function registerModule() {}\n` +
        `export const entities = [Widget];\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), ['Widget'])).toEqual([]);
  });

  it('does not mistake a non-entity export for one', () => {
    // The discrimination: a service class and an interface leave `./backend` by
    // name legitimately, and a rule that refused those would be unusable.
    const barrel = writePackage(
      'services',
      `import { Widget } from './entities/widget.entity.js';\n` +
        `export class WidgetService {}\n` +
        `export const entities = [Widget];\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), ['Widget'])).toEqual([]);
    expect(readBackendSurface(barrel).namedEntityExports).toEqual([]);
  });

  it('is not fooled by a comment quoting the shape it refuses', () => {
    const barrel = writePackage(
      'comment',
      `import { Widget } from './entities/widget.entity.js';\n` +
        `// Never write: export * from './entities/widget.entity.js';\n` +
        `/** and never \`export { Widget }\` either. */\n` +
        `export const entities = [Widget];\n`,
    );

    expect(d168Findings(readBackendSurface(barrel), ['Widget'])).toEqual([]);
  });
});

/**
 * The committed host registry follows the same ruling, which is the half a
 * package-shaped test cannot see: the generator emits one spread per package
 * instead of a class per name, so a named import reappearing there would be a
 * consumer of exactly the export D-168 removes.
 */
describe('D-168 — the generated entity registry names no package class', () => {
  it('imports each module package’s entities as one array', () => {
    const registry = readFileSync(
      resolve(here, '../../../src/db/entities-registry.generated.ts'),
      'utf8',
    );
    if (repoRoot === null) throw new Error('[d168] no repository root above the test tree');
    const packages = discoverModulePackages(repoRoot);
    expect(packages.length).toBeGreaterThan(0);

    for (const pkg of packages) {
      const named = new RegExp(`import \\{ (?!entities as )\\w+ \\} from '${pkg.name}[^']*';`);
      expect(registry, `${pkg.name} is imported by name in the entity registry`).not.toMatch(named);
      if (declaredEntityClassesUnder(pkg.dir).length === 0) continue;
      expect(registry, `${pkg.name} contributes no entities array`).toMatch(
        new RegExp(`import \\{ entities as \\w+ \\} from '${pkg.name}/[^']*';`),
      );
    }
  });
});
