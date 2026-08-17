/**
 * CI check — a module does not import another module's internals
 * (Constitution I; feature 075, FR-001…FR-005 and FR-020…FR-028).
 *
 * **The rule, in one sentence:** no file under `backend/src/modules/<A>/` or
 * `backend/src/apps/<deployment>/modules/<A>/` may name an import specifier that
 * resolves into a different module's directory.
 *
 * Features 072 and 073 finished the *runtime* half of Principle I: 891 port
 * resolutions through the container with zero violations. What was left is the
 * *compile-time* half — the type annotation each of those resolutions is written
 * against, and the entity class a module still queries directly — and it is
 * **674 sites**, 43% of them `import type`. `check-port-dependencies.ts`' header
 * defers this work by name; this is the different rule it defers to.
 *
 * ## What counts as a specifier
 *
 * Every shape TypeScript admits, through `scripts/lib/specifiers.ts` — the
 * walker extracted from `check-kernel-boundary.ts`, which polices the opposite
 * direction across the same boundary. Two independently written walkers drift,
 * and the shape one forgets is the shape the next violation uses.
 *
 * **`import type` is a violation** (FR-003), on three grounds worth restating
 * here because the reader of a failure message will want them: precedent
 * (`check-container-imports.ts` decides it the same way); ESLint's
 * `prefer: 'type-imports'` would otherwise rewrite value imports into exempt
 * ones automatically; and a type edge is a real edge in a `package.json`,
 * because types resolve at build time.
 *
 * ## Resolution
 *
 * The specifier is **normalised** against the importing file's directory before
 * the target is decided. A prefix match on one nesting depth is what produced
 * the documented 2.2× undercount (348 against the real 674), so `../catalog/x`
 * from `modules/blog/plugin.ts` and `../../catalog/x` from
 * `modules/blog/services/x.ts` resolve to one edge and one ledger key — and both
 * depths carry their own red proof.
 *
 * A module's identity here is its **directory**, not its bare name, so an
 * overlay `catalog` reaching the core `catalog` is the cross-tree edge it is
 * rather than an internal import.
 *
 * Bare specifiers are ignored: there is no `@endora-commerce/mod-*` package yet,
 * so a bare specifier cannot reach a module. F4 adds the second predicate — the
 * same limit `check-kernel-boundary.ts` states for itself, and for the same
 * reason (Principle IV).
 *
 * ## Out of scope, each for a stated reason
 *
 *   - `src/composition.ts` and the generated registries — a composition root
 *     naming modules is a root doing its job. Out **by construction**, since the
 *     walk is over module directories, not by exemption.
 *   - `src/kernel`, `src/http`, `src/events`, `src/tenancy`, `src/commands`,
 *     `src/db`, `src/overlay` — not modules. The reverse direction is
 *     `check-kernel-boundary.ts` rules B and C.
 *   - `src/apps/<deployment>/decorations/**` — a decoration names the core
 *     service interface it wraps; that is its contract with `tsc` (features
 *     057/072).
 *   - `backend/test/**` — reporting only, under `--tests`. A test is allowed to
 *     know more than the code it tests, and after F4 a test importing another
 *     module's entity is a `devDependency` edge.
 *   - {@link GENERATED_MODULE_FILES} — a file is exempt because a **generator
 *     owns it**, and the entry says which. Not a `.generated.` filename match:
 *     scoping a rule to a filename convention makes the rule's reach a property
 *     of naming rather than of code, which is what `check-kernel-boundary.ts`'
 *     rule A was widened away from (issue #113).
 *
 * ## The ledger
 *
 * `scripts/ledgers/cross-module-imports/<module>.ts`, one file per **consumer**
 * module, loaded by walking the directory. Sharded rather than flat (FR-023)
 * because a single table makes all 45 cut merge requests edit one file, and that
 * is the serialisation point this design exists to remove.
 *
 * It fails **six** ways, not two: an unledgered import fails, a stale entry
 * fails, an empty shard fails (delete the file instead), an orphan shard fails,
 * a **misfiled** entry fails — without that one, an engineer blocked on
 * `catalog` could park an `orders` finding in `catalog.ts` and both merge
 * requests would read green — and a **permanent entry with no retiring
 * condition** fails.
 *
 * There is **no global count** anyone can raise to make the build pass (FR-028):
 * `ledger-size` is derived from the walk and printed, never written down.
 *
 * ## Permanent entries (D-77)
 *
 * Most entries are debt: a sentence saying why an edge still stands and what
 * retires it, drained by the cut that removes the import. A few are not, and the
 * ledger has to be able to say so — the worked example is `catalog` reaching
 * `custom_fields`' apply seam, which a foreign key with `on delete restrict`
 * makes co-transactional, so no port can carry it and no merge request will
 * remove it. Such an entry is `{ permanent: true, reason, retiredBy }`:
 * **excluded from `ledger-size`**, printed separately, and held to the opposite
 * rule from a draining one — it must name what would retire it, and naming the
 * sweep fails the build. See {@link PermanentLedgerEntry}.
 *
 * `ledger-size` is **keys**, `cross-module imports` is **sites**, and at MR-0
 * they read 670 and 674. The four are one file reaching one target path twice —
 * `orders`' two dynamic imports of `stock-level.entity` and of
 * `stock-allocation.entity`, `customers`' duplicated `import type` of
 * `quick_order`'s preference service, and `organizations`' route file naming
 * `customer-account.entity` once as a type and once dynamically. Keying by file
 * and target rather than by line (FR-026) is what makes them one entry, and it
 * is the property that lets code move inside a file without invalidating the
 * ledger; the entry retires when the *last* of the sites under it goes.
 *
 * **"Not yet cut" is a reason only during the sweep.** Every entry generated in
 * MR-0 says so and names the merge request that retires it; after
 * **2026-12-31** that sentence stops being an acceptable reason, and an entry
 * still carrying it is a boundary the repository has decided to keep rather than
 * one it is in the middle of removing.
 *
 * Usage: `tsx scripts/check-module-boundary.ts [--list] [--tests] [--module <id>]`
 * Exit 0 = every cross-module import is ledgered in its own shard;
 * exit 1 = at least one is not, or the ledger lies in one of the other four ways;
 * exit 2 = the check read nothing (issue #113).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'node:path/posix';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moduleOf } from './check-container-imports.js';
import { namedSpecifiers, type SpecifierKind } from './lib/specifiers.js';

const BACKEND_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');
const TEST_ROOT = join(BACKEND_ROOT, 'test');
const LEDGER_ROOT = join(BACKEND_ROOT, 'scripts', 'ledgers', 'cross-module-imports');

/**
 * Module files a generator owns, and the script that emits each.
 *
 * Checked **two ways** by {@link generatedExemptionIssues}: an entry naming a
 * file that does not exist fails, and a file whose named generator does not
 * exist fails. An exemption nobody can go stale on is an exemption that outlives
 * its reason.
 */
