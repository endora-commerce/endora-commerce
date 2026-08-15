/**
 * CI check — the kernel boundary (feature 072, D-32 / D-37, data-model §2.1).
 *
 * **Two independent rules over the same principle**, reported in one run: a
 * kernel that depends on a removable module is not a kernel. Rule A polices the
 * ORM; rule B polices import specifiers, which is the mechanism the kernel
 * actually reached into `src/modules/` through.
 *
 * ## Rule A — ORM relations
 *
 *   1. A module MUST NOT declare an ORM relation to an entity owned by another
 *      module. Reaching another module's data is what services and the EventBus
 *      are for; a foreign key makes the two modules one deployable unit and
 *      quietly defeats Principle I.
 *   2. A module MAY declare a relation into the **kernel** — the kernel is the
 *      part every deployment has.
 *   3. The **kernel MUST NOT** relate into a module.
 *
 * There are exactly four cross-module relations in the tree, all to
 * `SalesChannel`, three of them inside the settings entities the kernel absorbs
 * and one in `search`. `SalesChannel` being kernel-owned made all four
 * module→kernel, which is permitted — and this check is what keeps the fifth
 * from appearing.
 *
 * ## Rule B — import specifiers (D-37)
 *
 * No file under `src/kernel/**` may name an import specifier resolving into
 * `src/modules/` or `src/apps/`. `src/apps/` is on the forbidden side because an
 * overlay module is an ordinary lifecycle participant (feature 057) and a
 * decoration is per-deployment code: a kernel that reaches into either is a
 * kernel that differs per deployment. The reverse direction — module→kernel —
 * is always allowed and has no rule.
 *
 * Every shape a specifier can take is seen: `import`, `import type`,
 * `export … from`, dynamic `import()`, `require()` and the inline
 * `import('…').Type` annotation (`ts.ImportTypeNode`).
 *
 * **`import type` is a violation, not an exemption.** Three grounds, in
 * increasing order of weight:
 *
 *   1. Precedent: `check-container-imports.ts` already decides this question the
 *      same way, and one repository should not hold two answers to it.
 *   2. Admitting it hands you a mechanical bypass. Any `import { X }` whose `X`
 *      appears only in signatures can be rewritten `import type { X }` with no
 *      behaviour change — and ESLint's `prefer: 'type-imports'`
 *      (`eslint.config.js`) performs that rewrite automatically. A rule that
 *      admits type-only imports is a rule the linter launders violations past.
 *   3. It is the level D-37 exists for: `@endora-commerce/kernel` must not list
 *      an `@endora-commerce/mod-*` dependency. A type-only import does not erase
 *      from a `package.json` — types must resolve at build time — so it is a
 *      real edge in the artefact even though it is invisible in the bundle.
 *
 * Two deliberate limits, both of them holes a determined violator could use:
 *
 *   - **Direct specifiers only, no transitive closure.**
 *   - **`*.test.ts` under `src/kernel/` is not scanned.** A colocated test may
 *     import a fixture and is not the artefact packaging cares about.
 *
 * **Relative specifiers only, for now.** There is no `@endora-commerce/mod-*`
 * package yet, so a bare specifier cannot reach a module; F4 will need a second
 * predicate over package names. Not built speculatively (Principle IV).
 *
 * Static analysis through the TypeScript compiler API — a specifier mentioned in
 * a comment or a string literal is not a finding; no database, no new
 * dependency. Sits alongside `check-entity-tenant-classification.ts` and
 * `check-container-imports.ts`.
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

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');
const KERNEL_ROOT = join(SRC_ROOT, 'kernel');

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
 * Relations that exist today and are waiting on a relocation, not on a
 * redesign.
 *
 * **Empty, and it must stay that way.** The four entries this list carried
 * between T021 and T019 all pointed at `SalesChannel`; T019 moved that entity
 * into the kernel, so every one of them became module→kernel, which is
 * permitted. An entry here is a debt marker with an owner and a task id, not a
 * standing exemption.
 *
 * It is a **ratchet**: the check fails on a relation that is not on the list
 * *and* on a list entry that no longer describes a relation, so neither adding
 * one nor forgetting to remove one can happen silently.
 */
export const PENDING_RELOCATION: readonly string[] = [];

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

// ---------------------------------------------------------------------------
// Rule B — import specifiers out of `src/kernel/` (D-37)
// ---------------------------------------------------------------------------

/** How the specifier was named. Reported, because it changes how one reads it. */
export type ImportKind = 'import' | 'export' | 'dynamic' | 'require' | 'import-type';

export interface KernelImportFinding {
  /** Absolute path of the importing kernel file. */
  readonly file: string;
  readonly specifier: string;
  /** The specifier resolved against the importing file, `.js` swapped for `.ts`. */
  readonly resolved: string;
  /**
   * The module the specifier reaches, `apps/<deployment>` for per-deployment
   * code outside a module, or `null` when it leaves the kernel for a peer
   * (`src/tenancy/`, `src/http/`, …) — which is allowed.
   */
  readonly targetOwner: string | null;
  /** What the import takes: a reviewer's first question is shape or behaviour. */
  readonly bindings: readonly string[];
  readonly kind: ImportKind;
  readonly line: number;
}

