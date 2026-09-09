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
 * No file under a **platform root** may name an import specifier that reaches a
 * module. Two spellings, because a module has two addresses: a **relative**
 * specifier resolving into `src/modules/` or `src/apps/`, and the **bare** npm
 * name of a module package. `src/apps/` is on the forbidden side because an
 * overlay module is an ordinary lifecycle participant (feature 057) and a
 * decoration is per-deployment code: a platform that reaches into either is a
 * platform that differs per deployment. The reverse direction —
 * module→platform — is always allowed and has no rule.
 *
 * ### The roots are derived, and every directory of the platform is one
 *
 * {@link platformRootsOf} lists the directories of the platform member's own
 * source root — the member declaring `endora: { type: "platform" }`, located by
 * `lib/platform-root.ts` — so the platform is judged whole and the next
 * directory is judged by existing. It was a four-element literal until
 * `specs/110-instance-repository/` T118a, and the tree grew past it: fourteen
 * directories against four roots, so ten of them — `cli`, `commands`,
 * `composition`, `db`, `demo`, `env`, `lifecycle`, `migrations`, `overlay`,
 * `packages` — were outside D-52/D-53 entirely, and a `@endora-commerce/mod-*`
 * import in `composition/` was refused by nothing in the estate.
 * `check:platform-surface` judges reaches *into* the platform and
 * `check:module-boundary`'s populations are the module walk roots and the admin
 * host, so neither of them covers the direction this rule exists for.
 *
 * **Why the directories and not the `exports` map**, which is the other
 * derivation available and is already read here as the corroborating source. The
 * map answers *what may a consumer name*, which is reachability; this rule's
 * question is *what is the platform*, which is membership of the artefact. The
 * two came apart the moment they were measured: `src/demo/` (feature 113, D-209)
 * has no subpath of its own — its own barrel says so, and cites D-52/D-53 three
 * lines later as the reason nothing in it imports a module — so keying the
 * boundary on the map would leave outside it the one directory that states the
 * prohibition in its own header. The map also fails **open**: a directory added
 * without an entry enlarges the unjudged set silently, which is how the four
 * became ten. Two further candidates and what each gets wrong: the **barrels**
 * (a directory holding `index.ts`) agree with the directories today by
 * coincidence, and are a population defined by the presence of a habit — issue
 * #244's shape, where a directory without a barrel drops out with no error; and
 * `tsconfig.build.json`'s `include` reads `["src/**\/*"]`, so it declares the
 * whole tree and discriminates nothing, and parsing it would add a reader for a
 * constant answer.
 *
 * The map is kept as the **independent second author** on the `read:` line
 * (`platform-subpaths:<covered>/<declared>`): every subpath the package
 * publishes must name a directory this walk produced, and one that does not is
 * exit 2, because a published subpath the walk cannot see is a walk that has
 * lost part of the platform.
 *
 * ### Why all fourteen owe the prohibition
 *
 * D-52 put the three peers on the list because the kernel cannot compile without
 * them — five kernel entities take `@GlobalEntity()` from `src/tenancy` and four
 * kernel files take `HttpError` from `src/http` as a **value** — so a peer
 * permitted to import a module is a kernel importing a module with **one extra
 * hop**, in package terms the cycle `kernel → http → mod-i18n → kernel`, against
 * F4's stated precondition that packages are not cyclic.
 *
 * That argument counted hops between *source directories that might become
 * different packages*. They did not: `packages/platform/tsconfig.build.json`
 * sets `rootDir: ./src` over an `include` of `src/**\/*`, the manifest publishes
 * `files: ["dist"]`, and every module package depends on the one artefact that
 * comes out. So a module specifier **anywhere** under the platform's source root
 * puts a `@endora-commerce/mod-*` entry in the platform's own `dependencies`,
 * and the cycle closes at **zero** hops whichever directory wrote it. The hop
 * the peer argument counted no longer exists, which is why the answer is the
 * whole package rather than a longer list of peers.
 *
 * This retires D-57's three carve-outs rather than widening past them, and each
 * one's own premise is what retired it. D-57 excluded `src/db` because it
 * "imports every module by construction" — `packages/platform/src/db/` imports
 * none, the two generated registries having stayed in `backend/src` when T116
 * moved the ORM configuration, the ordering and the bootstrap. It excluded
 * `src/overlay` as "per-deployment resolution" — the platform's `overlay/` is
 * the loader, and T114/T114a made the overlay root and the id claims
 * **parameters**, so it derives no deployment path. And it left `src/commands`
 * open in as many words: *"adding it to D-53's platform-root set costs zero
 * violations and would ratchet that property … a real open item F4 must close"*.
 * F4 is closed and the directory is in the package. Measured on the tree that
 * widened it: zero violations, which is the cheapest moment to lock an
 * invariant.
 *
 * ### The bare specifier
 *
 * The paragraph this replaced read *"there is no `@endora-commerce/mod-*`
 * package yet, so a bare specifier cannot reach a module; F4 will need a second
 * predicate over package names. Not built speculatively"*. That is a retiring
 * condition and it has been met — the modules are packages and
 * `backend/src/modules/` holds nothing but a `README.md`, so the **bare name is
 * now the only spelling a platform file can reach a module by**, and a widened
 * population judged by a relative-only predicate would be a green over the live
 * shape. The names are `layout.modulePackageNames`, derived from the members
 * declaring `endora: { type: "module", id }` and shared with
 * `check-module-boundary.ts`; nothing here reads a name's spelling, because a
 * `mod-` prefix rule would be a derived fact written down (D-100) and would
 * answer wrongly for the first package not named that way. A subpath of such a
 * name (`@endora-commerce/mod-blog/backend`) is the same reach as the name
 * itself. An **installed** module package is outside the predicate and stays
 * there: it is not a workspace member, so this repository has no derivation that
 * names it, and inventing one would be a list.
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
 * **Both spellings, since `specs/110-instance-repository/` T118a.** A relative
 * specifier resolving into `src/modules/` or `src/apps/`, and the bare npm name
 * of a module package — see *The bare specifier* under rule B for why the second
 * arrived and what it deliberately does not reach.
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
import {
  analyzeSource,
  collectSources,
  findingKey,
  isViolation,
  RELATION_DECORATOR_HINT,
  type RelationFinding,
} from '@endora-commerce/cli/rules/kernel-boundary.js';

