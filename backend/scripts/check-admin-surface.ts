/**
 * CI check — a module reaching admin platform surface the platform does not
 * publish (feature 091, FR-009/FR-016; `contracts/admin-kit-surface.md` §6).
 *
 * ## What it is for
 *
 * `check:platform-surface` asks this question on the backend: a module names a
 * symbol of a platform file, and the host's barrels decide whether that symbol
 * is published. One frontend over, the problem is identical and until Phase 1b
 * there was nothing to ask it of — the admin's design system was 74 files under
 * `admin/src`, reachable by an alias that resolves for every file in the
 * application and for nothing an installed package runs under.
 *
 * Phase 1b moved 57 of those files into `@endora-commerce/admin-kit` and left a
 * re-export shim at each old path, so the question now has an answer: **a reach
 * that lands on a shim is published, a reach that lands on anything else host-owned
 * is not.** The check is deliberately *not* landed before that
 * (`admin-kit-surface.md` R15's correction): its population is symbols of the
 * kit's barrels, R14 makes a kit with no implementation subpath exit 2, and a
 * check whose only honest answer is a refusal is not an instrument.
 *
 * ## The five findings
 *
 * | Finding | What it is |
 * | --- | --- |
 * | `unpublished-symbol` | a module names a symbol of a host admin file the kit does not publish |
 * | `whole-file-reach` | a namespace, dynamic or side-effect reach naming no symbol — it takes the file's internals whatever they are |
 * | `aliased-reach` | a module **package**'s admin layer writing `@/…`, which resolves for nothing an installed package runs under |
 * | `unpublished-subpath` | a bare specifier into the kit naming a subpath its `exports` map does not declare, the root included |
 * | `unresolvable-reach` | a specifier inside the admin source root that resolves to no file — issue #215 one layer in: a skip is never acceptable |
 *
 * The verdict is **per symbol**, not per file, for `check:platform-surface`'s
 * reason: a barrel publishes some of a file's names and not others, and a
 * per-file verdict would license every symbol of a file one symbol of which is
 * published.
 *
 * ## What a "published" target is, and why it is derived rather than listed
 *
 * A **shim** is a file under the admin source root whose every statement is an
 * export declaration naming `<kit>/<subpath>`. Nothing is written down: the
 * predicate reads the file. That fails closed in the direction that matters —
 * a shim that grows a local declaration stops being a shim in the same run, and
 * every module reaching it becomes a finding, which is exactly what should
 * happen when the admin re-acquires a private design-system component behind a
 * name that used to be published.
 *
 * A reach into another **module's** directory is not this check's: it is
 * `check:module-boundary`'s, which has held the admin's 72 cross-module keys
 * since Phase 0. A reach into the importing file's own module directory is
 * nobody's.
 *
 * ## The ledger
 *
 * `UNPUBLISHED_ADMIN_REACHES` is two-way and keyed `(file, target)` with the
 * **symbols named**, because the verdict is per symbol and an entry that only
 * counted them could not be checked against the barrel it disagrees with.
 * Both stale directions fail: a key describing no reach, and a symbol an entry
 * names that the walk no longer sees.
 *
 * It opens **non-empty**, which R15 did not anticipate and which is the honest
 * state: two groups of admin host files are deliberately unpublished and each
 * has its retiring condition recorded in the ledger and in the package README.
 *
 * Usage: `tsx scripts/check-admin-surface.ts [--list]`
 * Exit 0 = every module reach into the admin host is published or ledgered;
 * exit 1 = at least one is neither, or a ledger entry went stale;
 * exit 2 = the check read nothing it could judge.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import { UNPUBLISHED_ADMIN_REACHES, type UnpublishedAdminReach } from './ledgers/admin-surface.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

/** One `from '…'` in a walked file, with the names it takes. */
export interface AdminReachSite {
  /** The walked file, in the one namespace this check uses: repository-relative. */
  readonly file: string;
  /** The module that owns {@link AdminReachSite.file}. */
  readonly owner: string;
  readonly specifier: string;
  readonly line: number;
  /** Named bindings, or empty for a shape that names none. */
  readonly symbols: readonly string[];
  /** `named` | `namespace` | `default` | `side-effect` | `dynamic`. */
  readonly shape: ReachShape;
  /** True when the walked file belongs to a module **package**, not to the admin app. */
  readonly packaged: boolean;
}

export type ReachShape = 'named' | 'namespace' | 'default' | 'side-effect' | 'dynamic';

