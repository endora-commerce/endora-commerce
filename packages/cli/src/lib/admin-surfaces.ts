/**
 * "Where does this platform keep its **admin** surfaces, and whose are they?" —
 * the frontend twin of `lib/module-roots.ts` (feature 091, Phase 0).
 *
 * ## Why it exists
 *
 * `check:module-boundary` walks `layout.moduleWalkRoots`, and `admin/` is none
 * of them. So the cross-module reaches inside `admin/src/modules` are outside
 * every boundary instrument in the repository — and the failure mode is not
 * that they go unjudged now, it is what happens when an admin directory moves
 * into its module's package. `specs/084-small-f4-package-layout/contracts/module-package-layout.md`
 * §0 records the backend precedent: rewriting a ledgered relative import as a
 * package specifier **deleted** the reach from the walk, whereupon the two-way
 * ledger reported the entry describing it as stale. Doing that after a move
 * means doing it once per reach, silently, in the direction that looks like
 * progress. Hence FR-017: the instrument learns admin code **before** the first
 * directory moves.
 *
 * ## The derivation — three facts, each read from the artefact that owns it
 *
 *   1. **Which workspace member is the frontend.** The member whose
 *      `tsconfig.json` declares a `"@/*"` path. That alias is not decoration:
 *      it is what `tsc` and Vite both resolve the admin's own imports through,
 *      so it is a live declaration rather than a convention, and this check has
 *      to resolve it anyway — 67 of the 94 cross-module admin reaches are
 *      written `@/modules/…`. Exactly one member declares it, and **zero or two
 *      is exit 2**, the same refusal {@link findManifestIndex} makes for an
 *      ambiguous manifest index: picking one narrows every scan to it without
 *      saying so.
 *   2. **The source root** — the directory the alias points at (`admin/src`).
 *      Never a path spelled here.
 *   3. **The module root** — the one directory under that source root holding a
 *      child named after a registered module id. That is
 *      {@link applicationModuleRoots}' predicate minus its `manifest.ts` half,
 *      which an admin directory does not have. Under `admin/src` exactly one
 *      directory answers; two would be ambiguous and is refused.
 *
 * ## The directory name is not the module id
 *
 * 49 of the 55 directories under the module root are named after a registered
 * module. Six are not, and they are **not** six host-owned directories:
 * `admin/src/components/AppShell.tsx` attributes `/warehouses` to
 * `module: 'inventory'`, so `warehouses` is `inventory`'s admin surface under
 * another name. Keying on `basename` would leave that directory attributed to a
 * module that does not exist — an orphan shard — and would make a reach into it
 * from `inventory`'s own screens read as *cross-module* when it is a module
 * reaching its own code.
 *
 * So attribution is read from the **route**, which is where the admin already
 * writes it down: `App.tsx` maps a path to a component it imports from a
 * module directory, and `AppShell.tsx`'s `NAV` carries `{ to, module }` for
 * that path. {@link adminModuleDirectories} joins the two. A directory no NAV
 * entry claims is the admin application's own (`_shared`, `home`, `platform`,
 * `profile`) and is not a module's — which is the fail-closed direction: its
 * files are not judged as a module's, and a reach into it is not a cross-module
 * finding somebody would have to ledger under a module that does not own it.
 *
 * **One directory is attributed by neither rule and it is worth naming:**
 * `cms_pages`. Nothing under `admin/` imports its one component, so no route
 * renders it and no NAV entry claims it. `specs/091-module-owned-admin-surfaces/spec.md`
 * §2 records it as `cms`'s, which is a judgement about the name rather than a
 * fact the tree states; this derivation therefore leaves it host-owned. It
 * costs nothing today — the file makes no cross-module reach and nothing
 * reaches into it — and the alternative would be a mapping written down, which
 * is D-100 exactly.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';

import type { WorkspaceMember } from './workspace-packages.js';

/** The alias every admin file writes its own host imports through. */
export const ADMIN_SOURCE_ALIAS = '@/*';

