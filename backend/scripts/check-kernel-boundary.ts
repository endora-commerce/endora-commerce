/**
 * CI check — the kernel boundary (feature 072, D-32 / D-37 / D-53, data-model §2.1).
 *
 * **Three independent rules over the same principle**, reported in one run: a
 * kernel that depends on a removable module is not a kernel. Rule A polices the
 * ORM; rules B and C police import specifiers, which is the mechanism the kernel
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
 * The scan is over **every** `.ts` under `src/` that spells a relation
 * decorator, not over `*.entity.ts`. Nothing in the repository enforces that
 * suffix, so scoping the rule to it made the rule's reach a filename
 * convention: a relation declared in an ordinary file was not refused, it was
 * never read (issue #113).
 *
 * ## Rule B — import specifiers, over the platform roots (D-37, widened by D-53)
 *
 * No file under a **platform root** — `src/kernel`, `src/http`, `src/events`,
 * `src/tenancy` ({@link PLATFORM_ROOTS}) — may name an import specifier
 * resolving into `src/modules/` or `src/apps/`. `src/apps/` is on the forbidden
 * side because an overlay module is an ordinary lifecycle participant (feature
 * 057) and a decoration is per-deployment code: a kernel that reaches into
 * either is a kernel that differs per deployment. The reverse direction —
 * module→platform — is always allowed and has no rule.
 *
 * The three peers are on the list because the kernel cannot compile without
 * them: five kernel entities take `@GlobalEntity()` from `src/tenancy` and four
 * kernel files take `HttpError` from `src/http` as a **value**. A dependency the
 * kernel cannot compile without, which is itself permitted to import a module,
 * is a kernel that imports modules with one extra hop — in package terms the
 * cycle `kernel → http → mod-i18n → kernel`, and F4's stated precondition is
 * that packages are not cyclic (D-52).
 *
 * `src/db`, `src/overlay` and `src/commands` are deliberately **not** roots:
 * `src/db` names every module by construction and F2 of the packaging roadmap
 * replaces it with a generator, `src/overlay` is per-deployment resolution, and
 * `src/commands` sits *above* the kernel rather than under it — it already
 * satisfies the rule, and D-57 leaves its package home to F4.
 *
 * ## Rule C — the kernel's transitive closure (D-53)
 *
 * No file in the transitive relative-import closure of `src/kernel/**` may name
 * such a specifier, however many hops from the kernel it sits.
 *
 * **B and C are deliberately not redundant, and each covers the other's blind
 * spot.** B is a list — and issue #92 exists precisely because a peer was never
 * put on a list. C has no list to forget, but it is blind to the six peer files
 * the kernel does not currently reach, which is exactly where a future defect
 * lands unnoticed. B's message names a line; C's names a chain, so an edge under
 * a platform root is reported by both — once as the line that wrote it, once as
 * the path that reaches it.
 *
 * C stops at the module boundary: the edge is the violation, and what lies
 * behind it is that module's own graph.
 *
 * **Prose was tried first, and it did not hold.** `kernel/index.ts:3`,
 * `tenancy/index.ts:3` and `http/interceptors/registry.ts:12` all state this
 * rule in a header comment; all three were true, all three were unenforced, and
 * the one file that broke it (`http/error-envelope.ts`, importing `_i18n`'s
 * error-translation map) broke it anyway. The measured cost of enforcement was
 * one injected option and one structural type; at that price, prose is not a
 * trade-off, it is an omission.
 *
 * Every shape a specifier can take is seen: `import`, `import type`,
 * `export … from`, dynamic `import()`, `require()` and the inline
 * `import('…').Type` annotation (`ts.ImportTypeNode`). The walker itself lives
 * in `scripts/lib/specifiers.ts` since feature 075, shared with
 * `check-module-boundary.ts`, which polices the opposite direction across the
 * same boundary: two independently written walkers drift, and the shape one
 * forgets is the shape the next violation uses.
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
 * One deliberate limit remains, and it is a hole a determined violator could
 * use: **`*.test.ts` under a platform root is not scanned.** A colocated test
 * may import a fixture and is not the artefact packaging cares about.
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
import { namedSpecifiers, type SpecifierKind } from './lib/specifiers.js';
import {
  loadRegisteredModuleIds,
  modulePopulationCoverage,
  vacuousModulePopulation,
  type ModulePopulationCoverage,
} from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';
import { requireModuleLayout } from './lib/module-roots.js';

const RELATION_DECORATORS = new Set(['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany']);

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The platform roots rule B walks (D-53): the kernel and the three peers it
 * cannot compile without. Order is the reporting order, `kernel` first.
 */