export type AdminSurfaceFindingKind =
  | 'unpublished-symbol'
  | 'whole-file-reach'
  | 'aliased-reach'
  | 'unpublished-subpath'
  | 'unresolvable-reach';

export interface AdminSurfaceFinding {
  readonly kind: AdminSurfaceFindingKind;
  /** `<file>::<target>` — the ledger key this finding would be filed under. */
  readonly key: string;
  readonly file: string;
  readonly owner: string;
  /** The repository-relative path, or the bare specifier, the reach lands on. */
  readonly target: string;
  readonly symbols: readonly string[];
  readonly message: string;
}

/** Everything the analysis reads, so a red proof enters where a real run enters. */
export interface AdminSurfaceInput {
  /** Every reach the walk found. */
  readonly sites: readonly AdminReachSite[];
  /**
   * Repository-relative path → the kit subpaths it forwards to.
   *
   * A file with an entry is a shim and is published surface; one without is
   * host-owned and is not. Derived by {@link shimSubpathsOf} from the file's own
   * text, never from a list.
   */
  readonly shims: ReadonlyMap<string, ReadonlySet<string>>;
  /** Kit subpath (`ui`) → the symbols its barrel exports. */
  readonly barrels: ReadonlyMap<string, ReadonlySet<string>>;
  /** The kit's package name, so a bare reach into it is recognised. */
  readonly kitName: string;
  /** The alias prefix an admin specifier writes the source root as: `@/`. */
  readonly aliasPrefix: string;
  /**
   * A specifier, resolved to a repository-relative path, or `null` for one
   * that does not point inside the admin source root at all.
   *
   * Injected because resolution is filesystem work and the analysis is not, and
   * because a red proof has to be able to state "this specifier reaches that
   * file" without building a tree to say it in.
   */
  readonly resolveAdmin: (site: AdminReachSite) => AdminResolution;
}

export type AdminResolution =
  /** Lands on a file inside the admin source root. */
  | { readonly kind: 'admin'; readonly path: string }
  /** Lands inside a module's own directory, or another module's — not this check's. */
  | { readonly kind: 'module'; readonly path: string }
  /** Points inside the admin source root and resolves to no file. */
  | { readonly kind: 'unresolvable' }
  /** A bare specifier, or a reach outside the admin source root. */
  | { readonly kind: 'external' };

export interface AdminSurfaceResult {
  readonly findings: readonly AdminSurfaceFinding[];
  /** Keys the ledger holds that this run saw no reach for. */
  readonly stale: readonly string[];
  /** `<key>: <symbol>` an entry names that the walk no longer sees. */
  readonly staleSymbols: readonly string[];
  /** Reaches an entry accounts for. */
  readonly ledgered: readonly AdminSurfaceFinding[];
  /** Every reach examined — the `sites=` number. */
  readonly sites: number;
}

/** `<file>::<target>`, the one key shape, in one namespace. */
export function reachKey(file: string, target: string): string {
  return `${file}::${target}`;
}

/**
 * The analysis. Pure over {@link AdminSurfaceInput}, so every red proof enters
 * at the top of it (issue #130).
 */
