import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  discoverModulePackages,
  emittedPathOf,
  packageRelativePathOf,
  type ModulePackage,
} from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { entityNamed } from '../../../src/packages/package-entity-lookup.js';

/**
 * Criterion 7 (feature 080, T040b) — **a host program in the compiled build
 * constructs a module package's entity classes**.
 *
 * A module package publishes `export const entities = [...]` and no entity class
 * by name (D-168), so a host program picks its class out of the array — and
 * `find` over a heterogeneous array returns the **union** of the constructors,
 * which `em.create` collapses to one constituent. The collapse is silent
 * wherever the two payload shapes happen to agree, and it is precise only for a
 * package that publishes exactly one entity, which is why `taxes`,
 * `delivery_methods` and `payment_methods` went through the inferred form and
 * `megamenu` could not.
 *
 * `src/packages/package-entity-lookup.ts` is the repair and this file is what
 * holds it honest. Four questions, in three groups, each answering a different
 * half:
 *
 *  1. the **runtime** half — the class comes off the array by name, and a name
 *     that is not there throws at module load rather than reading `undefined`;
 *  2. the **type** half — a red/green pair compiled by a real `tsc` over a real
 *     multi-entity package, so the collapse is *reproduced* rather than
 *     described, and the repair is measured against it;
 *  3. the **call sites** — every host-program call is reconciled against the
 *     package's own emit layout, which is what closes the one hazard the type
 *     system cannot (`EntityClass<T>` is `Function & { prototype: T }` and
 *     `Function.prototype` is `any`, so the type argument is an assertion);
 *  4. the **population** — re-derived here rather than written down, so the
 *     tenth host program to reach a module's entities is covered by existing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);
if (repoRoot === null) throw new Error('[criterion-7] no repository root above the test tree');
const root: string = repoRoot;
const backendRoot = resolve(here, '../../..');

/** Every entity class a module package declares, with the source file declaring it. */
function entityFilesOf(pkg: ModulePackage): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'dist' || name === 'node_modules') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith('.entity.ts') || full.endsWith('.d.ts')) continue;
      const source = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isClassDeclaration(statement) || statement.name === undefined) continue;
        const exported = ts.canHaveModifiers(statement)
          ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          : false;
        if (exported) found.set(statement.name.text, full);
      }
    }
  };
  walk(pkg.dir);
  return found;
}

const PACKAGES = discoverModulePackages(root);
const MULTI_ENTITY = PACKAGES.map((pkg) => ({ pkg, entities: entityFilesOf(pkg) }))
  .filter((candidate) => candidate.entities.size >= 2)
  .sort((a, b) => b.entities.size - a.entities.size || a.pkg.name.localeCompare(b.pkg.name));

/** The package this file's compile fixtures are written against — the one with the most entities. */
function heaviestPackage(): { pkg: ModulePackage; entities: Map<string, string> } {
  const first = MULTI_ENTITY[0];
  if (first === undefined) {
    throw new Error(
      '[criterion-7] no module package publishes more than one entity, so the collapse this ' +
        'file measures cannot be reproduced. That is a population failure, not a pass.',
    );
  }
  return first;
}

const SUBJECT = heaviestPackage();

describe('criterion 7 — the runtime half: one class, by name, loudly', () => {
  it('found a module package publishing more than one entity, so nothing below is vacuous', () => {
    // The discriminator for this criterion is the **entity count**, not the
    // reach: at one entity the array's element type already is the class.
    expect(PACKAGES.length).toBeGreaterThan(0);
    expect(MULTI_ENTITY.length).toBeGreaterThan(0);
  });

  class Alpha {
    a = 1;
  }
  class Beta {
    b = 2;
  }

  it('returns the array member itself, so the ORM keyed its metadata on this object', () => {
    // D-160.6 — the value is the one `entities-registry.generated.ts` handed the
    // ORM. A copy would be a class the ORM never discovered.
    expect(entityNamed([Alpha, Beta], 'Beta', 'fixture')).toBe(Beta);
  });

  it('throws on a name that is not there, naming what the array does declare', () => {
    expect(() => entityNamed([Alpha, Beta], 'Gamma', '@scope/mod-x/backend')).toThrow(
      /publishes no entity class named 'Gamma'.*Alpha, Beta/s,
    );
  });

  it('throws on an empty array rather than reading `undefined`', () => {
    // The host answers a missing `entities` export with `[]` and no error, so
    // this is the shape a package that lost its array produces.
    expect(() => entityNamed([], 'Alpha', '@scope/mod-x/backend')).toThrow(/\(empty\)/);
  });
});