export const GENERATED_MODULE_FILES: Readonly<Record<string, string>> = {
  'modules/_lifecycle/manifest-index.generated.ts': 'scripts/generate-composer.ts',
};

/** The specifier shape, as `scripts/lib/specifiers.ts` classifies it. */
export type CrossModuleImportKind = SpecifierKind;

/** Which surface of the target the specifier reaches — it selects the remedy. */
export type CrossModuleSurface = 'entity' | 'service' | 'port' | 'manifest' | 'wiring' | 'other';

export interface CrossModuleImport {
  /** Path under `src/`, POSIX separators: `modules/orders/services/order-service.ts`. */
  readonly file: string;
  readonly line: number;
  /** The module the importing file belongs to. */
  readonly moduleId: string;
  /** The module the specifier resolves into. Always a different directory. */
  readonly target: string;
  /** The specifier exactly as written, for the message. */
  readonly specifier: string;
  /**
   * The target path with the module segment stripped, normalised, extension
   * dropped: `entities/product.entity`. Normalised rather than taken verbatim,
   * so `../catalog/x` and `../../catalog/x` from two depths produce one key.
   */
  readonly targetPath: string;
  readonly kind: CrossModuleImportKind;
  readonly surface: CrossModuleSurface;
  /** True when either side lives under `src/apps/<deployment>/modules/`. */
  readonly overlay: boolean;
}

/** `<file>:<target module>/<target path>` — the ledger key, and a site's identity. */
export function keyOf(found: CrossModuleImport): string {
  return found.targetPath === ''
    ? `${found.file}:${found.target}`
    : `${found.file}:${found.target}/${found.targetPath}`;
}