export function checkAdminSurface(
  input: AdminSurfaceInput,
  ledger: Readonly<Record<string, UnpublishedAdminReach>> = UNPUBLISHED_ADMIN_REACHES,
): AdminSurfaceResult {
  const findings: AdminSurfaceFinding[] = [];
  const ledgered: AdminSurfaceFinding[] = [];
  const seenKeys = new Set<string>();
  const seenSymbols = new Map<string, Set<string>>();

  const record = (finding: AdminSurfaceFinding): void => {
    seenKeys.add(finding.key);
    const symbols = seenSymbols.get(finding.key) ?? new Set<string>();
    for (const symbol of finding.symbols) symbols.add(symbol);
    seenSymbols.set(finding.key, symbols);
    if (ledger[finding.key] === undefined) findings.push(finding);
    else ledgered.push(finding);
  };

  for (const site of input.sites) {
    const kitSubpath = bareKitSubpath(site.specifier, input.kitName);
    if (kitSubpath !== null) {
      if (!input.barrels.has(kitSubpath.name)) {
        record({
          kind: 'unpublished-subpath',
          key: reachKey(site.file, site.specifier),
          file: site.file,
          owner: site.owner,
          target: site.specifier,
          symbols: site.symbols,
          message:
            `${site.file}:${site.line} names \`${site.specifier}\`, a subpath ` +
            `${input.kitName}'s \`exports\` map does not declare. Widening that map is the ` +
            'obvious repair and the whole point of this check is that it is not widened ' +
            'quietly — say what the new group is for.',
        });
        continue;
      }
      recordUnpublishedSymbols(record, site, kitSubpath.name, input.barrels, site.specifier);
      continue;
    }

    if (site.packaged && site.specifier.startsWith(input.aliasPrefix)) {
      record({
        kind: 'aliased-reach',
        key: reachKey(site.file, site.specifier),
        file: site.file,
        owner: site.owner,
        target: site.specifier,
        symbols: site.symbols,
        message:
          `${site.file}:${site.line} names \`${site.specifier}\`. \`${input.aliasPrefix}\` is a ` +
          'tsconfig/Vite alias of the admin application; an installed package resolves it to ' +
          `nothing. Name the published subpath of ${input.kitName} instead (FR-008).`,
      });
      continue;
    }

    const resolution = input.resolveAdmin(site);
    if (resolution.kind === 'module') continue;
    if (resolution.kind === 'external') continue;
    if (resolution.kind === 'unresolvable') {
      record({
        kind: 'unresolvable-reach',
        key: reachKey(site.file, site.specifier),
        file: site.file,
        owner: site.owner,
        target: site.specifier,
        symbols: site.symbols,
        message:
          `${site.file}:${site.line} names \`${site.specifier}\`, which points inside the ` +
          'admin source root and resolves to no file. A reach this check counted and did ' +
          'not judge is issue #215 one layer in — it is never a skip.',
      });
      continue;
    }

    const subpaths = input.shims.get(resolution.path);
    if (subpaths === undefined) {
      if (site.shape !== 'named' && site.shape !== 'default') {
        record(wholeFileFinding(site, resolution.path, input.kitName));
        continue;
      }
      record({
        kind: 'unpublished-symbol',
        key: reachKey(site.file, resolution.path),
        file: site.file,
        owner: site.owner,
        target: resolution.path,
        symbols: site.symbols,
        message:
          `${site.file}:${site.line} names ${quoteAll(site.symbols)} of ` +
          `\`${resolution.path}\`, which ${input.kitName} does not publish: the file is not a ` +
          're-export shim, so there is no subpath a packaged module could name it by. Publish ' +
          'it from a barrel, or give it a home in the module that owns its data (FR-007).',
      });
      continue;
    }

    if (site.shape !== 'named' && site.shape !== 'default') {
      record(wholeFileFinding(site, resolution.path, input.kitName));
      continue;
    }
    for (const subpath of subpaths) {
      recordUnpublishedSymbols(record, site, subpath, input.barrels, resolution.path);
    }
  }

  const stale: string[] = [];
  const staleSymbols: string[] = [];
  for (const key of Object.keys(ledger).sort()) {
    if (!seenKeys.has(key)) {
      stale.push(key);
      continue;
    }
    const seen = seenSymbols.get(key) ?? new Set<string>();
    for (const symbol of ledger[key]!.symbols) {
      if (!seen.has(symbol)) staleSymbols.push(`${key}: ${symbol}`);
    }
  }

  return { findings, ledgered, stale, staleSymbols, sites: input.sites.length };
}

function wholeFileFinding(
  site: AdminReachSite,
  target: string,
  kitName: string,
): AdminSurfaceFinding {
  return {
    kind: 'whole-file-reach',
    key: reachKey(site.file, target),
    file: site.file,
    owner: site.owner,
    target,
    symbols: [],
    message:
      `${site.file}:${site.line} reaches \`${target}\` as a ${site.shape} import, which names ` +
      'no symbol and therefore takes the file\'s internals whatever they are. A published ' +
      `surface is a set of names: import them from ${kitName} by name.`,
  };
}

function recordUnpublishedSymbols(
  record: (finding: AdminSurfaceFinding) => void,
  site: AdminReachSite,
  subpath: string,
  barrels: ReadonlyMap<string, ReadonlySet<string>>,
  target: string,
): void {
  const published = barrels.get(subpath);
  if (published === undefined) return;
  const missing = site.symbols.filter((symbol) => !published.has(symbol));
  if (missing.length === 0) return;
  record({
    kind: 'unpublished-symbol',
    key: reachKey(site.file, target),
    file: site.file,
    owner: site.owner,
    target,
    symbols: missing,
    message:
      `${site.file}:${site.line} names ${quoteAll(missing)} through \`${target}\`, and the ` +
      `\`./${subpath}\` barrel does not export ${missing.length === 1 ? 'it' : 'them'}. A ` +
      'name that is reachable here and absent from the barrel is surface with no supported ' +
      'spelling — add it to the barrel, or stop reaching for it.',
  });
}