export const PLATFORM_ROOTS = ['kernel', 'http', 'events', 'tenancy'] as const;
export type PlatformRoot = (typeof PLATFORM_ROOTS)[number];

/**
 * Which platform root owns `file`, or `null` for anything outside all four.
 *
 * `platformRoot` is the directory holding them and is passed in rather than
 * matched by name (the relocation). It used to be a `/src/<root>/` substring
 * test, which after the move matched two trees: the platform's own sources in
 * `@endora-commerce/platform`, and the re-export shims left at the old
 * `backend/src/<root>/` paths. Reading the shims as platform files is not a
 * missed finding but a wrong one — every shim names the package's build output,
 * so rule B saw 63 outward imports where the platform has 25.
 */
export function platformRootOf(file: string, platformRoot: string): PlatformRoot | null {
  return PLATFORM_ROOTS.find((root) => file.startsWith(`${join(platformRoot, root)}/`)) ?? null;
}

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
// Rule B — import specifiers out of a platform root (D-37, widened by D-53)
// ---------------------------------------------------------------------------

/** How the specifier was named. Reported, because it changes how one reads it. */
export type ImportKind = 'import' | 'export' | 'dynamic' | 'require' | 'import-type';

export interface PlatformImportFinding {
  /** Absolute path of the importing platform-root file. */
  readonly file: string;
  readonly specifier: string;
  /** The specifier resolved against the importing file, `.js` swapped for `.ts`. */
  readonly resolved: string;
  /**
   * The module the specifier reaches, `apps/<deployment>` for per-deployment
   * code outside a module, or `null` when it leaves its own root for another
   * platform root (`src/tenancy/`, `src/http/`, …) — which is allowed.
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

/**
 * The shared walker's eight shapes collapsed onto this script's five.
 *
 * Rules B and C report *where* a specifier points and only mention how it was
 * written, so the four spellings of an import declaration read as one here. The
 * distinction the shared walker keeps is what `check-module-boundary.ts` needs:
 * its red proofs assert one shape each, and `import type` versus
 * `import { type A, B }` is precisely the pair a first-token classifier
 * confuses.
 */
function reportedKind(kind: SpecifierKind): ImportKind {
  switch (kind) {
    case 're-export':
      return 'export';
    case 'dynamic-import':
      return 'dynamic';
    case 'require-call':
      return 'require';
    case 'import-type-node':
      return 'import-type';
    default:
      return 'import';
  }
}

/** A relative specifier resolved against the importing file, `.js` swapped for `.ts`. */
function resolveSpecifier(file: string, specifier: string): string {
  return resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
}

/**
 * Every relative import in `source` that leaves its own platform root.
 *
 * Findings include the allowed ones (another platform root), so the summary can
 * report both counts and `--list` can tag each; {@link isImportViolation} is what
 * partitions them. Returns nothing for a file outside every platform root — the
 * module→platform direction is not this rule's business, and neither `src/db`
 * nor `src/commands` is a root (D-57).
 *
 * The target is **not** gated on existing on disk: a platform file importing a
 * path that no longer exists must fail loudly, not pass silently.
 */
export function analyzePlatformImports(
  source: string,
  file: string,
  platformRoot: string,
): PlatformImportFinding[] {
  const root = platformRootOf(file, platformRoot);
  if (!root) return [];
  const ownRoot = join(platformRoot, root);

  return namedSpecifiers(source, file).flatMap((specifier) => {
    if (!specifier.text.startsWith('.')) return [];
    const resolved = resolveSpecifier(file, specifier.text);
    // Inside its own root the import is internal, whichever root that is.
    if (resolved.startsWith(`${ownRoot}/`)) return [];
    return [
      {
        file,
        specifier: specifier.text,
        resolved,
        targetOwner: forbiddenOwnerOf(resolved),
        bindings: specifier.bindings,
        kind: reportedKind(specifier.kind),
        line: specifier.line,
      },
    ];
  });
}

/**
 * Platform→module imports that exist today and are waiting on a **decision**,
 * not on a file move.
 *
 * A ratchet, exactly like {@link PENDING_RELOCATION}: an import that is not here
 * fails the build, *and* an entry here that no longer describes an import fails
 * the build. Neither adding one nor forgetting to remove one can happen
 * silently. It covers both import rules, since both key a finding the same way.
 *
 * An entry is a debt with an owner, never a standing exemption. The key is
 * `<file, relative to backend/>:<specifier> -> <owning module>`; the value is
 * why it is still here and what dissolves it. Keyed on the specifier and not
 * only on the file so that a file which acquires a *second* import of the same
 * module fails, and so that a partial drain is visible commit by commit.
 *
 * **It is empty, which is the strongest form of the assertion.** D-37 A1 seeded
 * four entries and dissolved three by relocating the presence machinery. The
 * survivor was `kernel/ports/organizations.ts` type-importing the `Organization`
 * entity, escalated rather than fixed because both available answers were
 * D-32-scale; D-55 settled it with a structural `OrganizationSnapshot` typed on
 * `@endora-commerce/contracts`' existing status union, at a cost of one file. The name stays
 * `KERNEL_…` because the kernel is what the ledger protects, but rule B's roots
 * are all four platform roots, so a peer's debt would be keyed here too.
 * `test/unit/kernel/boundary-check.test.ts` pins it empty, so an entry cannot
 * arrive by habit.
 */
export const KERNEL_MODULE_IMPORTS_TO_DRAIN: Readonly<Record<string, string>> = {};

/**
 * `src/kernel/ports/provide.ts` — the key's file half, stable across an
 * unrelated edit.
 *
 * Two bases since the relocation, in the idiom of `layout.displayOf`: a file
 * inside `backend/` keeps its `src/…` spelling, and the platform's own sources
 * — which are `@endora-commerce/platform`'s and outside it — are named relative
 * to the repository. Without the second base an absolute path from one
 * developer's checkout would go into a ledger key and into every message.
 */
function backendRelative(file: string): string {
  if (file.startsWith(`${BACKEND_ROOT}/`)) return file.slice(BACKEND_ROOT.length + 1);
  const repoRoot = join(BACKEND_ROOT, '..');
  return file.startsWith(`${repoRoot}/`) ? file.slice(repoRoot.length + 1) : file;
}

export function importFindingKey(finding: {
  readonly file: string;
  readonly specifier: string;
  readonly targetOwner: string | null;
}): string {
  return `${backendRelative(finding.file)}:${finding.specifier} -> ${finding.targetOwner}`;
}

/** A platform file naming a specifier that resolves into a module or a deployment. */
export function isImportViolation(finding: PlatformImportFinding): boolean {
  return finding.targetOwner !== null;
}

export function isDraining(finding: {
  readonly file: string;
  readonly specifier: string;
  readonly targetOwner: string | null;
}): boolean {
  return KERNEL_MODULE_IMPORTS_TO_DRAIN[importFindingKey(finding)] !== undefined;
}

/**
 * Entries of the ledger that no longer describe an import in the tree.
 *
 * `extraKeys` carries rule C's violations, which are keyed identically — an
 * entry covering a closure edge must not read as stale just because rule B's
 * roots do not reach the file that wrote it.
 */
export function staleDraining(
  findings: readonly PlatformImportFinding[],
  extraKeys: readonly string[] = [],
): string[] {
  const present = new Set([...findings.filter(isImportViolation).map(importFindingKey), ...extraKeys]);
  return Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN).filter((key) => !present.has(key));
}