/**
 * The owner id of the admin application itself.
 *
 * Not a module, and it has to be spelled somewhere: since P1 of
 * `specs/091-module-owned-admin-surfaces/` § *Phase 4* `check:module-boundary`
 * attributes an admin **host** file to it, so a reach out of one has a consumer
 * to be ledgered under.
 *
 * One spelling, **here**, and this is the moment that placement was for:
 * `check:admin-registrations` — which attributed a route or a nav entry no
 * module claimed to the same owner — and `ledgers/admin-registrations.ts`,
 * where this constant used to live, were deleted by batch 16 when the drain
 * emptied their population (SC-007, Phase 5 T5). The boundary ledger outlives
 * them and goes on using this name unchanged.
 */
export const ADMIN_HOST_OWNER = 'host';

/**
 * The generated admin contribution registry, by name.
 *
 * `generate-composer.ts` renders it into {@link AdminSurfaceLayout.sourceRoot},
 * and `check:module-boundary` exempts it: a generated registry naming every
 * contributing module package by a bare specifier is a composition root doing
 * its job, exactly as `composition.generated.ts` is in the backend. Both derive
 * the path from this constant and from the alias member, so neither can end up
 * looking at a file the other has stopped writing.
 */
export const ADMIN_REGISTRY_ARTEFACT = 'modules.generated.ts';

/** Raised when the admin layout cannot be resolved; a caller turns it into exit 2. */
export class AdminLayoutUnresolvableError extends Error {
  override readonly name = 'AdminLayoutUnresolvableError';
}

/** Directories that are not this repository's own source. */
const PRUNED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.docusaurus']);

/** One admin route as `App.tsx` declares it. */
export interface AdminRouteDeclaration {
  /** The `path` prop, exactly as written. */
  readonly path: string;
  /** The component the `element` prop renders, or `null` when it renders none. */
  readonly component: string | null;
  readonly line: number;
}

/** One sidebar entry as `AppShell.tsx`'s `NAV` declares it. */
export interface AdminNavDeclaration {
  /** The `to` field. */
  readonly to: string;
  /** The `module` field — `null` where the entry is the application's own. */
  readonly module: string | null;
  readonly line: number;
}

/** Everything derived about the admin application's module surfaces. */
export interface AdminSurfaceLayout {
  /** The workspace member declaring the `@/*` alias. */
  readonly memberDir: string;
  /** The directory that alias points at — `admin/src`. */
  readonly sourceRoot: string;
  /**
   * The directory holding the module surfaces — `admin/src/modules` — or
   * `null` when the application has none left (feature 091, R16).
   *
   * **Zero module roots is a measurement; two is still blindness.** The
   * predicate's two inputs are proved present before it is evaluated:
   * {@link resolveAdminSurfaces} has already refused a missing or ambiguous
   * alias member and an alias target that is not on disk, and the registered id
   * set comes from a generated manifest index `requireModuleLayout` refuses a
   * tree without. With both proved, *"no directory under the source root is
   * named after a registered module"* is an answer three artefacts with three
   * authors give together — the tsconfig alias, the manifest index and the
   * filesystem — and it flips back by itself the day a module directory
   * reappears, which is the property a written-down "drain complete" flag would
   * not have.
   *
   * `null` rather than `''` so `tsc` forces every consumer to answer; every
   * answer is the same trivial one, because nothing is under a directory that
   * does not exist.
   */
  readonly moduleRoot: string | null;
  /** The alias prefix a specifier is written with, including its slash: `@/`. */
  readonly aliasPrefix: string;
  /** Every directory under {@link moduleRoot}, sorted — empty where it is `null`. */
  readonly directories: readonly string[];
  /** Directory name → the module that owns it. Absent means host-owned. */
  readonly moduleOfDirectory: ReadonlyMap<string, string>;
  /** The routes `App.tsx` declares. */
  readonly routes: readonly AdminRouteDeclaration[];
  /** The nav entries `AppShell.tsx` declares. */
  readonly nav: readonly AdminNavDeclaration[];
  /** Component name → the module directory `App.tsx` imports it from. */
  readonly componentDirectories: ReadonlyMap<string, string>;
  /**
   * The two hand-written registries this layout is read out of — `App.tsx` and
   * `components/AppShell.tsx`, absolute.
   *
   * Returned rather than left implicit because a consumer has to be able to
   * exclude them **without spelling them a second time**. `App.tsx` imports one
   * component per module screen, so a boundary ledger that counted them would
   * record the feature's own subject as its debt, one entry per route, churning
   * with every batch. They were the whole population of the deleted
   * `check:admin-registrations` (`files=2`); what asserts them now is
   * `admin/test/modules/host-admin-registrations.test.tsx` (R13a).
   */
  readonly registryFiles: readonly string[];
  /**
   * The generated contribution registry — {@link ADMIN_REGISTRY_ARTEFACT} under
   * {@link sourceRoot}, absolute.
   *
   * Named whether or not it is on disk: the path is where the generator puts
   * it, and a checkout that has not run `composer:generate` has no artefact and
   * nothing to exclude.
   */
  readonly generatedRegistryFile: string;
}