function quoteAll(symbols: readonly string[]): string {
  return symbols.length === 0 ? '(no symbol)' : symbols.map((s) => `\`${s}\``).join(', ');
}

/** `@endora-commerce/admin-kit/ui` → `{ name: 'ui' }`; the root and a foreign name → `null`. */
export function bareKitSubpath(
  specifier: string,
  kitName: string,
): { readonly name: string } | null {
  if (specifier === kitName) return { name: '.' };
  if (!specifier.startsWith(`${kitName}/`)) return null;
  return { name: specifier.slice(kitName.length + 1) };
}

/**
 * The subpaths a file forwards to, or `null` for a file that is not a shim.
 *
 * A shim is a file whose **every** statement is an export declaration naming a
 * subpath of the kit. Reading the text rather than a list is what makes the
 * predicate fail closed: a shim that grows one local declaration stops being a
 * shim in the same run, and every module reaching it becomes a finding.
 */
export function shimSubpathsOf(source: string, kitName: string): ReadonlySet<string> | null {
  const file = ts.createSourceFile('shim.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const subpaths = new Set<string>();
  if (file.statements.length === 0) return null;
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement)) return null;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) return null;
    const subpath = bareKitSubpath(specifier.text, kitName);
    if (subpath === null) return null;
    subpaths.add(subpath.name);
  }
  return subpaths;
}

/** Every `from '…'` in one file, with the names it takes. */
export function reachesOf(
  source: string,
  file: string,
  owner: string,
  packaged: boolean,
): readonly AdminReachSite[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: AdminReachSite[] = [];
  const lineOf = (node: ts.Node): number =>
    parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      let shape: ReachShape = 'named';
      const symbols: string[] = [];
      if (clause === undefined) shape = 'side-effect';
      else {
        if (clause.name !== undefined) {
          shape = 'default';
          symbols.push('default');
        }
        if (clause.namedBindings !== undefined) {
          if (ts.isNamespaceImport(clause.namedBindings)) shape = 'namespace';
          else {
            shape = 'named';
            for (const element of clause.namedBindings.elements) {
              symbols.push((element.propertyName ?? element.name).text);
            }
          }
        }
      }
      sites.push({
        file,
        owner,
        specifier: node.moduleSpecifier.text,
        line: lineOf(node),
        symbols,
        shape,
        packaged,
      });
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const symbols: string[] = [];
      let shape: ReachShape = 'named';
      if (node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          symbols.push((element.propertyName ?? element.name).text);
        }
      } else shape = 'namespace';
      sites.push({
        file,
        owner,
        specifier: node.moduleSpecifier.text,
        line: lineOf(node),
        symbols,
        shape,
        packaged,
      });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      sites.push({
        file,
        owner,
        specifier: node.arguments[0].text,
        line: lineOf(node.arguments[0]),
        symbols: [],
        shape: 'dynamic',
        packaged,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}

/**
 * Why this run may not report a pass, or `null`.
 *
 * Exit **2** every time. Each is an input whose absence would leave the verdict
 * vacuously clean rather than failing (issue #113), and the module-population
 * floor is issue #215's: a walk that came back *short* is the case that
 * happens.
 */
export function vacuousReason(input: {
  readonly adminResolved: boolean;
  readonly kitFound: boolean;
  readonly implementationSubpaths: number;
  readonly barrelsRead: number;
  readonly barrelWithStar: string | null;
  readonly walkedFiles: number;
  readonly shims: number;
}): string | null {
  if (!input.adminResolved) {
    return (
      'no workspace member declares the admin source alias, so there is no module surface to ' +
      'walk and no host to judge a reach against — refusing to report a vacuous pass'
    );
  }
  if (!input.kitFound) {
    return (
      'no workspace member is the admin kit, so nothing in this repository publishes an admin ' +
      'surface and every reach would read as unpublished — refusing to report a vacuous pass'
    );
  }
  if (input.implementationSubpaths === 0) {
    return (
      "the kit's `exports` map declares no implementation subpath (R14): there is no barrel, " +
      'so there is no symbol to judge and the answer would be a refusal dressed as a pass'
    );
  }
  if (input.barrelsRead < input.implementationSubpaths) {
    return (
      `the kit declares ${input.implementationSubpaths} implementation subpath(s) and only ` +
      `${input.barrelsRead} barrel(s) could be read — a short published set reports more ` +
      'findings, not fewer, and its obvious repair is to widen the barrel silently'
    );
  }
  if (input.barrelWithStar !== null) {
    return (
      `the \`${input.barrelWithStar}\` barrel holds an \`export *\`, a namespace re-export or ` +
      'an `export {…}` with no `from` (R2), so what it publishes cannot be enumerated and ' +
      'every symbol would read as published'
    );
  }
  if (input.walkedFiles === 0) {
    return (
      'the walk opened no module-owned admin file — a finding count over an empty input is ' +
      'not a clean tree; refusing to report a vacuous pass'
    );
  }
  if (input.shims === 0) {
    return (
      'no file under the admin source root is a re-export shim, so every reach into the host ' +
      'would read as unpublished and the ledger would be the whole tree — the kit is not ' +
      'wired into this application'
    );
  }
  return null;
}

// --- the walk ---------------------------------------------------------------

const SOURCE_FILE = /\.tsx?$/;

function walkFiles(directory: string, into: string[] = []): string[] {
  if (!existsSync(directory)) return into;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walkFiles(path, into);
    else if (SOURCE_FILE.test(entry) && !entry.endsWith('.d.ts')) into.push(path);
  }
  return into;
}