// ---------------------------------------------------------------------------
// Rule C — the kernel's transitive import closure (D-53)
// ---------------------------------------------------------------------------

export interface ClosureViolation {
  /**
   * The shortest import path from a `src/kernel/**` file to the module file,
   * inclusive of both ends and relative to `backend/`. This is what rule C adds
   * over rule B: the offending line belongs to one file, but the reason it
   * matters is the chain that reaches it from the kernel.
   */
  readonly chain: readonly string[];
  /** Absolute path of the file that names the specifier — the chain's last hop. */
  readonly file: string;
  readonly specifier: string;
  readonly resolved: string;
  readonly targetOwner: string;
  readonly bindings: readonly string[];
  readonly kind: ImportKind;
  readonly line: number;
}

export interface ClosureInput {
  /** Where the closure starts: every `src/kernel/**` file in the real run. */
  readonly roots: readonly string[];
  /** Reads a file, or answers `null` when it is not on disk. */
  readonly read: (file: string) => string | null;
}

export interface ClosureResult {
  /** Every file reached, relative to `backend/` — the closure, as a number. */
  readonly files: readonly string[];
  readonly violations: readonly ClosureViolation[];
}

/**
 * Walk the relative-import closure of `roots` and report every edge that leaves
 * it for `src/modules/` or `src/apps/`.
 *
 * Breadth-first, so the reported chain is a shortest one and a file is walked
 * once however many roots reach it. The walk **stops at the module boundary**:
 * the edge is the violation, and what lies behind it is that module's own graph,
 * which the kernel neither owns nor is answerable for.
 *
 * Disk access is injected rather than performed, so the rule's own test can go
 * red on a two-hop chain the real tree does not contain.
 */