/**
 * An entry the repository has decided to **keep** (feature 075, D-77).
 *
 * The ordinary entry is a sentence saying why an edge still stands and what
 * retires it; the sweep drains them, and `ledger-size` counts them so the
 * draining is visible. A permanent entry is the opposite claim — this edge is
 * not waiting for a merge request, it rests on something in the tree — and it is
 * held to a different rule in both directions:
 *
 *  - it is **excluded from `ledger-size`** and printed separately, so a residue
 *    that has stopped shrinking because the last few entries are permanent does
 *    not read as a stalled sweep (the idiom D-72 gave the parity ledger);
 *  - it **must name what would retire it**, and "the cut merge request" is not
 *    an acceptable answer for one. An entry with no retiring condition is a
 *    boundary nobody can argue with later, which is exactly what a permanent
 *    flag must not be allowed to create.
 *
 * The worked example is `catalog` → `custom_fields`' apply seam: a child insert
 * must see its parent inside one transaction because of
 * `fk_product_attributes_custom_field_definition`, so no port can carry it, and
 * what retires it is F4's package entry points — not a cut.
 */
export interface PermanentLedgerEntry {
  readonly permanent: true;
  /** Why the edge stands. Names the constraint, not the inconvenience. */
  readonly reason: string;
  /** What would retire it. A merge request is not a retiring condition. */
  readonly retiredBy: string;
}

/** What a shard maps a key to: a draining reason, or a permanent entry. */
export type LedgerEntry = string | PermanentLedgerEntry;

/** One ledger shard: the module it belongs to, and its entries. */
export interface LedgerShard {
  /** The consumer module the shard is named for — the filename's stem. */
  readonly moduleId: string;
  /** Key → the reason it still stands and the question that retires it. */
  readonly entries: Readonly<Record<string, LedgerEntry>>;
}

/**
 * Whether a shard value claims permanence.
 *
 * Structural rather than trusting the declared type, because a shard is loaded
 * at runtime through a dynamic `import` and `tsc` never sees it. A value that is
 * neither a string nor a permanence claim is reported as a malformed entry
 * rather than silently read as a reason.
 */
export function isPermanent(entry: unknown): entry is PermanentLedgerEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as { permanent?: unknown }).permanent === true
  );
}

/** A merge request is not a retiring condition — see {@link PermanentLedgerEntry}. */
const SWEEP_RETIRING_CONDITION = /merge request|the cut\b|not yet cut|phase c/i;

/**
 * Why a permanent entry is not acceptable as written, or `null` when it is.
 *
 * Separate from the shard walk so the rule can be proven on one entry rather
 * than on a tree, and so the message names the key the reader has to fix.
 */
export function permanentEntryIssue(key: string, entry: PermanentLedgerEntry): string | null {
  const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
  if (reason === '') {
    return `${key} is permanent but states no reason`;
  }
  const retiredBy = typeof entry.retiredBy === 'string' ? entry.retiredBy.trim() : '';
  if (retiredBy === '') {
    return `${key} is permanent but names no retiring condition`;
  }
  if (SWEEP_RETIRING_CONDITION.test(retiredBy)) {
    return (
      `${key} is permanent but names the sweep as its retiring condition ` +
      `("${retiredBy}") — an entry a merge request retires is not permanent`
    );
  }
  return null;
}

export interface ModuleBoundaryInput {
  /** Every module source, keyed by path relative to `src/`. */
  readonly sources: ReadonlyMap<string, string>;
}

export interface CheckResult {
  readonly total: number;
  /** Cross-module imports no shard accounts for. */
  readonly violations: readonly CrossModuleImport[];
  readonly ledgered: readonly CrossModuleImport[];
  /** Ledger keys that describe no finding in this run. */
  readonly stale: readonly string[];
  /** Shards with no entries — the file is to be deleted, not emptied. */
  readonly emptyShards: readonly string[];
  /** Shards named for a module that does not exist. */
  readonly orphanShards: readonly string[];
  /** `<shard>: <key>` for a key whose file is not this shard's module. */
  readonly misfiledEntries: readonly string[];
  /** Keys the repository has decided to keep — excluded from `ledger-size`. */
  readonly permanentKeys: readonly string[];
  /** A permanent entry that states no reason or no retiring condition. */
  readonly permanentIssues: readonly string[];
}

/** Where a module lives and what it is called: `{ id: 'orders', dir: 'modules/orders' }`. */
interface ModuleLocation {
  readonly id: string;
  readonly dir: string;
}