/**
 * The one workspace member whose tsconfig declares the source alias.
 *
 * Read out of `tsconfig.json` rather than out of a Vite config, because the
 * tsconfig is the one both `tsc` and the bundler agree on and the one this
 * repository's own `paths` discipline is already written against.
 */
export function findAliasMember(
  members: readonly WorkspaceMember[],
  readText: (path: string) => string | null = defaultReadText,
): { readonly member: WorkspaceMember; readonly target: string } {
  const found: { member: WorkspaceMember; target: string }[] = [];
  for (const member of members) {
    const text = readText(join(member.dir, 'tsconfig.json'));
    if (text === null) continue;
    const target = aliasTargetOf(text);
    if (target !== null) found.push({ member, target });
  }
  if (found.length === 0) {
    throw new AdminLayoutUnresolvableError(
      `no workspace member declares a \`"${ADMIN_SOURCE_ALIAS}"\` path in its tsconfig.json — ` +
        'the admin source root is derived from that alias, and there is nothing to derive it from',
    );
  }
  if (found.length > 1) {
    throw new AdminLayoutUnresolvableError(
      `${found.length} workspace members declare a \`"${ADMIN_SOURCE_ALIAS}"\` path ` +
        `(${found.map((entry) => entry.member.name).join(', ')}) — the admin source root is ` +
        'ambiguous, and picking one narrows the walk to it without saying so',
    );
  }
  return found[0]!;
}

function defaultReadText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The directory `"@/*"` maps to, as written in the tsconfig, or `null`.
 *
 * Parsed with the compiler's own JSONC reader, because a tsconfig in this
 * repository carries comments and `JSON.parse` refuses one.
 */
