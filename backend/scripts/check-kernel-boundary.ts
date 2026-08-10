/**
 * CI check — the kernel boundary (feature 072, D-32 / data-model §2.1).
 *
 * One rule, in three parts:
 *
 *   1. A module MUST NOT declare an ORM relation to an entity owned by another
 *      module. Reaching another module's data is what services and the EventBus
 *      are for; a foreign key makes the two modules one deployable unit and
 *      quietly defeats Principle I.
 *   2. A module MAY declare a relation into the **kernel** — the kernel is the
 *      part every deployment has.
 *   3. The **kernel MUST NOT** relate into a module. A kernel that depends on a
 *      removable module is not a kernel.
 *
 * The rule is satisfied today by accident, not by enforcement: there are exactly
 * four cross-module relations in the tree, all to `SalesChannel`, three of them
 * inside the settings entities the kernel absorbs and one in `search`. Once
 * `SalesChannel` is kernel-owned all four become module→kernel, which is
 * permitted — and this check is what keeps the fifth from appearing.
 *
 * Static analysis through the TypeScript compiler API; no database, no new
 * dependency. Sits alongside `check-entity-tenant-classification.ts`.
 *
 * Usage: `tsx scripts/check-kernel-boundary.ts [--list]`
 * Exit 0 = no violation; exit 1 = at least one.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const RELATION_DECORATORS = new Set(['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany']);

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * Who owns the entity declared in `file`: a module id, `kernel`, or `core` for
 * the entities that predate the module split and live under `src/db`.
 */
export function ownerOf(file: string): string | null {
  const moduleMatch = /\/src\/modules\/([^/]+)\//.exec(file);
  if (moduleMatch) return moduleMatch[1] ?? null;
  if (file.includes('/src/kernel/')) return 'kernel';
  if (file.includes('/src/db/')) return 'core';
  return null;
}

/** `kernel` and `core` are the parts every deployment has; a module may point at them. */
function isPlatformOwner(owner: string): boolean {
  return owner === 'kernel' || owner === 'core';
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.entity.ts')) {
      out.push(full);
    }
  }
  return out;
}

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

export function analyzeSource(source: string, file: string): RelationFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sourceOwner = ownerOf(file);
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
          const targetOwner = ownerOf(targetFile);
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

/**
 * The relations that exist today and are waiting on a relocation, not on a
 * redesign. Every one of them points at `SalesChannel`, which T019 moves into
 * the kernel; the moment it lands all four become module→kernel, which is
 * permitted, and this list goes away with it.
 *
 * It is a **ratchet, not an exemption**: the check fails if the list shrinks
 * without being edited, and fails on any relation not on it. Nothing can be
 * added here without saying so in a diff.
 */
const PENDING_RELOCATION: readonly string[] = [
  'search.SearchPhraseRecord.salesChannel -> sales_channels',
  'settings.Setting.salesChannels -> sales_channels',
  'settings.SettingGroup.salesChannels -> sales_channels',
  'settings.SettingValue.salesChannel -> sales_channels',
];

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

export function isPending(finding: RelationFinding): boolean {
  return PENDING_RELOCATION.includes(findingKey(finding));
}

/** Entries of the pending list that no longer describe a relation in the tree. */
export function stalePending(findings: readonly RelationFinding[]): string[] {
  const present = new Set(findings.filter(isViolation).map(findingKey));
  return PENDING_RELOCATION.filter((key) => !present.has(key));
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  const findings = files.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
  const violations = findings.filter((f) => isViolation(f) && !isPending(f));
  const pending = findings.filter((f) => isViolation(f) && isPending(f));
  const stale = stalePending(findings);
  const rel = (p: string): string => p.replace(`${SRC_ROOT}/`, 'src/');

  if (listMode) {
    for (const f of findings.filter((x) => x.sourceOwner !== x.targetOwner)) {
      const tag = !isViolation(f) ? 'allowed  ' : isPending(f) ? 'pending  ' : 'FORBIDDEN';
      console.log(
        `${tag} ${f.sourceOwner} → ${f.targetOwner}: ` +
          `${f.className}.${f.property} @${f.decorator}(${f.targetName})  (${rel(f.file)})`,
      );
    }
    console.log('');
  }

  console.log(
    `[kernel-boundary] entity files=${files.length} relations=${findings.length} ` +
      `violations=${violations.length} pending-relocation=${pending.length}`,
  );

  if (violations.length > 0) {
    console.error(
      '\nForbidden ORM relations (a module may relate into the kernel, never into another ' +
        'module; the kernel may relate into neither):',
    );
    for (const f of violations) {
      console.error(
        `  - ${f.sourceOwner} → ${f.targetOwner}: ${f.className}.${f.property} ` +
          `@${f.decorator}(${f.targetName})  (${rel(f.file)})`,
      );
    }
  }

  if (stale.length > 0) {
    console.error(
      '\nPENDING_RELOCATION names relations that no longer exist — delete these entries:',
    );
    for (const key of stale) console.error(`  - ${key}`);
  }

  process.exit(violations.length === 0 && stale.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