/**
 * The module a path under `src/` belongs to, with its directory.
 *
 * `moduleOf` is shared with `check-container-imports.ts` so the two checks
 * cannot disagree about what a module is; the trailing slash is what lets it
 * answer for a specifier that resolves to the module directory itself
 * (`from '../catalog'`).
 */
function moduleLocationOf(pathUnderSrc: string): ModuleLocation | null {
  const id = moduleOf(`/src/${pathUnderSrc}/`);
  if (id === null) return null;
  const segments = pathUnderSrc.split('/');
  const modulesAt = segments.indexOf('modules');
  const index = segments.indexOf(id, modulesAt);
  if (index === -1) return null;
  return { id, dir: segments.slice(0, index + 1).join('/') };
}

/**
 * The specifier resolved against the importing file's directory, extension
 * dropped, or `null` for a bare specifier.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const joined = posixNormalize(posixJoin(posixDirname(fromFile), specifier));
  return joined.replace(/\.(js|ts)$/, '');
}

/**
 * Which surface of the target the specifier reaches.
 *
 * `kind` is the specifier shape and `surface` is the target shape: the red
 * proofs are about the first (can the walker still see it?) and the failure
 * message's remedy is about the second (what should this become?).
 */
function surfaceOf(targetPath: string): CrossModuleSurface {
  const segments = targetPath.split('/');
  const head = segments[0] ?? '';
  const base = segments[segments.length - 1] ?? '';
  if (head === 'entities' || base.endsWith('.entity')) return 'entity';
  if (segments.includes('ports') || base.endsWith('.port')) return 'port';
  if (head === 'services' || base.endsWith('.service') || base.endsWith('-service')) {
    return 'service';
  }
  if (base.startsWith('manifest')) return 'manifest';
  if (base === 'backend' || base === 'plugin' || base.startsWith('routes')) return 'wiring';
  return 'other';
}

/**
 * Every cross-module import `source` names.
 *
 * `file` is the path **under `src/`**, because that is what decides the owning
 * module, the target module and whether the file is scanned at all — which is
 * also why every red proof enters here, with source text and a path, rather than
 * with a resolved pair the check normally computes (issue #130).
 */
export function analyzeSource(source: string, file: string): CrossModuleImport[] {
  if (GENERATED_MODULE_FILES[file] !== undefined) return [];
  const owner = moduleLocationOf(file);
  if (owner === null) return [];

  const found: CrossModuleImport[] = [];
  for (const specifier of namedSpecifiers(source, file)) {
    const resolved = resolveSpecifier(file, specifier.text);
    if (resolved === null) continue;
    const target = moduleLocationOf(resolved);
    if (target === null) continue;
    if (target.dir === owner.dir) continue;
    const targetPath = resolved === target.dir ? '' : resolved.slice(target.dir.length + 1);
    found.push({
      file,
      line: specifier.line,
      moduleId: owner.id,
      target: target.id,
      specifier: specifier.text,
      targetPath,
      kind: specifier.kind,
      surface: surfaceOf(targetPath),
      overlay: owner.dir.startsWith('apps/') || target.dir.startsWith('apps/'),
    });
  }
  return found;
}

/** Every cross-module import in the input, in file then line order. */
export function findCrossModuleImports(input: ModuleBoundaryInput): CrossModuleImport[] {
  const found = [...input.sources].flatMap(([file, text]) => analyzeSource(text, file));
  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return found;
}

/** The file half of a ledger key, or `null` when the key does not parse. */
function fileOfKey(key: string): string | null {
  const at = key.indexOf(':');
  if (at <= 0 || at === key.length - 1) return null;
  return key.slice(0, at);
}

/**
 * The two-way comparison, in both directions and over all five failure modes.
 *
 * The module set is derived from the sources rather than from a second walk, so
 * "this module exists" means exactly "this module has sources in the input the
 * check read" — an orphan shard cannot be created by two walks disagreeing.
 */