export function aliasTargetOf(tsconfigText: string): string | null {
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', tsconfigText);
  const config = parsed.config as
    | { compilerOptions?: { paths?: Record<string, readonly string[]> } }
    | undefined;
  const targets = config?.compilerOptions?.paths?.[ADMIN_SOURCE_ALIAS];
  if (targets === undefined || targets.length === 0) return null;
  const first = targets[0]!;
  // `./src/*` → `src`. The trailing wildcard is what makes it a prefix rule and
  // is never part of the directory.
  const trimmed = first.replace(/\/\*$/, '').replace(/^\.\//, '');
  return trimmed === '' ? null : trimmed;
}

/**
 * The generated admin contribution registry's path, or `null` when this
 * workspace has no admin application at all (feature 091, R13b).
 *
 * **Narrower than the layout, deliberately.** It needs the alias member and its
 * target and nothing else — not `App.tsx`, not `components/AppShell.tsx`, not a
 * module root — because two checks gate a population floor on this file's
 * presence and *"the gate went true for a reason having nothing to do with the
 * registry"* is the exact defect §7.5 measured. `resolveAdminSurfaces` builds
 * {@link AdminSurfaceLayout.generatedRegistryFile} from this function, so there
 * is one derivation with two entry points rather than two answers.
 *
 * `null` here is the honest absence: with no alias member there is no directory
 * the artefact could be under, and a caller omits its token rather than
 * printing `0/0`.
 */
export function adminRegistryPathOf(
  members: readonly WorkspaceMember[],
  readText: (path: string) => string | null = defaultReadText,
): string | null {
  let resolved: { readonly member: WorkspaceMember; readonly target: string };
  try {
    resolved = findAliasMember(members, readText);
  } catch (error: unknown) {
    if (error instanceof AdminLayoutUnresolvableError) return null;
    throw error;
  }
  return join(resolve(resolved.member.dir, resolved.target), ADMIN_REGISTRY_ARTEFACT);
}

/**
 * The one directory under `sourceRoot` whose children are named after registered
 * modules, or `null` when none is.
 *
 * The same predicate {@link applicationModuleRoots} applies in `backend/src`,
 * minus its `manifest.ts` half: an admin surface directory has no manifest, so
 * requiring one would find nothing.
 *
 * **Absence is a measurement, ambiguity is blindness** (feature 091, R16). Zero
 * is `null`, because this feature exists to empty that directory and a refusal
 * would send a reader to repair a finished tree; two is still a throw, because
 * picking one narrows every walk to it without saying so.
 */
export function findAdminModuleRoot(
  sourceRoot: string,
  registered: ReadonlySet<string>,
): string | null {
  const roots = new Set<string>();
  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PRUNED.has(entry)) continue;
      const full = join(dir, entry);
      let directory: boolean;
      try {
        directory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!directory) continue;
      if (registered.has(entry)) {
        roots.add(dir);
        continue;
      }
      visit(full);
    }
  };
  visit(sourceRoot);
  const found = [...roots].sort();
  // The terminal state SC-007 reaches: every module's admin surfaces have moved
  // into that module's package, so `admin/src/modules/` holds only the admin
  // application's own directories and none of them is a registered id.
  if (found.length === 0) return null;
  if (found.length > 1) {
    throw new AdminLayoutUnresolvableError(
      `more than one directory under ${sourceRoot} holds children named after registered ` +
        `modules:\n${found.map((path) => `  ${path}`).join('\n')}\n` +
        'the admin module root is ambiguous, and picking one narrows the walk to it without ' +
        'saying so',
    );
  }
  return found[0]!;
}

