/**
 * Does `backend/test/helpers/test-server.ts` name a module package?
 *
 * Feature 134 T012, over `specs/109-backend-test-kit/` Phases 2 and 3. The
 * harness is imported by most of the server-bound test tree and it names module
 * packages three ways — by **specifier**, by **type reference** and by **table
 * name** — so while any of the three is true the core repository does not
 * compile without every module's sources, and no module can be extracted from
 * it. That is the compile-time hard stop feature 134 §2.4 measures, and the
 * three directions below are what it is made of.
 *
 * The analysis is source text plus the ORM's own foreign-key graph: no
 * composition is booted, nothing is imported from the harness, and nothing here
 * has a runtime path. `fk-graph.ts` is the precedent and the table→owner map is
 * literally its `owners`, because two answers to *"who owns this table"* are two
 * answers waiting to disagree.
 *
 * **Every derivation refuses rather than answering emptily.** A walk that
 * resolves no module package, a harness file that is not there, an ownership map
 * with no tables in it and two authors that disagree about the module population
 * are each a `HarnessIndependenceError` — the exit-2 shape — because each of them
 * would otherwise report a clean harness for the reason that it read nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import { discoverModulePackages } from '../../scripts/lib/module-packages.js';
import { coreModuleRoot, deriveFkGraph, KERNEL_OWNER } from './fk-graph.js';
import { TABLE_OWNER_OVERRIDES } from '../unit/db/table-owner-overrides.js';

/** The refusal. Never a soft answer: see the file header. */
export class HarnessIndependenceError extends Error {
  override name = 'HarnessIndependenceError';
}

/** One way the harness names a module package. */
export type HarnessResidueKind =
  /** An import or export specifier that resolves into a module package. */
  | 'module-specifier'
  /** An identifier imported from a module package, used in a type position. */
  | 'module-type-reference'
  /** A string literal equal to a table a module package owns. */
  | 'module-table-name';

export interface HarnessResidue {
  kind: HarnessResidueKind;
  /**
   * The subject, in the grammar its kind reads in: the specifier, the
   * `Interface.member` (or the bare identifier where the reference is not an
   * interface member), or the table name.
   */
  subject: string;
  /** The module package id the subject belongs to. */
  moduleId: string;
}

export interface HarnessIndependenceReading {
  /** What the walk opened, for the disclosure line. */
  read: {
    harness: string;
    harnessLines: number;
    modulePackages: number;
    ownedTables: number;
    importDeclarations: number;
    stringLiterals: number;
  };
  residue: readonly HarnessResidue[];
  /**
   * The two god-objects' members, classified. Feature 109 SC-003's two counts
   * are `options.moduleTyped.length` and `handle.moduleTyped.length`.
   */
  interfaces: Record<'BackendServerOptions' | 'BackendServerHandle', InterfaceReading>;
  /** Specifiers into the application's own composition — feature 109 §2.1's seven. */
  hostBindings: readonly string[];
}

export interface InterfaceReading {
  total: number;
  moduleTyped: readonly string[];
  other: readonly string[];
}

interface ModulePackageIdentity {
  moduleId: string;
  /** `@endora-commerce/mod-<slug>`. */
  name: string;
  /** Absolute package directory. */
  directory: string;
  /** The same, with a trailing separator, so a prefix test cannot half-match a sibling. */
  directoryPrefix: string;
}

/**
 * The module package population, reconciled against a second author.
 *
 * The first is `discoverModulePackages`, which reads every workspace member's
 * `endora.type === 'module'` declaration — the same author the composer and
 * `check:module-boundary` use. The second is the **generated** manifest index's
 * own source text, which lists the packages this build composes. Neither is
 * derived from the other, and a package the index names that the walk did not
 * find (or the reverse) means one of the two has gone blind, which is the
 * condition under which a clean reading below would be meaningless.
 */