/**
 * The collapse, reproduced, and the repair measured against it.
 *
 * The fixture enters at the top of the analysis — a real `tsc` over a real
 * package's built `dist`, resolved the way the compiled build resolves it (no
 * `paths`, bare specifier through the `exports` map) — because the property
 * under test is a compiler behaviour and nothing short of the compiler can
 * report it.
 *
 * The assertion is *"at least one of the package's entities is typed wrong"*
 * rather than *"entity N is typed wrong"*, and that is deliberate: the union's
 * constituent order comes out of the package's emitted declaration, and which
 * constituent TypeScript picks is not a fact this repository owns. Only one can
 * win, so with two names asked for, at least one must fail.
 */
describe('criterion 7 — the type half, compiled', () => {
  const names = [...SUBJECT.entities.keys()].sort().slice(0, 2);

  function compile(body: string): string {
    const consumer = mkdtempSync(join(tmpdir(), 'crit7-consumer-'));
    try {
      mkdirSync(join(consumer, 'src'), { recursive: true });
      symlinkSync(join(backendRoot, 'node_modules'), join(consumer, 'node_modules'));
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'crit7-consumer', type: 'module', private: true }),
      );
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            lib: ['ES2022'],
            strict: true,
            exactOptionalPropertyTypes: true,
            skipLibCheck: true,
            noEmit: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            types: ['node'],
          },
          include: ['src/**/*'],
        }),
      );
      writeFileSync(join(consumer, 'src', 'probe.ts'), body);
      try {
        execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
          cwd: consumer,
          encoding: 'utf8',
        });
        return '';
      } catch (error) {
        const failure = error as { stdout?: string };
        return failure.stdout ?? String(error);
      }
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  }

  /** The relative specifier a host program writes for one entity's declaration. */
  function declarationSpecifier(consumerSrc: string, name: string): string {
    const source = SUBJECT.entities.get(name);
    if (source === undefined) throw new Error(`[criterion-7] no source for ${name}`);
    const emitted = emittedPathOf(SUBJECT.pkg, packageRelativePathOf(SUBJECT.pkg, source));
    const path = relative(consumerSrc, join(SUBJECT.pkg.dir, emitted));
    return path.startsWith('.') ? path : `./${path}`;
  }

  const consumerSrc = join(tmpdir(), 'crit7-consumer-x', 'src');
  const imports = (): string[] => [
    `import { entities } from '${SUBJECT.pkg.name}/backend';`,
    ...names.map((name) => `import type { ${name} } from '${declarationSpecifier(consumerSrc, name)}';`),
    "import type { EntityClass } from '@mikro-orm/core';",
    // The inference site `em.create` is: the entity type is read off the class
    // argument and the payload is then checked against it.
    'declare function createLike<T>(entity: EntityClass<T>, data: T): T;',
    // The real implementation, not a copy of its signature: a fixture that
    // re-declares the thing it measures cannot fail when the thing changes.
    `import { entityNamed } from '${relative(consumerSrc, join(backendRoot, 'src/packages/package-entity-lookup.js')).replace(/^(?!\.)/, './')}';`,
  ];

  it('reproduces the collapse: the inferred form checks a payload against the wrong entity', () => {
    // `entityNamedLegacy` is the shape the seed carried before this repair — `C`
    // inferred from the array, which for a multi-entity package is the union of
    // its constructors. TypeScript picks one constituent at the inference site,
    // so at most one of the two payloads below can be checked against the entity
    // it was written for.
    const output = compile(
      [
        ...imports(),
        'declare function entityNamedLegacy<C>(published: readonly C[], name: string): C;',
        ...names.map(
          (name) =>
            `export const made${name} = createLike(entityNamedLegacy(entities, '${name}'), ` +
            `null as unknown as ${name});`,
        ),
        '',
      ].join('\n'),
    );

    expect(output, 'the union no longer collapses — has `entities` stopped being heterogeneous?')
      .toMatch(/error TS2345/);
    expect(output).toContain('is not assignable to parameter of type');
  });

  it('the repair types every entity of the same package precisely', () => {
    const output = compile(
      [
        ...imports(),
        ...names.map(
          (name) =>
            `export const row${name} = createLike(entityNamed<${name}>(entities, '${name}'), ` +
            `null as unknown as ${name});`,
        ),
        '',
      ].join('\n'),
    );

    expect(output.trim()).toBe('');
  });

  it('refuses the row type omitted, which would otherwise accept every payload', () => {
    // With `T` free it resolves to its own constraint and the payload is checked
    // against `object` — quieter than the collapse and strictly worse, since the
    // collapse at least errors when two entities' shapes disagree. The default
    // is unsatisfiable so the first use says so.
    const name = names[0];
    if (name === undefined) throw new Error('[criterion-7] no entity name');
    const output = compile(
      [
        ...imports(),
        `export const row${name} = createLike(entityNamed(entities, '${name}'), ` +
          `null as unknown as ${name});`,
        '',
      ].join('\n'),
    );

    expect(output).toContain('EntityRowTypeIsRequired');
  });

  it('refuses the same import spelled at the package source, which the build cannot name', () => {
    // Why the call sites name `dist`: `backend/tsconfig.build.json` sets
    // `rootDir: ./src`, and a `.ts` outside it is TS6059 **even for an
    // `import type`** — the file still joins the program. A `.d.ts` is exempt.
    const name = names[0];
    if (name === undefined) throw new Error('[criterion-7] no entity name');
    const source = SUBJECT.entities.get(name);
    if (source === undefined) throw new Error(`[criterion-7] no source for ${name}`);
    const consumer = mkdtempSync(join(tmpdir(), 'crit7-rootdir-'));
    try {
      mkdirSync(join(consumer, 'src'), { recursive: true });
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            strict: true,
            skipLibCheck: true,
            declaration: true,
            rootDir: './src',
            outDir: './dist',
            // TS6059 fires under `noEmit` too, and without it `tsc` writes the
            // offending file's output **beside that file's source** — which for
            // this fixture is a real package in this repository. Measured: two
            // untracked artefacts inside `packages/modules/…/src` after one run.
            noEmit: true,
            types: [],
          },
          include: ['src/**/*'],
        }),
      );
      const relativeSource = relative(join(consumer, 'src'), source).replace(/\.ts$/, '.js');
      writeFileSync(
        join(consumer, 'src', 'probe.ts'),
        `import type { ${name} } from '${relativeSource}';\nexport const x: ${name} | null = null;\n`,
      );
      let output = '';
      try {
        execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
          cwd: consumer,
          encoding: 'utf8',
        });
      } catch (error) {
        output = (error as { stdout?: string }).stdout ?? String(error);
      }
      expect(output).toContain('TS6059');
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  });
}, 120_000);