/** `<Route path="…" element={<X … />} />` — every one `source` declares. */
export function adminRoutes(source: string, file = 'App.tsx'): AdminRouteDeclaration[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: AdminRouteDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxElement(node)
        ? node.openingElement
        : null;
    if (opening !== null && opening.tagName.getText(sf) === 'Route') {
      const path = stringAttribute(opening, 'path', sf);
      if (path !== null) {
        found.push({
          path,
          component: elementComponent(opening, sf),
          line: sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function stringAttribute(
  opening: ts.JsxOpeningLikeElement,
  name: string,
  sf: ts.SourceFile,
): string | null {
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText(sf) !== name) continue;
    const initializer = attribute.initializer;
    if (initializer !== undefined && ts.isStringLiteral(initializer)) return initializer.text;
  }
  return null;
}

/** The component name inside `element={<X … />}`, or `null`. */
function elementComponent(opening: ts.JsxOpeningLikeElement, sf: ts.SourceFile): string | null {
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText(sf) !== 'element') continue;
    const initializer = attribute.initializer;
    if (initializer === undefined || !ts.isJsxExpression(initializer)) continue;
    const expression = initializer.expression;
    if (expression === undefined) continue;
    if (ts.isJsxSelfClosingElement(expression)) return expression.tagName.getText(sf);
    if (ts.isJsxElement(expression)) return expression.openingElement.tagName.getText(sf);
  }
  return null;
}

/**
 * `{ to: '…', …, module: '…' }` — every nav entry `source` declares.
 *
 * Read as object literals carrying both fields rather than as members of a
 * constant named `NAV`, so a second nav array — a mobile strip, a settings
 * sub-nav — is in the population by construction rather than by being added
 * here.
 */
export function adminNavEntries(source: string, file = 'AppShell.tsx'): AdminNavDeclaration[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: AdminNavDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const to = literalProperty(node, 'to');
      const owner = literalProperty(node, 'module');
      // `to: null` is not a nav entry — a destination is a string. `module`
      // legitimately is `null`, which is how the admin's own entries declare
      // themselves, so the two fields are narrowed differently on purpose.
      if (typeof to === 'string' && owner !== undefined) {
        found.push({
          to,
          module: owner,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * A property's string value, `null` for a literal `null`, `undefined` when the
 * property is absent or is not one of the two.
 *
 * The three-way answer is what lets a nav entry declaring `module: null` — the
 * admin's own destinations — be recognised as *declared and host-owned* rather
 * than as *not a nav entry at all*.
 */
function literalProperty(
  node: ts.ObjectLiteralExpression,
  name: string,
): string | null | undefined {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name)
      ? property.name.text
      : ts.isStringLiteral(property.name)
        ? property.name.text
        : null;
    if (key !== name) continue;
    const value = property.initializer;
    if (ts.isStringLiteral(value)) return value.text;
    if (value.kind === ts.SyntaxKind.NullKeyword) return null;
    return undefined;
  }
  return undefined;
}

/**
 * Component name → the module directory `App.tsx` imports it from.
 *
 * Only specifiers landing inside the module root are recorded, so a host
 * component is absent rather than attributed to a directory that is not a
 * module's.
 */
export function routeComponentDirectories(
  source: string,
  moduleRootSegment: string,
  file = 'App.tsx',
): Map<string, string> {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const directories = new Map<string, string>();
  const prefixes = [`./${moduleRootSegment}/`, `@/${moduleRootSegment}/`];
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const prefix = prefixes.find((candidate) => specifier.text.startsWith(candidate));
    if (prefix === undefined) continue;
    const directory = specifier.text.slice(prefix.length).split('/')[0];
    if (directory === undefined || directory === '') continue;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (clause.name !== undefined) directories.set(clause.name.text, directory);
    const bound = clause.namedBindings;
    if (bound !== undefined && ts.isNamedImports(bound)) {
      for (const element of bound.elements) directories.set(element.name.text, directory);
    }
  }
  return directories;
}

/**
 * Directory name → the module that owns it, for every directory under the
 * module root.
 *
 * Two rules, in order, and the second is the one this function exists for:
 *
 *   1. a directory named after a registered module is that module's;
 *   2. a directory whose component renders a route a nav entry attributes to a
 *      registered module is that module's.
 *
 * A directory neither rule claims is the admin application's own and is absent
 * from the map. Rule 2's join is by route path — exact first, then the longest
 * nav `to` the route sits under, because `/warehouses/new` is declared as a
 * route and never as its own sidebar row.
 */
export function adminModuleDirectories(input: {
  readonly directories: readonly string[];
  readonly registered: ReadonlySet<string>;
  readonly routes: readonly AdminRouteDeclaration[];
  readonly nav: readonly AdminNavDeclaration[];
  readonly componentDirectories: ReadonlyMap<string, string>;
}): Map<string, string> {
  const owners = new Map<string, string>();
  const present = new Set(input.directories);
  for (const directory of input.directories) {
    if (input.registered.has(directory)) owners.set(directory, directory);
  }
  const navByPath = new Map<string, string | null>();
  for (const entry of input.nav) navByPath.set(normalisePath(entry.to), entry.module);
  for (const route of input.routes) {
    if (route.component === null) continue;
    const directory = input.componentDirectories.get(route.component);
    // A directory the module root does not hold is not a surface directory. The
    // route table imports plenty of components from elsewhere, and attributing
    // one of those would put an owner in the map that no walk can ever produce
    // a file for — a coverage expectation nothing satisfies.
    if (directory === undefined || !present.has(directory) || owners.has(directory)) continue;
    const owner = navOwnerOf(normalisePath(route.path), navByPath);
    if (owner !== null && input.registered.has(owner)) owners.set(directory, owner);
  }
  return owners;
}

function normalisePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The module a nav entry attributes this route to: the exact `to`, else the
 * longest `to` the route sits under.
 */
function navOwnerOf(
  path: string,
  navByPath: ReadonlyMap<string, string | null>,
): string | null {
  const exact = navByPath.get(path);
  if (exact !== undefined) return exact;
  let best: { readonly to: string; readonly module: string | null } | null = null;
  for (const [to, owner] of navByPath) {
    if (to === '/' || !path.startsWith(`${to}/`)) continue;
    if (best === null || to.length > best.to.length) best = { to, module: owner };
  }
  return best?.module ?? null;
}

/**
 * The whole admin layout, resolved once.
 *
 * `registered` is the manifest index's own id list, handed in rather than read
 * here, so the two derivations of "which modules exist" cannot disagree.
 */
export function resolveAdminSurfaces(
  members: readonly WorkspaceMember[],
  registered: ReadonlySet<string>,
  readText: (path: string) => string | null = defaultReadText,
): AdminSurfaceLayout {
  const { member, target } = findAliasMember(members, readText);
  const sourceRoot = resolve(member.dir, target);
  if (!existsSync(sourceRoot)) {
    throw new AdminLayoutUnresolvableError(
      `${member.name} declares \`"${ADMIN_SOURCE_ALIAS}"\` pointing at ${sourceRoot}, which ` +
        'does not exist — every admin specifier is resolved through that alias',
    );
  }
  const moduleRoot = findAdminModuleRoot(sourceRoot, registered);
  const directories =
    moduleRoot === null
      ? []
      : readdirSync(moduleRoot)
          .filter((entry) => !PRUNED.has(entry) && statSync(join(moduleRoot, entry)).isDirectory())
          .sort();

  // The two hand-written registries, spelled once. `registryFiles` below is
  // these same two paths, so a consumer that has to exclude them — the boundary
  // check's host population — never writes a second copy of the pair.
  const routeTableFile = join(sourceRoot, 'App.tsx');
  const navFile = join(sourceRoot, 'components', 'AppShell.tsx');
  const appSource = readText(routeTableFile);
  const shellSource = readText(navFile);
  if (appSource === null || shellSource === null) {
    throw new AdminLayoutUnresolvableError(
      `${member.name} has no App.tsx or no components/AppShell.tsx under ${sourceRoot} — the ` +
        'module a surface directory belongs to is read from the route table and the nav, and ' +
        'attributing by directory name instead would file two modules\' reaches under names ' +
        'no module answers to',
    );
  }
  const routes = adminRoutes(appSource);
  const nav = adminNavEntries(shellSource);
  // With no module root there is no directory a route component could be
  // imported from, so the map is empty — a measurement, like `directories`.
  const componentDirectories =
    moduleRoot === null
      ? new Map<string, string>()
      : routeComponentDirectories(appSource, moduleRoot.slice(sourceRoot.length + 1));

  return {
    memberDir: member.dir,
    sourceRoot,
    moduleRoot,
    aliasPrefix: `${ADMIN_SOURCE_ALIAS.slice(0, -1)}`,
    directories,
    moduleOfDirectory: adminModuleDirectories({
      directories,
      registered,
      routes,
      nav,
      componentDirectories,
    }),
    routes,
    nav,
    componentDirectories,
    registryFiles: [routeTableFile, navFile],
    // One derivation, two entry points — see `adminRegistryPathOf`. Non-null
    // here by construction: the alias member has already resolved above.
    generatedRegistryFile: adminRegistryPathOf(members, readText)!,
  };
}