export function checkModuleBoundary(
  input: ModuleBoundaryInput,
  shards: readonly LedgerShard[],
): CheckResult {
  const all = findCrossModuleImports(input);
  const present = new Set(all.map(keyOf));

  const modules = new Set<string>();
  for (const file of input.sources.keys()) {
    const owner = moduleLocationOf(file);
    if (owner !== null) modules.add(owner.id);
  }

  const ledger = new Map<string, LedgerEntry>();
  const misfiledEntries: string[] = [];
  const emptyShards: string[] = [];
  const orphanShards: string[] = [];
  const permanentKeys: string[] = [];
  const permanentIssues: string[] = [];

  for (const shard of shards) {
    const keys = Object.keys(shard.entries);
    if (keys.length === 0) emptyShards.push(shard.moduleId);
    if (!modules.has(shard.moduleId)) orphanShards.push(shard.moduleId);
    for (const key of keys) {
      const file = fileOfKey(key);
      const owner = file === null ? null : moduleLocationOf(file);
      // A shard accounts for its own module and nothing else, so it cannot be
      // used to make another module's violation disappear.
      if (owner === null || owner.id !== shard.moduleId) {
        misfiledEntries.push(`${shard.moduleId}: ${key}`);
        continue;
      }
      const entry = shard.entries[key] ?? '';
      ledger.set(key, entry);
      if (isPermanent(entry)) {
        permanentKeys.push(key);
        const issue = permanentEntryIssue(key, entry);
        if (issue !== null) permanentIssues.push(issue);
      } else if (typeof entry !== 'string') {
        permanentIssues.push(
          `${key} is neither a reason nor a permanent entry — a shard value is a string or ` +
            '`{ permanent: true, reason, retiredBy }`',
        );
      }
    }
  }

  return {
    total: all.length,
    violations: all.filter((entry) => !ledger.has(keyOf(entry))),
    ledgered: all.filter((entry) => ledger.has(keyOf(entry))),
    // A permanent entry goes stale exactly like a draining one: it describes an
    // import, and an import that is gone is an entry that lies.
    stale: [...ledger.keys()].filter((key) => !present.has(key)).sort(),
    emptyShards: emptyShards.sort(),
    orphanShards: orphanShards.sort(),
    misfiledEntries: misfiledEntries.sort(),
    permanentKeys: permanentKeys.sort(),
    permanentIssues: permanentIssues.sort(),
  };
}

/**
 * Why this run must not report a pass, or `null` when it read something.
 *
 * Exit **2**, never 0 and never 1: a green result must not be able to mean "not
 * looking" (issue #113, FR-021).
 */
export function vacuousReason(input: {
  readonly moduleFiles: number;
  readonly ledgerDirectoryExists: boolean;
}): string | null {
  if (input.moduleFiles === 0) {
    return 'no module sources under src/ — refusing to report a vacuous pass';
  }
  if (!input.ledgerDirectoryExists) {
    return 'ledger directory missing — refusing to report a vacuous pass';
  }
  return null;
}

/** Where the shards live. Exported so the check and its test read one directory. */
export function ledgerDirectory(): string {
  return LEDGER_ROOT;
}

/**
 * Every shard in `directory`, loaded.
 *
 * Rejects rather than returning an empty list when the directory is missing or a
 * shard fails to import: both are "read nothing", and the CLI turns the
 * rejection into exit 2.
 */
export async function loadLedgerShards(directory: string): Promise<LedgerShard[]> {
  if (!existsSync(directory)) {
    throw new Error('ledger directory missing — refusing to report a vacuous pass');
  }
  const shards: LedgerShard[] = [];
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.ts')) continue;
    const moduleId = name.replace(/\.ts$/, '');
    let loaded: unknown;
    try {
      loaded = (await import(pathToFileURL(join(directory, name)).href)) as unknown;
    } catch (error) {
      throw new Error(`ledger shard '${moduleId}' failed to load: ${String(error)}`);
    }
    const entries = (loaded as { entries?: unknown }).entries;
    if (typeof entries !== 'object' || entries === null) {
      throw new Error(`ledger shard '${moduleId}' failed to load: it exports no 'entries' record`);
    }
    shards.push({ moduleId, entries: entries as Readonly<Record<string, string>> });
  }
  return shards;
}

/**
 * Every file the rule applies to: the shared core module tree plus every
 * deployment overlay's module tree.
 *
 * Exported so the check's own test asserts the **real** tree through the same
 * walk the CLI uses — both callers agree on the scan scope by construction
 * rather than by two similar walks (`check-container-imports.ts`' precedent).
 *
 * `*.test.ts` is **included**: `src/modules/orders/prompt-tools.test.ts` is a
 * test file living under `src/` and is therefore in scope (it moves to
 * `backend/test/`). Declaration files are not, because they are emitted.
 */