/**
 * Criterion 7's population, re-derived on every run.
 *
 * *"A host program in the compiled build constructs this module's entity
 * classes"* — so the population is every **non-generated** `.ts` file under
 * `backend/src` that is not itself part of a module and that names a module's
 * `entities/`. `entities-registry.generated.ts` is out because the generator
 * rewrites it to bare specifiers on its own (D-149); a module reaching its own
 * or another module's entities is `check:module-boundary`'s question, not this
 * one.
 *
 * It is derived rather than written down because the criterion's cost grows with
 * the sweep: the tenth host program, and the tenth module either of them
 * reaches, has to be covered by existing (D-100).
 */
const GENERATED = /\.generated\.ts$/;

function hostProgramSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'modules' && dir === join(backendRoot, 'src')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith('.ts') && !GENERATED.test(full)) out.push(full);
    }
  };
  walk(join(backendRoot, 'src'));
  return out;
}

interface EntityReach {
  readonly file: string;
  /** Module ids reached through `backend/src/modules/<id>/entities/`. */
  readonly inTree: readonly string[];
  /** `entityNamed<Row>(array, 'Name', …)` calls, one per constructed class. */
  readonly lookups: readonly {
    readonly name: string;
    readonly rowType: string | null;
    readonly array: string | null;
  }[];
  /** Relative specifiers naming a module **package's** directory. */
  readonly packageReaches: readonly { readonly specifier: string; readonly typeOnly: boolean }[];
}

function readReaches(file: string): EntityReach {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const inTree = new Set<string>();
  const packageReaches: { specifier: string; typeOnly: boolean }[] = [];
  const lookups: { name: string; rowType: string | null; array: string | null }[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const inTreeMatch = /(?:^|\/)modules\/([a-z0-9_]+)\/entities\//.exec(specifier);
    if (specifier.startsWith('.') && inTreeMatch?.[1] !== undefined && !specifier.includes('packages/')) {
      inTree.add(inTreeMatch[1]);
    }
    if (specifier.startsWith('.') && specifier.includes('/packages/modules/')) {
      packageReaches.push({ specifier, typeOnly: statement.importClause?.isTypeOnly === true });
    }
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'entityNamed'
    ) {
      const [array, name] = node.arguments;
      const typeArgument = node.typeArguments?.[0];
      lookups.push({
        name: name !== undefined && ts.isStringLiteral(name) ? name.text : '(not a literal)',
        rowType:
          typeArgument !== undefined && ts.isTypeReferenceNode(typeArgument) && ts.isIdentifier(typeArgument.typeName)
            ? typeArgument.typeName.text
            : null,
        array: array !== undefined && ts.isIdentifier(array) ? array.text : null,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { file, inTree: [...inTree].sort(), lookups, packageReaches };
}

/** Where a name arrives from, and under which original name. */
function importOf(file: string, local: string): { specifier: string; original: string; typeOnly: boolean } | null {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.name.text !== local) continue;
      return {
        specifier: statement.moduleSpecifier.text,
        original: (element.propertyName ?? element.name).text,
        typeOnly: statement.importClause?.isTypeOnly === true || element.isTypeOnly,
      };
    }
  }
  return null;
}