import { namedSpecifiers, type SpecifierKind } from './lib/specifiers.js';
import {
  loadRegisteredModuleIds,
  modulePopulationCoverage,
  vacuousModulePopulation,
  type ModulePopulationCoverage,
} from './lib/module-population.js';
import { reportReadSize } from './lib/read-size.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { platformSubpathsAt } from './lib/platform-root.js';

export * from '@endora-commerce/cli/rules/kernel-boundary.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The directories of the platform's own source root — rule B's roots, derived
 * (`specs/110-instance-repository/` T118a; see *The roots are derived* above).
 *
 * A plain listing, deliberately: every directory the platform keeps is part of
 * the artefact it publishes, so the next one is judged the day it exists and
 * there is nothing to remember. It is sorted for a stable reporting order and
 * for nothing else — the four-element literal this replaced documented `kernel`
 * first, which was a presentation habit standing in for a population.
 *
 * Empty is a **refusal** at the call site and never an empty population: the
 * whole of rules B and C is the platform.
 */
export function platformRootsOf(platformRoot: string): readonly string[] {
  return readdirSync(platformRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Everything rule B needs to judge one file, handed in as one value.
 *
 * A record rather than three parameters because it is what a red proof supplies
 * at the top of the analysis: the fixture is source text plus the scope, and the
 * scope a proof builds is the one a real run builds — {@link platformRootsOf}
 * over the real platform — so a directory dropping out of the derivation reds
 * that directory's proof rather than passing quietly.
 */
export interface PlatformScope {
  /** The platform's source directory, e.g. `packages/platform/src`. */
  readonly root: string;
  /** Its directories — {@link platformRootsOf}. */
  readonly roots: readonly string[];
  /**
   * npm name → module id, for the bare half of the predicate.
   *
   * `layout.modulePackageNames`, derived from the members declaring
   * `endora: { type: "module", id }`. Empty means "this workspace has no module
   * package", which is a fixture tree; a real run refuses it.
   */
  readonly modulePackageNames: ReadonlyMap<string, string>;
}

/**
 * Which platform root owns `file`, or `null` for anything outside the platform.
 *
 * The root directory is passed in rather than matched by name (the relocation).
 * It used to be a `/src/<root>/` substring test, which after the move matched
 * two trees: the platform's own sources in `@endora-commerce/platform`, and the
 * re-export shims left at the old `backend/src/<root>/` paths. Reading the shims
 * as platform files is not a missed finding but a wrong one — every shim names
 * the package's build output, so rule B saw 63 outward imports where the four
 * roots it then walked had 25. Both numbers are that measurement's and neither
 * describes today's population, which is every directory the platform keeps.
 */
export function platformRootOf(file: string, scope: PlatformScope): string | null {
  return scope.roots.find((root) => file.startsWith(`${join(scope.root, root)}/`)) ?? null;
}

/**
 * The module a **bare** specifier reaches, or `null`.
 *
 * Matched against the names the workspace's module packages declare, never
 * against a `mod-` prefix: the prefix is a derived fact that would be written
 * down here (D-100), and it answers wrongly for the first package not named that
 * way. A subpath of a module package (`…/mod-blog/backend`) is the same reach as
 * the bare name, because both put the same entry in a `dependencies` block.
 */
export function bareModuleOwnerOf(
  specifier: string,
  modulePackageNames: ReadonlyMap<string, string>,
): string | null {
  if (specifier.startsWith('.')) return null;
  for (const [name, id] of modulePackageNames) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return id;
  }
  return null;
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
 * Every import in `source` that leaves its own platform root for somewhere this
 * rule has an opinion about.
 *
 * Two spellings, one finding shape. A **relative** specifier that leaves the
 * file's own root is reported whether or not it is a violation — another
 * platform root is allowed, and the allowed ones are what lets the summary
 * report both counts and `--list` tag each; {@link isImportViolation} is what
 * partitions them. A **bare** specifier is reported only when it names a module
 * package: every other one is a third-party dependency and no business of this
 * rule, and counting them would inflate `sites` with `awilix` and `pino`.
 *
 * Returns nothing for a file outside every platform root — the module→platform
 * direction is not this rule's business.
 *
 * The target is **not** gated on existing on disk: a platform file importing a
 * path that no longer exists must fail loudly, not pass silently.
 */
export function analyzePlatformImports(
  source: string,
  file: string,
  scope: PlatformScope,
): PlatformImportFinding[] {
  const root = platformRootOf(file, scope);
  if (!root) return [];
  const ownRoot = join(scope.root, root);

  return namedSpecifiers(source, file).flatMap((specifier) => {
    const common = {
      file,
      specifier: specifier.text,
      bindings: specifier.bindings,
      kind: reportedKind(specifier.kind),
      line: specifier.line,
    };
    if (!specifier.text.startsWith('.')) {
      const targetOwner = bareModuleOwnerOf(specifier.text, scope.modulePackageNames);
      // `resolved` is the specifier itself: a bare name resolves through the
      // package's own `exports` map, so there is no path to report and the
      // honest answer is what the file wrote.
      return targetOwner === null ? [] : [{ ...common, resolved: specifier.text, targetOwner }];
    }
    const resolved = resolveSpecifier(file, specifier.text);
    // Inside its own root the import is internal, whichever root that is.
    if (resolved.startsWith(`${ownRoot}/`)) return [];
    return [{ ...common, resolved, targetOwner: forbiddenOwnerOf(resolved) }];
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
  /**
   * npm name → module id, so a chain ending in a **bare** module specifier is
   * reported like one ending in a relative path.
   *
   * Required rather than defaulted: an empty default would make a caller that
   * forgot it silently blind to the one spelling a platform file can reach a
   * packaged module by, which is the fail-open direction.
   */
  readonly modulePackageNames: ReadonlyMap<string, string>;
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
      if (!specifier.text.startsWith('.')) {
        // A bare module specifier ends the chain here: there is nothing to
        // follow — the package resolves through its own `exports` map, and what
        // lies behind it is that module's graph, exactly as for a relative edge.
        const bareOwner = bareModuleOwnerOf(specifier.text, input.modulePackageNames);
        if (bareOwner === null) continue;
        violations.push({
          chain: [...chainTo(file), specifier.text],
          file,
          specifier: specifier.text,
          resolved: specifier.text,
          targetOwner: bareOwner,
          bindings: specifier.bindings,
          kind: reportedKind(specifier.kind),
          line: specifier.line,
        });
        continue;
      }
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
  // The population, derived from the platform's own directories (T118a). Empty
  // is a stop for the reason `platformRoot === null` is: rules B and C *are* the
  // platform, and a walk over none of it prints `violations=0`.
  const roots = platformRootsOf(platformRoot);
  if (roots.length === 0) {
    console.error(
      `[kernel-boundary] ${platformRoot} holds no directory — the platform is rules B and C's ` +
        'whole population, and a pass over none is not a pass',
    );
    process.exit(2);
  }
  const scope: PlatformScope = {
    root: platformRoot,
    roots,
    modulePackageNames: layout.modulePackageNames,
  };
  const platformFiles = roots.flatMap((root) => walkKernel(join(platformRoot, root)));
  const outward = platformFiles.flatMap((f) =>
    analyzePlatformImports(readFileSync(f, 'utf8'), f, scope),
  );
  const intoModules = outward.filter(isImportViolation);
  const importViolations = intoModules.filter((f) => !isDraining(f));
  const draining = intoModules.filter(isDraining);

  const closure = analyzeClosure({
    roots: walkKernel(join(platformRoot, 'kernel')),
    read: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null),
    modulePackageNames: layout.modulePackageNames,
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
        `${tag} ${platformRootOf(f.file, scope)} → ${f.targetOwner}: ` +
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
  // The bare half of rule B's predicate. No module package means no name a
  // platform file could reach a module by, which on this repository is a walk
  // that has lost the module tree rather than a repository without modules.
  // It is pushed here rather than refused earlier so that the module-population
  // reason above is in the same message: a moved module tree has to be *named*
  // as one, walk size included, and not answered with a consequence of it.
  if (layout.modulePackageNames.size === 0) {
    vacuous.push(
      'no workspace member declares `endora.type: "module"` — the bare specifier is the only ' +
        'spelling a platform file can reach a packaged module by (rule B)',
    );
  }
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
  // The platform's `exports` map is the second author over rule B's population
  // (T118a). This walk derives the roots by listing the platform's directories;
  // the map is a different program's answer to "which directories does this
  // package have", so a subpath naming a directory the walk did not produce is a
  // walk that has lost part of the platform — `read-size.ts` refuses it as a
  // short walk. The two disagree in the other direction by design: `src/demo/`
  // is a directory with no subpath, which is why the map is the corroboration
  // and not the derivation.
  const declaredSubpaths = platformSubpathsAt(layout.repoRoot);
  reportReadSize({
    prefix: '[kernel-boundary]',
    files: files.length,
    sites: findings.length + outward.length,
    coverage: [
      ...(coverage === null ? [] : [coverage]),
      {
        source: 'platform-subpaths',
        expected: declaredSubpaths.length,
        covered: declaredSubpaths.filter((subpath) => roots.includes(subpath.split('/')[0]!))
          .length,
      },
    ],
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
      `\nRule B — a platform file (${roots.join(', ')}) naming a module, by relative path ` +
        'into src/modules/ or src/apps/ or by a module package\'s bare name. The platform owns ' +
        'shapes and infrastructure; every one of those directories compiles into one published ' +
        'artefact with one dependency list, so a module named in any of them is a package cycle ' +
        '(docs/docs/architecture/kernel.md § The boundary). Move the shape into the platform, ' +
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