/**
 * The module a resolved path belongs to, or `apps/<deployment>` for
 * per-deployment code that is not inside an overlay module.
 *
 * Both module roots are recognised, as `moduleOf` in `check-container-imports.ts`
 * does; `ownerOf` above is deliberately left alone, since it serves the relation
 * rule and answers `null` for an overlay.
 */
export function forbiddenOwnerOf(resolvedPath: string): string | null {
  const overlayModule = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(resolvedPath);
  if (overlayModule) return overlayModule[1] ?? null;
  const coreModule = /\/src\/modules\/([^/]+)\//.exec(resolvedPath);
  if (coreModule) return coreModule[1] ?? null;
  const deployment = /\/src\/apps\/([^/]+)\//.exec(resolvedPath);
  if (deployment) return deployment[1] === undefined ? null : `apps/${deployment[1]}`;
  return null;
}

function importBindings(node: ts.Node): string[] {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return [];
    const names: string[] = [];
    if (clause.name) names.push(clause.name.text);
    const bound = clause.namedBindings;
    if (bound) {
      if (ts.isNamespaceImport(bound)) names.push(`* as ${bound.name.text}`);
      else for (const element of bound.elements) names.push(element.name.text);
    }
    return names;
  }
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    if (!clause) return ['*'];
    if (ts.isNamespaceExport(clause)) return [`* as ${clause.name.text}`];
    return clause.elements.map((element) => element.name.text);
  }
  return [];
}

/**
 * Every relative import in `source` that leaves `src/kernel/`.
 *
 * Findings include the allowed ones (a peer of the kernel), so the summary can
 * report both counts and `--list` can tag each; {@link isImportViolation} is what
 * partitions them. Returns nothing for a file outside the kernel — the
 * module→kernel direction is not this rule's business.
 *
 * The target is **not** gated on existing on disk: a kernel file importing a
 * path that no longer exists must fail loudly, not pass silently.
 */
export function analyzeKernelImports(source: string, file: string): KernelImportFinding[] {
  if (!file.includes('/src/kernel/')) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: KernelImportFinding[] = [];

  const record = (
    specifier: ts.StringLiteralLike,
    kind: ImportKind,
    bindings: readonly string[],
  ): void => {
    const text = specifier.text;
    if (!text.startsWith('.')) return;
    const resolved = resolve(dirname(file), text.replace(/\.js$/, '.ts'));
    if (resolved.startsWith(`${KERNEL_ROOT}/`)) return;
    findings.push({
      file,
      specifier: text,
      resolved,
      targetOwner: forbiddenOwnerOf(resolved),
      bindings,
      kind,
      line: sf.getLineAndCharacterOfPosition(specifier.getStart(sf)).line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(
        node.moduleSpecifier,
        ts.isImportDeclaration(node) ? 'import' : 'export',
        importBindings(node),
      );
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const [first] = node.arguments;
      if ((isDynamicImport || isRequire) && first && ts.isStringLiteral(first)) {
        record(first, isDynamicImport ? 'dynamic' : 'require', []);
      }
    }
    // `import('…').Type` — erased by tsc, encouraged by the repo's own ESLint
    // config (`disallowTypeAnnotations: false`), and invisible to a check that
    // only walks import declarations.
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        record(argument.literal, 'import-type', node.qualifier ? [node.qualifier.getText(sf)] : []);
      }
    }
    node.forEachChild(visit);
  };

  sf.forEachChild(visit);
  return findings;
}

/**
 * Kernel→module imports that exist today and are waiting on a **decision**, not
 * on a file move.
 *
 * A ratchet, exactly like {@link PENDING_RELOCATION}: an import that is not here
 * fails the build, *and* an entry here that no longer describes an import fails
 * the build. Neither adding one nor forgetting to remove one can happen
 * silently.
 *
 * An entry is a debt with an owner, never a standing exemption. The key is
 * `<kernel file, relative to backend/>:<specifier> -> <owning module>`; the
 * value is why it is still here and what dissolves it. Keyed on the specifier
 * and not only on the file so that a file which acquires a *second* import of
 * the same module fails, and so that a partial drain — D-37 dissolves these one
 * relocation at a time — is visible commit by commit.
 */