const HOST_REACHES = hostProgramSources()
  .map(readReaches)
  .filter((reach) => reach.inTree.length > 0 || reach.lookups.length > 0 || reach.packageReaches.length > 0);

describe("criterion 7 — the population, and every call site's two halves agree", () => {
  it('read a host-program population at all', () => {
    // #215 in this population: a `src` tree that moved leaves a walk that finds
    // no host program, which every assertion below would report as clean.
    expect(hostProgramSources().length).toBeGreaterThan(100);
    expect(HOST_REACHES.length).toBeGreaterThan(0);
  });

  it('reaches only unpackaged modules by relative path', () => {
    // The criterion itself. A module still under `backend/src/modules` is
    // reached by relative import and nothing is wrong with that; the moment it
    // becomes a package that spelling stops resolving, and the repair is
    // `entityNamed` plus a row type off the package's emitted declaration.
    const packaged = new Set(PACKAGES.map((pkg) => pkg.moduleId));
    for (const reach of HOST_REACHES) {
      for (const moduleId of reach.inTree) {
        expect(
          packaged.has(moduleId),
          `${relative(root, reach.file)} imports '${moduleId}' entities by relative path, but ` +
            `'${moduleId}' is a package now — use entityNamed() off its published entities array`,
        ).toBe(false);
      }
    }
  });

  it('names no module package by a value-position relative path', () => {
    // D-160.6.1 — a value reach into a package's own files is a second copy of
    // whatever it names. Type-only is the whole door this mechanism uses.
    for (const reach of HOST_REACHES) {
      for (const packageReach of reach.packageReaches) {
        expect(
          packageReach.typeOnly,
          `${relative(root, reach.file)} value-imports '${packageReach.specifier}'`,
        ).toBe(true);
      }
    }
  });

  it('uses the lookup at all, so the two checks below are not vacuous', () => {
    expect(HOST_REACHES.flatMap((reach) => reach.lookups).length).toBeGreaterThan(0);
  });

  it('reconciles each lookup against the package that declares the class', () => {
    // The hazard the type system cannot see: `EntityClass<T>` is
    // `Function & { prototype: T }` and `Function.prototype` is `any`, so the
    // type argument is an assertion, not a check — a call may ask for one
    // entity's type while naming another's, and both are members of the same
    // union. Closed here, against the package's own emit layout, which also
    // makes the `dist/…` path a checked copy of a derived fact rather than a
    // written-down one (D-100).
    const declaring = new Map<string, { pkg: ModulePackage; entities: Map<string, string> }>();
    for (const pkg of PACKAGES) {
      const entities = entityFilesOf(pkg);
      for (const name of entities.keys()) declaring.set(`${pkg.name}:${name}`, { pkg, entities });
    }

    for (const reach of HOST_REACHES) {
      for (const lookup of reach.lookups) {
        const where = `${relative(root, reach.file)} entityNamed('${lookup.name}')`;

        expect(lookup.rowType, `${where} passes no row type — the union would collapse`).not.toBeNull();
        expect(lookup.array, `${where} does not name an imported entities array`).not.toBeNull();

        const rowImport = importOf(reach.file, lookup.rowType ?? '');
        expect(rowImport, `${where}: '${lookup.rowType ?? ''}' is not imported here`).not.toBeNull();
        if (rowImport === null) continue;
        expect(rowImport.typeOnly, `${where}: the row type must be an \`import type\``).toBe(true);
        expect(rowImport.original, `${where}: the row type names a different class`).toBe(lookup.name);

        const arrayImport = importOf(reach.file, lookup.array ?? '');
        expect(arrayImport, `${where}: '${lookup.array ?? ''}' is not imported here`).not.toBeNull();
        if (arrayImport === null) continue;
        expect(arrayImport.original, `${where}: the array must be the published \`entities\``).toBe(
          'entities',
        );

        const packageName = arrayImport.specifier.replace(/\/backend$/, '');
        const declared = declaring.get(`${packageName}:${lookup.name}`);
        expect(
          declared,
          `${where}: '${packageName}' declares no entity class named '${lookup.name}'`,
        ).toBeDefined();
        if (declared === undefined) continue;

        const entitySource = declared.entities.get(lookup.name);
        if (entitySource === undefined) continue;
        const emitted = join(
          declared.pkg.dir,
          emittedPathOf(declared.pkg, packageRelativePathOf(declared.pkg, entitySource)),
        );
        const written = resolve(dirname(reach.file), rowImport.specifier);
        expect(
          written,
          `${where}: the row type must come from the emitted declaration of ` +
            `${relative(root, entitySource)} — a source path is TS6059 under the build's rootDir`,
        ).toBe(emitted);
      }
    }
  });
});