export function collectModuleFiles(srcRoot: string = SRC_ROOT): string[] {
  return [...walk(join(srcRoot, 'modules')), ...walk(join(srcRoot, 'apps'))];
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Absolute paths → the source map the analysis reads, keyed under `src/`. */
export function sourcesOf(files: readonly string[], srcRoot: string = SRC_ROOT): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(srcRoot, file).split('\\').join('/'), readFileSync(file, 'utf8'));
  }
  return sources;
}

/**
 * The two ways a {@link GENERATED_MODULE_FILES} entry can rot: the file it names
 * is gone, or the generator it credits is.
 */
export function generatedExemptionIssues(
  exists: (repoRelativePath: string) => boolean = (path) => existsSync(join(BACKEND_ROOT, path)),
): string[] {
  const issues: string[] = [];
  for (const [file, generator] of Object.entries(GENERATED_MODULE_FILES)) {
    if (!exists(`src/${file}`)) {
      issues.push(`${file} is exempt as generated, but no such file exists`);
    }
    if (!exists(generator)) {
      issues.push(`${file} names generator ${generator}, which does not exist`);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** What the module author should do instead, chosen by the surface reached. */
function remedyFor(finding: CrossModuleImport): string {
  const consumer = finding.moduleId;
  const owner = finding.target;
  const head = `    This is ${describe(finding.surface)} of \`${owner}\`.`;
  const port = [
    `      1. \`${owner}\` publishes a port and its contract type in`,
    `         packages/contracts/src/${owner}.ts;`,
    '      2. resolve it here with lazyPort<ContractType>(ctx, \'<literalPortName>\')',
    '         — the name must be a string literal;',
    `      3. add '${owner}' to \`dependencies\` in src/modules/${consumer}/manifest.ts.`,
  ].join('\n');

  switch (finding.surface) {
    case 'entity':
      return [
        `${head} Ask \`${owner}\` for the data instead:`,
        port,
        '',
        '    Do not relocate the entity: moving it changes the specifier and not the',
        '    coupling.',
      ].join('\n');
    case 'wiring':
      return [
        `${head} Reaching another module's registration file makes the two one unit.`,
        `    Replace it with a contribution point \`${owner}\` owns, following the split`,
        '    feature 073 performed on `orders`\' five guest modules.',
      ].join('\n');
    case 'manifest':
      return [
        `${head} Read the deployment-resolved module registry instead of another`,
        "    module's manifest file.",
      ].join('\n');
    default:
      return [`${head} Ask \`${owner}\` for the behaviour instead:`, port].join('\n');
  }
}

function describe(surface: CrossModuleSurface): string {
  switch (surface) {
    case 'entity':
      return 'an entity';
    case 'service':
      return 'a service';
    case 'port':
      return 'a port declaration';
    case 'manifest':
      return 'the manifest';
    case 'wiring':
      return 'the wiring';
    default:
      return 'an internal';
  }
}

function describeFinding(finding: CrossModuleImport): string {
  return (
    `  - ${finding.file}:${finding.line}\n` +
    `      ${finding.moduleId} -> ${finding.target}   ${finding.kind}   ${finding.specifier}\n`
  );
}

/** `backend/test/**` — reporting only, never part of the exit code. */
function testSites(): number {
  let total = 0;
  for (const file of walk(TEST_ROOT)) {
    const fromBackend = relative(BACKEND_ROOT, file).split('\\').join('/');
    for (const specifier of namedSpecifiers(readFileSync(file, 'utf8'), fromBackend)) {
      if (!specifier.text.startsWith('.')) continue;
      const resolved = posixNormalize(posixJoin(posixDirname(fromBackend), specifier.text));
      if (!resolved.startsWith('src/')) continue;
      if (moduleLocationOf(resolved.slice('src/'.length)) !== null) total += 1;
    }
  }
  return total;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const testMode = process.argv.includes('--tests');
  const moduleAt = process.argv.indexOf('--module');
  const only = moduleAt === -1 ? null : (process.argv[moduleAt + 1] ?? null);

  const files = collectModuleFiles();
  const vacuous = vacuousReason({
    moduleFiles: files.length,
    ledgerDirectoryExists: existsSync(LEDGER_ROOT),
  });
  if (vacuous !== null) {
    console.error(`[module-boundary] ${vacuous}`);
    process.exit(2);
  }

  let shards: LedgerShard[];
  try {
    shards = await loadLedgerShards(LEDGER_ROOT);
  } catch (error) {
    console.error(`[module-boundary] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
    return;
  }

  const sources = sourcesOf(files);
  const result = checkModuleBoundary({ sources }, shards);
  const selected = <T extends { readonly moduleId: string }>(entries: readonly T[]): readonly T[] =>
    only === null ? entries : entries.filter((entry) => entry.moduleId === only);

  const violations = selected(result.violations);
  const ledgered = selected(result.ledgered);

  if (listMode) {
    for (const finding of [...violations, ...ledgered].sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
    )) {
      const tag = result.violations.includes(finding) ? 'CROSS   ' : 'LEDGERED';
      console.log(
        `${tag} ${finding.file}:${finding.line}  [${finding.moduleId} -> ${finding.target}] ` +
          `${finding.kind}  ${finding.surface}\n           ${finding.specifier}`,
      );
    }
    console.log('');
  }

  // `ledger-size` is what is left to drain, so the entries the repository has
  // decided to keep are excluded from it and printed on their own line. A
  // residue that stops shrinking because the last few entries are permanent
  // would otherwise read as a stalled sweep (D-77; the idiom D-72 gave the
  // parity ledger).
  const ledgerSize =
    shards.reduce((sum, shard) => sum + Object.keys(shard.entries).length, 0) -
    result.permanentKeys.length;
  console.log(
    `[module-boundary] module files=${files.length} cross-module imports=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${ledgerSize} shards=${shards.length} stale=${result.stale.length} ` +
      `permanent=${result.permanentKeys.length}`,
  );
  if (result.permanentKeys.length > 0) {
    console.log(
      '[module-boundary] permanent entries (kept, not draining — excluded from ledger-size):',
    );
    for (const key of result.permanentKeys) console.log(`  - ${key}`);
  }

  if (testMode) {
    console.log(
      `[module-boundary] test sites=${testSites()} (backend/test/** — reporting only, ` +
        'a test is allowed to know more than the code it tests)',
    );
  }

  const exemptionIssues = generatedExemptionIssues();
  if (exemptionIssues.length > 0) {
    console.error('\nThe generated-file exemption no longer describes the tree:');
    for (const issue of exemptionIssues) console.error(`  - ${issue}`);
  }

  if (result.violations.length > 0) {
    console.error(
      '\nA module imported another module\'s internals (Constitution I; feature 075 FR-001).\n',
    );
    for (const finding of result.violations) {
      console.error(describeFinding(finding));
      console.error(remedyFor(finding));
      console.error(
        '\n    Do not wrap the port call in a catch: it turns fail-closed into fail-open.\n' +
          '\n    If the edge must stand for now, add it to\n' +
          `    backend/scripts/ledgers/cross-module-imports/${finding.moduleId}.ts with a reason\n` +
          '    and the question that retires it.\n',
      );
    }
  }
  if (result.stale.length > 0) {
    console.error('\nStale ledger entries (they describe no import any more — delete them):');
    for (const key of result.stale) console.error(`  - ${key}`);
  }
  if (result.emptyShards.length > 0) {
    console.error(
      '\nEmpty ledger shards. A shard with no entries is a done signal that says nothing —\n' +
        'delete the file instead:',
    );
    for (const id of result.emptyShards) {
      console.error(`  - backend/scripts/ledgers/cross-module-imports/${id}.ts`);
    }
  }
  if (result.orphanShards.length > 0) {
    console.error('\nLedger shards named for a module that does not exist:');
    for (const id of result.orphanShards) console.error(`  - ${id}`);
  }
  if (result.misfiledEntries.length > 0) {
    console.error(
      '\nMisfiled ledger entries. A shard accounts for its own module and nothing else,\n' +
        'or one module\'s shard could absorb another module\'s violation:',
    );
    for (const entry of result.misfiledEntries) console.error(`  - ${entry}`);
  }

  if (result.permanentIssues.length > 0) {
    console.error(
      '\nA permanent ledger entry has to say what would retire it, and a merge request\n' +
        'is not a retiring condition. An entry nobody can argue with later is exactly what\n' +
        'the flag must not create:',
    );
    for (const issue of result.permanentIssues) console.error(`  - ${issue}`);
  }

  const failed =
    result.violations.length > 0 ||
    result.stale.length > 0 ||
    result.emptyShards.length > 0 ||
    result.orphanShards.length > 0 ||
    result.misfiledEntries.length > 0 ||
    result.permanentIssues.length > 0 ||
    exemptionIssues.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