/** Barrel export names, or `null` when the barrel cannot be enumerated (R2). */
export function barrelSymbolsOf(source: string): ReadonlySet<string> | null {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.moduleSpecifier === undefined) return null;
    if (statement.exportClause === undefined) return null;
    if (!ts.isNamedExports(statement.exportClause)) return null;
    for (const element of statement.exportClause.elements) names.add(element.name.text);
  }
  return names;
}

interface KitPackage {
  readonly name: string;
  readonly dir: string;
  readonly subpaths: readonly string[];
}

/** The workspace member that is the admin kit — the one `admin/src` shims into. */
function findKit(members: readonly { name: string; dir: string }[]): KitPackage | null {
  for (const member of members) {
    const manifestPath = join(member.dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      exports?: Record<string, unknown>;
    };
    if (manifest.name !== '@endora-commerce/admin-kit') continue;
    const subpaths = Object.keys(manifest.exports ?? {})
      .filter((key) => key.startsWith('./') && key !== './package.json')
      .map((key) => key.slice(2));
    return { name: manifest.name, dir: member.dir, subpaths };
  }
  return null;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout('[admin-surface]');
  const admin = await layout.adminSurfaces();
  const members = workspaceMembers(layout.repoRoot, nodeWorkspaceFs());
  const kit = findKit(members);

  const barrels = new Map<string, ReadonlySet<string>>();
  let barrelWithStar: string | null = null;
  let implementationSubpaths = 0;
  if (kit !== null) {
    for (const subpath of kit.subpaths) {
      const barrelPath = join(kit.dir, 'src', subpath, 'index.ts');
      if (!existsSync(barrelPath)) continue;
      implementationSubpaths += 1;
      const symbols = barrelSymbolsOf(readFileSync(barrelPath, 'utf8'));
      if (symbols === null) {
        barrelWithStar ??= subpath;
        continue;
      }
      barrels.set(subpath, symbols);
    }
  }

  // Shims: every file under the admin source root whose whole body forwards to
  // the kit. Read, never listed.
  const shims = new Map<string, ReadonlySet<string>>();
  if (admin !== null && kit !== null) {
    for (const path of walkFiles(admin.sourceRoot)) {
      if (path.startsWith(`${admin.moduleRoot}/`)) continue;
      const subpaths = shimSubpathsOf(readFileSync(path, 'utf8'), kit.name);
      if (subpaths !== null) shims.set(relative(layout.repoRoot, path), subpaths);
    }
  }

  // Population: the admin's module-attributed surface directories, plus every
  // module package's own admin layer (zero of them today, and the reason
  // `aliased-reach` and `unpublished-subpath` are shapes rather than dead code).
  const sites: AdminReachSite[] = [];
  let walkedFiles = 0;
  const owners = new Set<string>();
  if (admin !== null) {
    for (const [directory, owner] of admin.moduleOfDirectory) {
      for (const path of walkFiles(join(admin.moduleRoot, directory))) {
        walkedFiles += 1;
        owners.add(owner);
        sites.push(
          ...reachesOf(
            readFileSync(path, 'utf8'),
            relative(layout.repoRoot, path),
            owner,
            false,
          ),
        );
      }
    }
  }
  for (const root of layout.moduleRoots) {
    if (root.origin !== 'workspace-package' || root.moduleId === null) continue;
    for (const path of walkFiles(join(root.directory, 'src', 'admin'))) {
      walkedFiles += 1;
      owners.add(root.moduleId);
      sites.push(
        ...reachesOf(readFileSync(path, 'utf8'), relative(layout.repoRoot, path), root.moduleId, true),
      );
    }
  }

  const vacuous = vacuousReason({
    adminResolved: admin !== null,
    kitFound: kit !== null,
    implementationSubpaths,
    barrelsRead: barrels.size,
    barrelWithStar,
    walkedFiles,
    shims: shims.size,
  });
  if (vacuous !== null) {
    console.error(`[admin-surface] ${vacuous}`);
    process.exit(2);
    return;
  }

  const resolveAdmin = (site: AdminReachSite): AdminResolution => {
    const from = join(layout.repoRoot, site.file);
    let base: string;
    if (site.specifier.startsWith(admin!.aliasPrefix)) {
      base = join(admin!.sourceRoot, site.specifier.slice(admin!.aliasPrefix.length));
    } else if (site.specifier.startsWith('./') || site.specifier.startsWith('../')) {
      base = resolvePath(dirname(from), site.specifier);
    } else return { kind: 'external' };
    if (!base.startsWith(`${admin!.sourceRoot}/`)) return { kind: 'external' };
    const stripped = base.replace(/\.js$/, '');
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${stripped}.ts`,
      `${stripped}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
      join(stripped, 'index.ts'),
      join(stripped, 'index.tsx'),
    ]) {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
      return candidate.startsWith(`${admin!.moduleRoot}/`)
        ? { kind: 'module', path: relative(layout.repoRoot, candidate) }
        : { kind: 'admin', path: relative(layout.repoRoot, candidate) };
    }
    return { kind: 'unresolvable' };
  };

  const result = checkAdminSurface({
    sites,
    shims,
    barrels,
    kitName: kit!.name,
    aliasPrefix: admin!.aliasPrefix,
    resolveAdmin,
  });

  if (listMode) {
    for (const finding of [...result.ledgered, ...result.findings]) {
      console.log(`${finding.kind.padEnd(20)} ${finding.key} :: ${finding.symbols.join(', ')}`);
    }
    console.log('');
  }

  reportReadSize({
    prefix: '[admin-surface]',
    files: walkedFiles,
    sites: sites.length,
    coverage: [
      {
        // `AppShell.tsx` and `App.tsx` name the modules a surface directory
        // belongs to; the generated index is rendered from the manifests. Two
        // authors, which is what makes this a reconciliation (issue #244).
        source: 'manifest-index',
        expected: owners.size,
        covered: [...owners].filter((owner) => layout.registeredIds.includes(owner)).length,
      },
      {
        // The kit's own `exports` map against the barrels on disk: a subpath
        // declared and not built, or built and not declared, is the shape that
        // makes a reach unjudgeable.
        source: 'admin-kit-exports',
        expected: implementationSubpaths,
        covered: barrels.size,
      },
    ],
  });

  console.log(
    `[admin-surface] shims=${shims.size} barrels=${barrels.size} ` +
      `published=${sites.length - result.findings.length - result.ledgered.length} ` +
      `ledger-size=${Object.keys(UNPUBLISHED_ADMIN_REACHES).length} ` +
      `ledgered=${result.ledgered.length} findings=${result.findings.length} ` +
      `stale=${result.stale.length + result.staleSymbols.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA module reaches admin platform surface the platform does not publish.\n' +
        'The remedy is to publish it from a barrel, or — when the thing reached is another\n' +
        "module's data — to give it a home in that module's own admin layer (FR-007).\n",
    );
    for (const finding of result.findings) console.error(`  - [${finding.kind}] ${finding.message}\n`);
  }
  for (const key of result.stale) {
    console.error(
      `  - [stale-entry] ${key} is ledgered and this run saw no reach for it. The reach went;\n` +
        '    remove the entry rather than leaving a description of nothing.\n',
    );
  }
  for (const entry of result.staleSymbols) {
    console.error(
      `  - [stale-symbol] ${entry} — the entry names a symbol the walk no longer sees. An\n` +
        '    entry that does not describe the reach cannot be checked against the barrel it\n' +
        '    disagrees with.\n',
    );
  }

  const failed =
    result.findings.length > 0 || result.stale.length > 0 || result.staleSymbols.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