export function modulePackagePopulation(repoRoot: string): readonly ModulePackageIdentity[] {
  const discovered = discoverModulePackages(repoRoot);
  if (discovered.length === 0) {
    throw new HarnessIndependenceError(
      `no module package resolved under ${repoRoot} — every direction below would read a ` +
        'harness that names nothing, and report it as independent; refusing to derive one',
    );
  }

  const generatedIndex = resolve(repoRoot, 'backend/src/manifest-index.generated.ts');
  if (!existsSync(generatedIndex)) {
    throw new HarnessIndependenceError(
      `the generated manifest index is not at ${generatedIndex} — the second author of the ` +
        'module population is missing, so the first cannot be reconciled',
    );
  }
  const named = new Set(
    [...readFileSync(generatedIndex, 'utf8').matchAll(/'(@endora-commerce\/mod-[a-z0-9-]+)'/g)].map(
      (match) => match[1]!,
    ),
  );
  if (named.size === 0) {
    throw new HarnessIndependenceError(
      `${generatedIndex} names no module package — the generated artefact is stale or empty, ` +
        'and the reconciliation below would pass for that reason',
    );
  }

  const unnamed = discovered.filter((pkg) => !named.has(pkg.name)).map((pkg) => pkg.name);
  const undiscovered = [...named].filter(
    (name) => !discovered.some((pkg) => pkg.name === name),
  );
  if (unnamed.length > 0 || undiscovered.length > 0) {
    throw new HarnessIndependenceError(
      'the two authors of the module population disagree — ' +
        `the workspace walk found ${discovered.length} and the generated index names ` +
        `${named.size}; walked but not composed: [${unnamed.join(', ')}], composed but not ` +
        `walked: [${undiscovered.join(', ')}]. One of the two has gone blind`,
    );
  }

  return discovered.map((pkg) => ({
    moduleId: pkg.moduleId,
    name: pkg.name,
    directory: resolve(pkg.dir),
    directoryPrefix: resolve(pkg.dir) + sep,
  }));
}

/**
 * The tables module packages own, from the same graph the FK-drift test builds.
 *
 * `KERNEL_OWNER` and the application's own `src/modules` root are read too, and
 * then dropped: a kernel table in the harness's wipe list is not a module
 * coupling, and dropping it here rather than never reading it is what keeps the
 * two owners distinguishable in the refusal below.
 */
export function moduleOwnedTables(repoRoot: string): ReadonlyMap<string, string> {
  const backendSrc = resolve(repoRoot, 'backend/src');
  const graph = deriveFkGraph(backendSrc, {
    overrides: TABLE_OWNER_OVERRIDES,
    kernelRoot: resolve(repoRoot, 'packages/platform/src/kernel'),
    moduleRoots: [
      coreModuleRoot(backendSrc),
      ...modulePackagePopulation(repoRoot).map((pkg) => ({
        directory: pkg.directory,
        origin: 'core' as const,
        moduleId: pkg.moduleId,
      })),
    ],
  });
  const owned = new Map<string, string>();
  for (const [table, owner] of graph.owners) {
    if (owner === KERNEL_OWNER) continue;
    owned.set(table, owner);
  }
  if (owned.size === 0) {
    throw new HarnessIndependenceError(
      'the foreign-key graph claims no module-owned table — the third direction would find no ' +
        'table name in the harness because it knows of none, not because the harness holds none',
    );
  }
  return owned;
}