export function analyzeClosure(input: ClosureInput): ClosureResult {
  const violations: ClosureViolation[] = [];
  const cameFrom = new Map<string, string>();
  const seen = new Set<string>(input.roots);
  const queue = [...seen];

  const chainTo = (file: string): string[] => {
    const chain = [file];
    for (let at = cameFrom.get(file); at !== undefined; at = cameFrom.get(at)) chain.unshift(at);
    return chain.map(backendRelative);
  };

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) break;
    const source = input.read(file);
    if (source === null) continue;

    for (const specifier of namedSpecifiers(source, file)) {
      if (!specifier.text.startsWith('.')) continue;
      const resolved = resolveSpecifier(file, specifier.text);
      const targetOwner = forbiddenOwnerOf(resolved);
      if (targetOwner !== null) {
        violations.push({
          chain: [...chainTo(file), backendRelative(resolved)],
          file,
          specifier: specifier.text,
          resolved,
          targetOwner,
          bindings: specifier.bindings,
          kind: reportedKind(specifier.kind),
          line: specifier.line,
        });
        continue;
      }
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      cameFrom.set(resolved, file);
      queue.push(resolved);
    }
  }

  return { files: [...seen].map(backendRelative), violations };
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

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Rule A's population is both roots, derived (feature 080, T040a); rules B
  // and C stay inside the application, because the platform roots are the
  // application's own and a package is never one of them.
  const layout = await requireModuleLayout('[kernel-boundary]');
  const files = layout.sourceRoots.flatMap((root) => collectSources(root));
  const relationFiles = files.filter((f) => RELATION_DECORATOR_HINT.test(readFileSync(f, 'utf8')));
  const findings = relationFiles.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
  const violations = findings.filter((f) => isViolation(f) && !isPending(f));
  const pending = findings.filter((f) => isViolation(f) && isPending(f));
  const stale = stalePending(findings);
  const rel = layout.displayOf;

  // Rules B and C walk the platform's own sources, wherever the workspace says
  // they are. `null` is a stop and not an empty population: the whole of rules B
  // and C is the platform, so a run without it would report `violations=0` over
  // nothing (issue #113).
  const platformRoot = layout.platformRoot;
  if (platformRoot === null) {
    console.error(
      '[kernel-boundary] no workspace member declares `endora.type: "platform"` — rules B ' +
        'and C have no population, and a pass over none is not a pass',
    );
    process.exit(2);
  }
  const platformFiles = PLATFORM_ROOTS.flatMap((root) => walkKernel(join(platformRoot, root)));
  const outward = platformFiles.flatMap((f) =>
    analyzePlatformImports(readFileSync(f, 'utf8'), f, platformRoot),
  );
  const intoModules = outward.filter(isImportViolation);
  const importViolations = intoModules.filter((f) => !isDraining(f));
  const draining = intoModules.filter(isDraining);

  const closure = analyzeClosure({
    roots: walkKernel(join(platformRoot, 'kernel')),
    read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
  });
  const closureViolations = closure.violations.filter((v) => !isDraining(v));
  const closureDraining = closure.violations.filter(isDraining);
  const staleImports = staleDraining(outward, closure.violations.map(importFindingKey));

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
      console.log(
        `${tag} ${platformRootOf(f.file, platformRoot)} → ${f.targetOwner}: ` +
          `${rel(f.file)}:${f.line} ${f.specifier}`,
      );
    }
    console.log('');
    for (const v of closure.violations) {
      const tag = isDraining(v) ? 'draining ' : 'FORBIDDEN';
      console.log(`${tag} closure → ${v.targetOwner}: ${v.chain.join(' → ')}`);
    }
    console.log('');
  }

  // A green run must mean "nothing found", never "nothing looked at". Each of
  // the three rules has its own file list, and each can be emptied by an
  // unrelated edit — a moved directory, a renamed root, a walk that stops
  // matching. Exit 2 rather than 0 when one of them comes back empty.
  //
  // Rule A's list needed a fourth reason (issue #215). It is the whole of
  // `src/`, and `src/` minus `src/modules` is still 105 files — so a moved
  // module tree left it non-empty, and the relation sweep reported
  // `violations=0` over a tree holding none of the relations it polices. The
  // expectation is one source per registered module, derived from the manifest
  // index; an index that cannot be read is itself a reason, because the floor
  // would otherwise be silently absent.
  const vacuous: string[] = [];
  let coverage: ModulePopulationCoverage | null = null;
  if (files.length === 0) vacuous.push('no sources under src/ (rule A)');
  else {
    try {
      const population = {
        registered: await loadRegisteredModuleIds(layout.manifestIndexPath),
        files,
        moduleIdOf: layout.moduleIdOfPath,
      };
      const reason = vacuousModulePopulation(population);
      if (reason !== null) vacuous.push(`${reason} (rule A)`);
      // Kept for the read line below, so the corroboration this already
      // enforces is also disclosed on a run that passes it (issue #244).
      coverage = modulePopulationCoverage(population);
    } catch (error: unknown) {
      vacuous.push(
        `the module index at ${layout.manifestIndexPath} could not be read: ${String(error)}`,
      );
    }
  }
  if (platformFiles.length === 0) vacuous.push('no files under the platform roots (rule B)');
  if (closure.files.length === 0) vacuous.push('empty kernel import closure (rule C)');
  if (vacuous.length > 0) {
    console.error(
      `[kernel-boundary] ${vacuous.join('; ')} — refusing to report a vacuous pass`,
    );
    process.exit(2);
  }

  // What was read, in the shared grammar (issue #244). Three rules, one walk:
  // `files` is every source the run opened — rule B's platform files and rule
  // C's closure are subsets of it, and both are on their own lines below — and
  // `sites` is the units judged, the ORM relations of rule A plus the outward
  // imports of rule B.
  reportReadSize({
    prefix: '[kernel-boundary]',
    files: files.length,
    sites: findings.length + outward.length,
    coverage: coverage === null ? [] : [coverage],
  });
  console.log(
    `[kernel-boundary] sources=${files.length} relation files=${relationFiles.length} ` +
      `relations=${findings.length} ` +
      `violations=${violations.length} pending-relocation=${pending.length}`,
  );
  console.log(
    `[kernel-boundary] platform files=${platformFiles.length} outward-imports=${outward.length} ` +
      `into-modules=${intoModules.length} violations=${importViolations.length} ` +
      `draining=${draining.length}`,
  );
  console.log(
    `[kernel-boundary] closure files=${closure.files.length} ` +
      `into-modules=${closure.violations.length} violations=${closureViolations.length} ` +
      `draining=${closureDraining.length}`,
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
      '\nRule B — a platform file (src/kernel, src/http, src/events, src/tenancy) importing ' +
        'from src/modules/ or src/apps/. The platform owns shapes and infrastructure; a kernel ' +
        'that depends on a removable module is not a kernel, and neither is one whose peer does ' +
        '(docs/docs/architecture/kernel.md § The boundary). Move the shape into src/kernel/, ' +
        'take it by injection from the composition root, or declare it in ' +
        'KERNEL_MODULE_IMPORTS_TO_DRAIN with a reason and an owner:',
    );
    for (const f of importViolations) {
      console.error(`  - ${rel(f.file)}:${f.line} -> ${f.targetOwner}`);
      console.error(
        `      ${f.kind} { ${f.bindings.join(', ')} } from '${f.specifier}'`.replace('{  }', '{}'),
      );
    }
  }

  if (closureViolations.length > 0) {
    console.error(
      "\nRule C — the kernel reaches a module through its imports. Rule B names the line that " +
        'wrote the import; this names the chain that carries it back to the kernel, which is ' +
        'what makes it a package cycle. Break any hop:',
    );
    for (const v of closureViolations) {
      console.error(`  - ${v.chain.join(' -> ')}`);
      console.error(
        `      ${rel(v.file)}:${v.line}  ${v.kind} { ${v.bindings.join(', ')} } ` +
          `from '${v.specifier}'`.replace('{  }', '{}'),
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
    violations.length +
    stale.length +
    importViolations.length +
    closureViolations.length +
    staleImports.length;
  process.exit(failures === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