export const KERNEL_MODULE_IMPORTS_TO_DRAIN: Readonly<Record<string, string>> = {
  'src/kernel/module-context.ts:../modules/_lifecycle/plugin-helpers.js -> _lifecycle':
    'The three gating wrappers `ModuleContext` applies to every module route, ' +
    'worker and subscriber. Platform infrastructure sitting in a module; D-37 A1 ' +
    'relocates the file to `src/kernel/lifecycle/`. Owner: D-37 A1, commit C5.',
  'src/kernel/ports/provide.ts:../../modules/_lifecycle/plugin-helpers.js -> _lifecycle':
    '`ModuleDisabledError`, thrown by the port gate itself. Same file, same ' +
    'relocation. Owner: D-37 A1, commit C5.',
  'src/kernel/ports/organizations.ts:../../modules/organizations/entities/organization.entity.js -> organizations':
    'Type-only. `OrganizationReadPort` types all three of its methods with the ' +
    '`Organization` entity class, so the kernel borrows a shape it does not own ' +
    '(D-32 says it owns only the shape — for this port that is not yet true). ' +
    'Dissolving it is a design decision with a 23-module blast radius: either the ' +
    'kernel declares a structural `OrganizationSnapshot`, or the entity follows ' +
    '`SalesChannel` into the kernel. Owner: F3/F4 packaging. Not D-37 A1.',
};

/** `src/kernel/ports/provide.ts` — the key's file half, stable across an unrelated edit. */
function backendRelative(file: string): string {
  return file.startsWith(`${BACKEND_ROOT}/`) ? file.slice(BACKEND_ROOT.length + 1) : file;
}

export function importFindingKey(finding: KernelImportFinding): string {
  return `${backendRelative(finding.file)}:${finding.specifier} -> ${finding.targetOwner}`;
}

/** A kernel file naming a specifier that resolves into a module or a deployment. */
export function isImportViolation(finding: KernelImportFinding): boolean {
  return finding.targetOwner !== null;
}

export function isDraining(finding: KernelImportFinding): boolean {
  return KERNEL_MODULE_IMPORTS_TO_DRAIN[importFindingKey(finding)] !== undefined;
}

/** Entries of the ledger that no longer describe an import in the tree. */
export function staleDraining(findings: readonly KernelImportFinding[]): string[] {
  const present = new Set(findings.filter(isImportViolation).map(importFindingKey));
  return Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN).filter((key) => !present.has(key));
}

/** Every `.ts` under `dir` except colocated tests — see the header on that hole. */
function walkKernel(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walkKernel(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  const findings = files.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
  const violations = findings.filter((f) => isViolation(f) && !isPending(f));
  const pending = findings.filter((f) => isViolation(f) && isPending(f));
  const stale = stalePending(findings);
  const rel = (p: string): string => p.replace(`${SRC_ROOT}/`, 'src/');

  const kernelFiles = walkKernel(KERNEL_ROOT);
  const outward = kernelFiles.flatMap((f) => analyzeKernelImports(readFileSync(f, 'utf8'), f));
  const intoModules = outward.filter(isImportViolation);
  const importViolations = intoModules.filter((f) => !isDraining(f));
  const draining = intoModules.filter(isDraining);
  const staleImports = staleDraining(outward);

  if (listMode) {
    for (const f of findings.filter((x) => x.sourceOwner !== x.targetOwner)) {
      const tag = !isViolation(f) ? 'allowed  ' : isPending(f) ? 'pending  ' : 'FORBIDDEN';
      console.log(
        `${tag} ${f.sourceOwner} → ${f.targetOwner}: ` +
          `${f.className}.${f.property} @${f.decorator}(${f.targetName})  (${rel(f.file)})`,
      );
    }
    console.log('');
    for (const f of intoModules) {
      const tag = isDraining(f) ? 'draining ' : 'FORBIDDEN';
      console.log(`${tag} kernel → ${f.targetOwner}: ${rel(f.file)}:${f.line} ${f.specifier}`);
    }
    console.log('');
  }

  console.log(
    `[kernel-boundary] entity files=${files.length} relations=${findings.length} ` +
      `violations=${violations.length} pending-relocation=${pending.length}`,
  );
  console.log(
    `[kernel-boundary] kernel files=${kernelFiles.length} outward-imports=${outward.length} ` +
      `into-modules=${intoModules.length} violations=${importViolations.length} ` +
      `draining=${draining.length}`,
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

  if (importViolations.length > 0) {
    console.error(
      '\nKernel files importing from src/modules/ or src/apps/. The kernel owns shapes and ' +
        'platform infrastructure; a kernel that depends on a removable module is not a kernel ' +
        '(docs/docs/architecture/kernel.md § The boundary). Move the shape into src/kernel/, ' +
        'or declare it in KERNEL_MODULE_IMPORTS_TO_DRAIN with a reason and an owner:',
    );
    for (const f of importViolations) {
      console.error(`  - ${rel(f.file)}:${f.line} -> ${f.targetOwner}`);
      console.error(
        `      ${f.kind} { ${f.bindings.join(', ')} } from '${f.specifier}'`.replace('{  }', '{}'),
      );
    }
  }

  if (staleImports.length > 0) {
    console.error(
      '\nKERNEL_MODULE_IMPORTS_TO_DRAIN names imports that no longer exist — delete these ' +
        'entries:',
    );
    for (const key of staleImports) console.error(`  - ${key}`);
  }

  const failures =
    violations.length + stale.length + importViolations.length + staleImports.length;
  process.exit(failures === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