/** Read the harness and classify every way it names a module package. */
export function readHarnessIndependence(repoRoot: string): HarnessIndependenceReading {
  const harness = resolve(repoRoot, 'backend/test/helpers/test-server.ts');
  if (!existsSync(harness)) {
    throw new HarnessIndependenceError(
      `the harness is not at ${harness} — it has moved or been deleted, and this instrument is ` +
        'about that one file; refusing to report on a file it did not open',
    );
  }
  const source = readFileSync(harness, 'utf8');
  if (source.trim().length === 0) {
    throw new HarnessIndependenceError(`${harness} is empty`);
  }

  const packages = modulePackagePopulation(repoRoot);
  const owners = moduleOwnedTables(repoRoot);
  const sf = ts.createSourceFile(harness, source, ts.ScriptTarget.ESNext, true);
  const harnessDir = dirname(harness);

  /** Which module package a specifier lands in, or `undefined`. */
  const moduleOf = (specifier: string): ModulePackageIdentity | undefined => {
    if (specifier.startsWith('.')) {
      const absolute = resolve(harnessDir, specifier);
      return packages.find((pkg) => absolute.startsWith(pkg.directoryPrefix));
    }
    return packages.find((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`));
  };

  const residue: HarnessResidue[] = [];
  const seen = new Set<string>();
  const record = (entry: HarnessResidue): void => {
    const key = `${entry.kind}\u0000${entry.subject}`;
    if (seen.has(key)) return;
    seen.add(key);
    residue.push(entry);
  };

  /** Identifier → the module package it was imported from. */
  const imported = new Map<string, ModulePackageIdentity>();
  const hostBindings: string[] = [];
  let importDeclarations = 0;

  for (const statement of sf.statements) {
    const clause =
      ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
        ? statement.moduleSpecifier
        : undefined;
    if (clause === undefined || !ts.isStringLiteral(clause)) continue;
    importDeclarations += 1;
    const specifier = clause.text;
    if (specifier.startsWith('../../src/')) hostBindings.push(specifier);
    const owner = moduleOf(specifier);
    if (owner === undefined) continue;
    record({ kind: 'module-specifier', subject: specifier, moduleId: owner.moduleId });
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined) continue;
    const { name, namedBindings } = statement.importClause;
    if (name !== undefined) imported.set(name.text, owner);
    if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) imported.set(element.name.text, owner);
    }
    if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
      imported.set(namedBindings.name.text, owner);
    }
  }

  const interfaces = {
    BackendServerOptions: classifyInterface(sf, 'BackendServerOptions', imported, record),
    BackendServerHandle: classifyInterface(sf, 'BackendServerHandle', imported, record),
  };

  // The third direction. Every string literal in the file, against the tables a
  // module package owns — not `SEEDED_TABLES` by name, because a predicate keyed
  // to one identifier reports a clean file the moment that identifier is renamed
  // while the literals stay (issue #237's shape).
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const owner = owners.get(node.text);
      if (owner !== undefined && packages.some((pkg) => pkg.moduleId === owner)) {
        record({ kind: 'module-table-name', subject: node.text, moduleId: owner });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  let stringLiterals = 0;
  const countLiterals = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) stringLiterals += 1;
    ts.forEachChild(node, countLiterals);
  };
  ts.forEachChild(sf, countLiterals);

  return {
    read: {
      harness: relative(repoRoot, harness),
      harnessLines: source.split('\n').length,
      modulePackages: packages.length,
      ownedTables: owners.size,
      importDeclarations,
      stringLiterals,
    },
    residue: [...residue].sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject),
    ),
    interfaces,
    hostBindings,
  };
}

function classifyInterface(
  sf: ts.SourceFile,
  name: 'BackendServerOptions' | 'BackendServerHandle',
  imported: ReadonlyMap<string, ModulePackageIdentity>,
  record: (entry: HarnessResidue) => void,
): InterfaceReading {
  let declaration: ts.InterfaceDeclaration | undefined;
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) declaration = node;
  });
  if (declaration === undefined) {
    throw new HarnessIndependenceError(
      `the harness declares no \`${name}\` — feature 109 R2.3 keeps both interface names for the ` +
        'test files that stay, so its absence means this reading has lost its subject rather ' +
        'than that the interface is clean',
    );
  }

  const moduleTyped: string[] = [];
  const other: string[] = [];
  for (const member of declaration.members) {
    const memberName = member.name === undefined ? '<unnamed>' : member.name.getText(sf);
    const annotation =
      (ts.isPropertySignature(member) || ts.isMethodSignature(member)) && member.type !== undefined
        ? member.type.getText(sf)
        : '';
    const owners = new Set<string>();
    for (const identifier of annotation.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const owner = imported.get(identifier);
      if (owner !== undefined) owners.add(owner.moduleId);
    }
    if (owners.size === 0) {
      other.push(memberName);
      continue;
    }
    moduleTyped.push(memberName);
    for (const moduleId of owners) {
      record({
        kind: 'module-type-reference',
        subject: `${name}.${memberName}`,
        moduleId,
      });
    }
  }
  return { total: declaration.members.length, moduleTyped, other };
}
