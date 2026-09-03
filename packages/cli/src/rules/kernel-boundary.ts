/**
 * CI check — ORM relations respect the module boundary (feature 072, D-32).
 *
 * Rule A of `check:kernel-boundary`: a `@ManyToOne` / `@OneToMany` /
 * `@OneToOne` / `@ManyToMany` relation may point **inside its own module** or
 * **at the platform** (the kernel and the pre-split `core` entities), and
 * nowhere else. A relation from one module's entity into another module's is a
 * foreign key the ORM will create, in a schema neither module can be detached
 * from — Principle I with a database constraint behind it.
 *
 * Static analysis through the TypeScript compiler API. A decorator's target is
 * read as the capitalised identifiers inside the decorator's arguments, mapped
 * back through the file's own relative imports, so a mention in a comment or a
 * string is not a finding and a target declared in the same file is same-owner
 * by construction.
 *
 * ## One analysis, two hosts, and why only rule A travels
 *
 * This file is rule A (`specs/101-endora-check/contracts/package-scope-layout.md`
 * §6). `backend/scripts/check-kernel-boundary.ts` hosts it over this
 * repository's module walk roots, alongside its own **rules B and C** — the
 * specifiers a platform root names, and the kernel's transitive import closure.
 * Those two stay with that host rather than travelling, and not as an omission:
 * their subject is *the platform's own roots*, and a module package holds none,
 * so there is nothing in a package for them to read. `endora check` declares
 * them unevaluated on the rule's own line rather than counting them zero — a
 * signal that reports nothing because it had no subject and a signal that
 * reports nothing because the tree is clean are the two states this estate
 * exists to keep apart.
 *
 * ## Attribution, and the one derivation that had to learn a second source
 *
 * `ownerOf` reads the owner off a `/src/modules/<id>/` path segment, which is
 * this repository's convention (D-141) and a stranger's checkout has no reason
 * to hold. It therefore takes the same `HostResidentModules` map every other
 * relocated rule takes: a package-scope host hands it the one mapping its
 * `endora.id` declares, and attribution keys on the declaration rather than on
 * a directory name.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';

import {
  moduleIdOf,
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from '../lib/module-population.js';

const RELATION_DECORATORS = new Set(['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany']);

/**
 * Who owns the entity declared in `file`: a module id, `kernel`, or `core` for
 * the entities that predate the module split and live under `src/db`.
 */
export function ownerOf(
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): string | null {
  const moduleMatch = /\/src\/modules\/([^/]+)\//.exec(file);
  if (moduleMatch) return moduleMatch[1] ?? null;
  if (file.includes('/src/kernel/')) return 'kernel';
  if (file.includes('/src/db/')) return 'core';
  // The package half of the derivation, and the reason it is here: without it a
  // module package's entities are read by the walk, satisfy the floor, and are
  // then attributed to nobody — which for `analyzeSource` means "not an entity
  // this rule judges", so every relation in the package is skipped and the run
  // reports clean. That is issue #215's failure one layer in.
  return moduleIdOf(file, hostResident);
}

/** `kernel` and `core` are the parts every deployment has; a module may point at them. */
function isPlatformOwner(owner: string): boolean {
  return owner === 'kernel' || owner === 'core';
}

/**
 * Every `.ts` under `dir` except tests and declaration files.
 *
 * Rule A used to walk `*.entity.ts` only. Nothing enforces that naming — an
 * entity declared in `entities/index.ts`, or a relation added to a class in an
 * ordinary file, was simply not scanned, and a scan that does not look is
 * indistinguishable from one that finds nothing. The file list is now the whole
 * tree and {@link RELATION_DECORATOR_HINT} decides what is worth parsing, so the
 * rule's scope is a property of the code rather than of a filename.
 */
export function collectSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectSources(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A cheap pre-filter: only a file that spells one of the four relation
 * decorators can produce a rule-A finding, and parsing 2 600 files to learn that
 * is wasted work. It over-matches deliberately (a mention in a comment passes
 * it) — {@link analyzeSource} is the parse that decides.
 */
export const RELATION_DECORATOR_HINT = /@(?:ManyToOne|OneToMany|OneToOne|ManyToMany)\s*[(<]/;

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  const callee = ts.isCallExpression(expr) ? expr.expression : expr;
  return ts.isIdentifier(callee) ? callee.text : undefined;
}

/** Every capitalised identifier appearing anywhere inside the decorator's arguments. */
function referencedTypeNames(decorator: ts.Decorator): string[] {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr)) return [];
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && /^[A-Z]/.test(node.text)) names.push(node.text);
    node.forEachChild(visit);
  };
  for (const arg of expr.arguments) visit(arg);
  return names;
}

/** Map local import name → the file it was imported from, resolved to a `.ts` path. */
function importedFrom(sf: ts.SourceFile, file: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const spec = statement.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    if (!spec.text.startsWith('.')) continue;
    const target = resolve(dirname(file), spec.text.replace(/\.js$/, '.ts'));
    if (!existsSync(target)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) map.set(element.name.text, target);
  }
  return map;
}

export interface RelationFinding {
  readonly file: string;
  readonly className: string;
  readonly property: string;
  readonly decorator: string;
  readonly targetName: string;
  readonly sourceOwner: string;
  readonly targetOwner: string;
}

export function analyzeSource(
  source: string,
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): RelationFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sourceOwner = ownerOf(file, hostResident);
  if (!sourceOwner) return [];
  const imports = importedFrom(sf, file);
  const findings: RelationFinding[] = [];

  sf.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) return;
    const className = node.name?.text ?? '<anonymous>';
    for (const member of node.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      for (const decorator of ts.getDecorators(member) ?? []) {
        const name = decoratorName(decorator);
        if (!name || !RELATION_DECORATORS.has(name)) continue;
        for (const targetName of referencedTypeNames(decorator)) {
          // A target declared in this very file is same-owner by construction.
          const targetFile = imports.get(targetName);
          if (!targetFile) continue;
          const targetOwner = ownerOf(targetFile, hostResident);
          if (!targetOwner) continue;
          findings.push({
            file,
            className,
            property: member.name.getText(sf),
            decorator: name,
            targetName,
            sourceOwner,
            targetOwner,
          });
        }
      }
    }
  });

  return findings;
}

export function findingKey(finding: RelationFinding): string {
  return `${finding.sourceOwner}.${finding.className}.${finding.property} -> ${finding.targetOwner}`;
}

export function isViolation(finding: RelationFinding): boolean {
  const { sourceOwner, targetOwner } = finding;
  if (sourceOwner === targetOwner) return false;
  // A module may point at the platform.
  if (!isPlatformOwner(sourceOwner) && isPlatformOwner(targetOwner)) return false;
  // Everything else — module → other module, and platform → module — is out.
  return true;
}
